// Minimal CDP client over global WebSocket + fetch, for driving the iKi renderer.
const CDP_PORT = Number(process.env.CDP_PORT || 18731);

const getTargets = async () =>
  (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();

export const findRendererTarget = async () => {
  const targets = await getTargets();
  const pages = targets.filter(t => t.type === 'page' && !/devtools/i.test(t.url));
  // Skip the companion overlay window; keep the main window whatever its hash.
  return pages.find(t => !t.url.includes('#companion')) || pages[0] || null;
};

export const connect = async wsUrl => {
  const ws = new WebSocket(wsUrl);
  await Promise.race([
    new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new Error(`CDP connect failed: ${wsUrl}`));
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('CDP connect timed out')), 5000)
    ),
  ]);
  let seq = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  return {
    send,
    // Evaluate a synchronous expression in the page; returns the JSON value.
    // Times out (hash navigation can destroy the context mid-call).
    eval: async (expression, { timeoutMs = 8000 } = {}) => {
      const call = send('Runtime.evaluate', {
        expression,
        awaitPromise: false,
        returnByValue: true,
        replMode: true,
      });
      const result = await Promise.race([
        call,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`page eval timed out: ${expression.slice(0, 80)}`)), timeoutMs)
        ),
      ]);
      if (result.exceptionDetails) {
        throw new Error(`page eval failed: ${result.exceptionDetails.text} ${result.exceptionDetails.exception?.description || ''}`);
      }
      return result.result.value;
    },
    close: () => ws.close(),
  };
};

export const waitFor = async (fn, { timeoutMs = 30000, intervalMs = 400, label = 'condition' } = {}) => {
  const start = Date.now();
  for (;;) {
    const value = await fn().catch(error => {
      throw new Error(`waitFor(${label}) probe threw: ${error.message}`);
    });
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`waitFor(${label}) timed out after ${timeoutMs}ms`);
    await new Promise(r => setTimeout(r, intervalMs));
  }
};
