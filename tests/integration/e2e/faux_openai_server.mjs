// Scripted OpenAI-compatible server for iKi e2e: drives a write_file tool
// call, then a final answer; later turns report whether the tool exchange
// survived persistence/restart by inspecting the request's message history.
import http from 'node:http';
import fs from 'node:fs';

const PORT = Number(process.env.FAUX_PORT || 18730);
const LOG = process.env.FAUX_LOG || '/tmp/iki-e2e/faux_requests.log';
const MODEL = 'faux-e2e-model';

const log = entry => fs.appendFileSync(LOG, JSON.stringify(entry) + '\n');

const sse = (res, chunks) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const chunk of chunks) {
    res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
};

// Non-streaming (generateText) callers expect a complete JSON body.
const jsonResponse = (res, { text, toolCalls }) => {
  const id = 'chatcmpl-ns';
  const message = toolCalls
    ? { role: 'assistant', content: text ?? null, tool_calls: toolCalls }
    : { role: 'assistant', content: text };
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id,
    object: 'chat.completion',
    model: MODEL,
    choices: [{ index: 0, message, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
  }));
};

const writeCall = (id, filePath, content) => ({
  id,
  type: 'function',
  function: { name: 'write_file', arguments: JSON.stringify({ path: filePath, content }) },
});
const CALL_1 = writeCall('call_e2e_1', 'e2e/hello.txt', 'e2e-written-by-agent');
const CALL_2 = writeCall('call_e2e_2', 'e2e/second.txt', 'e2e-second-approval');

const reply = (res, payload, { text, toolCalls }) =>
  payload.stream
    ? sse(res, text !== undefined ? textResponse(text) : toolCallResponse(toolCalls ?? []))
    : jsonResponse(res, { text, toolCalls });

const textResponse = text => [
  { id: 'chatcmpl-1', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: null }] },
  { id: 'chatcmpl-1', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
];

// The streaming path must honor the passed toolCalls: the repeat-approval
// round issues a second call with a different id/path.
const toolCallResponse = toolCalls => [
  { id: 'chatcmpl-2', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: { role: 'assistant', content: 'I will write the file now.' }, finish_reason: null }] },
  { id: 'chatcmpl-2', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: { tool_calls: toolCalls.map((call, index) => ({ index, id: call.id, type: 'function', function: call.function })) }, finish_reason: null }] },
  { id: 'chatcmpl-2', object: 'chat.completion.chunk', model: MODEL, choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
];

const server = http.createServer((req, res) => {
  fs.appendFileSync(LOG + '.urls', `${req.method} ${req.url}\n`);
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ object: 'list', data: [{ id: MODEL }] }));
    return;
  }
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end('{}'); return;
  }
  let body = '';
  req.on('data', d => { body += d; });
  req.on('end', () => {
    let payload;
    try { payload = JSON.parse(body); } catch { res.writeHead(400); res.end('{}'); return; }
    const messages = payload.messages || [];
    const roles = messages.map(m => m.role);
    // Count individual tool calls: one assistant message can carry several
    // tool_calls (multi-call batch), which must match the tool results 1:1.
    const toolMsgs = messages.filter(m => m.role === 'tool').length;
    const assistantToolCalls = messages
      .filter(m => m.role === 'assistant')
      .reduce((count, m) => count + (Array.isArray(m.tool_calls) ? m.tool_calls.length : 0), 0);
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const lastUserText = typeof lastUser?.content === 'string' ? lastUser.content : JSON.stringify(lastUser?.content ?? '');
    log({ t: Date.now(), roles, toolMsgs: toolMsgs.length, assistantToolCalls: assistantToolCalls.length, lastUserText: lastUserText.slice(0, 120) });

    // Meta-request from the harness: dynamic tool selection. Enable write_file.
    const allText = JSON.stringify(messages);
    if (allText.includes('smallest set of tools')) {
      log({ t: Date.now(), phase: 'tool-selection' });
      reply(res, payload, { text: '{"tools":["write_file"]}' });
      return;
    }

    if (lastUserText.startsWith('CHECK_HISTORY')) {
      // Only the real continuation carries thread history (roles beyond
      // system+user); bare pre-calls get ack. If history were lost, no report
      // ever renders and the gate fails by timeout instead of a bogus 0/0.
      if (messages.length > 2) {
        // Per-turn marker so the gate can wait for THIS turn's report rather
        // than matching an earlier report already rendered in the transcript.
        const report = `HISTORY_REPORT[${lastUserText.slice(0, 24)}] tool_msgs=${toolMsgs} assistant_tool_calls=${assistantToolCalls}`;
        reply(res, payload, { text: report });
      } else {
        reply(res, payload, { text: 'ack.' });
      }
      return;
    }
    // Drive a repeat-approval loop within one E2E_TASK turn: 0 completed tool
    // exchanges → first write_file; 1 → a second write_file (the approval card
    // must re-render after the resume); ≥2 → done. Retries within a thread
    // re-issue from where the exchange count left off.
    const e2eIdx = messages.map(m => m.role === 'user').lastIndexOf(true);
    const toolCountAfterE2e = messages.slice(e2eIdx + 1).filter(m => m.role === 'tool').length;
    if (lastUserText.startsWith('E2E_TASK') && toolCountAfterE2e === 0) {
      log({ t: Date.now(), phase: 'tool-call', toolContent: JSON.stringify(messages.filter(m => m.role === 'tool').map(m => m.content)).slice(0, 400) });
      reply(res, payload, { toolCalls: [CALL_1] });
      return;
    }
    if (lastUserText.startsWith('E2E_TASK') && toolCountAfterE2e === 1) {
      log({ t: Date.now(), phase: 'tool-call-2' });
      reply(res, payload, { toolCalls: [CALL_2] });
      return;
    }
    if (lastUserText.startsWith('E2E_TASK')) {
      reply(res, payload, { text: `E2E_DONE ${lastUserText.slice(0, 20)}` });
      return;
    }
    reply(res, payload, { text: 'ack.' });
  });
});

server.listen(PORT, '127.0.0.1', () => console.log(`faux openai on ${PORT}`));
