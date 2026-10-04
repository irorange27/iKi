/**
 * Scripted OpenAI-compatible SSE server for the Pi candidate integration
 * (issue #96). Unlike the sandbox probes, this server keeps the evidence the
 * review demanded: a per-script request counter, the full wire body of every
 * request, and strict "unknown script" failures so a candidate loop cannot
 * silently consume a wrong-numbered response.
 */
import type { Server } from 'node:http';
import http from 'node:http';

export type SseChunk = Record<string, unknown>;
export type ScriptAction = SseChunk | 'DESTROY';

export type ScriptedResponse = {
  chunks: ScriptAction[];
  /** Delay between chunks (ms) so mid-stream aborts have a window. */
  delayMs?: number;
};

export type RecordedRequest = {
  body: Record<string, unknown>;
  receivedAt: number;
};

export type ScriptedPiServer = {
  port: number;
  /** Keyed by the LAST user message content on the wire. */
  setScript: (key: string, response: ScriptedResponse) => void;
  /** Sequential scripts: request N serves responses[N]; when exhausted, the
   * last response repeats (multi-step tool turns need different scripts per
   * model request). */
  setScriptSequence: (key: string, responses: ScriptedResponse[]) => void;
  countRequests: (key: string) => number;
  totalRequests: () => number;
  getWire: (key: string, nth?: number) => Record<string, unknown>;
  close: () => Promise<void>;
};

const delta = (text: string): SseChunk => ({
  id: 'chatcmpl-scripted',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'scripted',
  choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
});

const toolCallDelta = (id: string | null, name: string | null, argsText: string): SseChunk => ({
  id: 'chatcmpl-scripted',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'scripted',
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: argsText } }],
      },
      finish_reason: null,
    },
  ],
});

const finish = (reason: string, usage?: Record<string, unknown>): SseChunk => ({
  id: 'chatcmpl-scripted',
  object: 'chat.completion.chunk',
  created: 0,
  model: 'scripted',
  choices: [{ index: 0, delta: {}, finish_reason: reason }],
  ...(usage ? { usage } : {}),
});

export const sse = { delta, toolCallDelta, finish };

export const createScriptedPiServer = (): Promise<ScriptedPiServer> =>
  new Promise(resolve => {
    const scripts = new Map<string, ScriptedResponse>();
    const sequences = new Map<string, ScriptedResponse[]>();
    const received = new Map<string, RecordedRequest[]>();
    let total = 0;

    const server: Server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => {
        body += c;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body) as Record<string, unknown>;
        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        const lastUser = [...messages]
          .reverse()
          .find(m => (m as { role?: string }).role === 'user') as
          | { content?: string }
          | undefined;
        const key = typeof lastUser?.content === 'string' ? lastUser.content : 'default';
        const sequence = sequences.get(key);
        const script = sequence && sequence.length > 0 ? sequence.shift()! : scripts.get(key);
        const log = received.get(key) ?? [];
        log.push({ body: parsed, receivedAt: Date.now() });
        received.set(key, log);
        total += 1;

        if (!script) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: { message: `no script for key: ${key}` } }));
          return;
        }

        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        });
        let i = 0;
        const tick = () => {
          if (res.writableEnded) return;
          if (i >= script.chunks.length) {
            res.end();
            return;
          }
          const action = script.chunks[i++];
          if (action === 'DESTROY') {
            res.destroy();
            return;
          }
          res.write(`data: ${JSON.stringify(action)}\n\n`);
          setTimeout(tick, script.delayMs ?? 0);
        };
        tick();
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      resolve({
        port: address.port,
        setScript: (key, response) => scripts.set(key, response),
        setScriptSequence: (key, responses) => sequences.set(key, responses),
        countRequests: key => (received.get(key) ?? []).length,
        totalRequests: () => total,
        getWire: (key, nth = 0) => {
          const log = received.get(key) ?? [];
          if (!log[nth]) throw new Error(`no wire capture for key ${key} #${nth}`);
          return log[nth].body;
        },
        close: () => new Promise((done, fail) => server.close(err => (err ? fail(err) : done()))),
      });
    });
  });
