#!/usr/bin/env node

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const net = require('node:net');
const { createHash } = require('node:crypto');
const { spawn } = require('node:child_process');

const WebSocket = require('ws');

const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_LIMIT = Number.POSITIVE_INFINITY;
const DEFAULT_PARALLEL = 1;
const DEFAULT_BENCHMARK = 'generic';
const DEFAULT_DAEMON_URL = 'http://127.0.0.1:6127';
const BROWSECOMP_OFFICIAL_DATASET_URL =
  'https://openaipublic.blob.core.windows.net/simple-evals/browse_comp_test_set.csv';
const BROWSECOMP_QUERY_TEMPLATE = `
{Question}

Your response should be in the following format:
Explanation: {your explanation for your final answer}
Exact Answer: {your succinct, final answer}
Confidence: {your confidence score between 0% and 100% for your answer}
`.trim();
const BROWSECOMP_GRADER_TEMPLATE = `
Judge whether the following [response] to [question] is correct or not based on the precise and unambiguous [correct_answer] below.

[question]: {question}
[response]: {response}

Your judgement must be in the format and criteria specified below:
extracted_final_answer: The final exact answer extracted from the [response]. Put the extracted answer as 'None' if there is no exact, final answer to extract from the response.
[correct_answer]: {correct_answer}
reasoning: Explain why the extracted_final_answer is correct or incorrect based on [correct_answer], focusing only on if there are meaningful differences between [correct_answer] and the extracted_final_answer. Do not comment on any background to the problem, do not attempt to solve the problem, do not argue for any answer different than [correct_answer], focus only on whether the answers match.
correct: Answer 'yes' if extracted_final_answer matches the [correct_answer] given above, or is within a small margin of error for numerical problems. Answer 'no' otherwise, i.e. if there if there is any inconsistency, ambiguity, non-equivalency, or if the extracted answer is incorrect.
confidence: The extracted confidence score between 0|%| and 100|%| from [response]. Put 100 if there is no confidence score available.
`.trim();

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const normalizeProviderType = value => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().toLowerCase();
  return trimmed;
};

const parseArgs = argv => {
  const parsed = {
    benchmark: DEFAULT_BENCHMARK,
    host: '127.0.0.1',
    healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    streamTimeoutMs: DEFAULT_STREAM_TIMEOUT_MS,
    limit: DEFAULT_LIMIT,
    parallel: DEFAULT_PARALLEL,
    spawnDaemon: false,
    keepDaemon: false,
    keepProfile: false,
    browsecompOfficial: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    const consumeValue = () => {
      if (!next || next.startsWith('--')) {
        throw new Error(`Missing value for --${key}`);
      }
      index += 1;
      return next;
    };

    switch (key) {
      case 'tasks':
        parsed.tasksPath = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'provider':
        parsed.providerType = consumeValue();
        break;
      case 'model':
        parsed.model = consumeValue();
        break;
      case 'benchmark':
        parsed.benchmark = consumeValue().trim() || DEFAULT_BENCHMARK;
        break;
      case 'daemon-url':
        parsed.daemonUrl = consumeValue();
        break;
      case 'host':
        parsed.host = consumeValue();
        break;
      case 'port':
        parsed.port = Number.parseInt(consumeValue(), 10);
        break;
      case 'spawn-daemon':
        parsed.spawnDaemon = true;
        break;
      case 'keep-daemon':
        parsed.keepDaemon = true;
        break;
      case 'user-data-path':
        parsed.userDataPath = consumeValue();
        break;
      case 'keep-profile':
        parsed.keepProfile = true;
        break;
      case 'client-id':
        parsed.clientId = consumeValue();
        break;
      case 'client-token':
        parsed.clientToken = consumeValue();
        break;
      case 'bootstrap-token':
        parsed.bootstrapToken = consumeValue();
        break;
      case 'client-name':
        parsed.clientName = consumeValue();
        break;
      case 'tools':
        parsed.tools = consumeValue();
        break;
      case 'skill-mode':
        parsed.skillMode = consumeValue();
        break;
      case 'limit':
        parsed.limit = Number.parseInt(consumeValue(), 10);
        break;
      case 'parallel':
        parsed.parallel = Number.parseInt(consumeValue(), 10);
        break;
      case 'health-timeout-ms':
        parsed.healthTimeoutMs = Number.parseInt(consumeValue(), 10);
        break;
      case 'stream-timeout-ms':
        parsed.streamTimeoutMs = Number.parseInt(consumeValue(), 10);
        break;
      case 'max-iterations':
        parsed.maxIterations = Number.parseInt(consumeValue(), 10);
        break;
      case 'judge-provider':
        parsed.judgeProviderType = consumeValue();
        break;
      case 'judge-model':
        parsed.judgeModel = consumeValue();
        break;
      case 'browsecomp-official':
        parsed.browsecompOfficial = true;
        break;
      case 'browsecomp-url':
        parsed.browsecompUrl = consumeValue();
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  parsed.providerType = normalizeProviderType(parsed.providerType);
  parsed.judgeProviderType = normalizeProviderType(parsed.judgeProviderType);

  if (!parsed.providerType) throw new Error('Missing required --provider');
  if (!parsed.model) throw new Error('Missing required --model');

  const benchmark = parsed.benchmark.trim().toLowerCase();
  if (!parsed.tasksPath && !(benchmark === 'browsecomp' || parsed.browsecompOfficial)) {
    throw new Error('Missing required --tasks');
  }

  if (!Number.isFinite(parsed.limit) || parsed.limit <= 0) {
    parsed.limit = DEFAULT_LIMIT;
  }
  if (!Number.isFinite(parsed.parallel) || parsed.parallel <= 0) {
    parsed.parallel = DEFAULT_PARALLEL;
  }
  if (!Number.isFinite(parsed.healthTimeoutMs) || parsed.healthTimeoutMs <= 0) {
    parsed.healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS;
  }
  if (!Number.isFinite(parsed.streamTimeoutMs) || parsed.streamTimeoutMs <= 0) {
    parsed.streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS;
  }
  if (
    parsed.maxIterations !== undefined &&
    (!Number.isFinite(parsed.maxIterations) || parsed.maxIterations <= 0)
  ) {
    delete parsed.maxIterations;
  }

  return parsed;
};

const parseList = value =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
    : [];

const getDefaultToolsForBenchmark = benchmark => {
  switch (benchmark.trim().toLowerCase()) {
    case 'browsecomp':
      return ['web', 'fetch'];
    case 'gaia':
      return ['web', 'fetch'];
    default:
      return [];
  }
};

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const findOpenPort = async host =>
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port =
        typeof address === 'object' && address && Number.isInteger(address.port)
          ? address.port
          : null;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }
        if (!port) {
          reject(new Error('Failed to resolve an available port'));
          return;
        }
        resolve(port);
      });
    });
  });

const deriveDaemonUrl = ({ daemonUrl, host, port }) => {
  if (typeof daemonUrl === 'string' && daemonUrl.trim()) {
    return daemonUrl.trim().replace(/\/+$/g, '');
  }

  if (host && port) {
    return `http://${host}:${port}`;
  }

  return DEFAULT_DAEMON_URL;
};

const toWsUrl = baseUrl => {
  const parsed = new URL(baseUrl);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  parsed.pathname = '/v1/chat/stream';
  parsed.search = '';
  return parsed.toString();
};

const readBootstrapToken = async userDataPath => {
  const tokenPath = path.join(userDataPath, 'daemon.token');
  return (await fsp.readFile(tokenPath, 'utf8')).trim();
};

const parseCsvRecords = text => {
  const rows = [];
  let currentField = '';
  let currentRow = [];
  let inQuotes = false;

  const pushField = () => {
    currentRow.push(currentField);
    currentField = '';
  };

  const pushRow = () => {
    if (currentRow.length === 0) return;
    rows.push(currentRow);
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        index += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (!inQuotes && char === ',') {
      pushField();
      continue;
    }

    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      pushField();
      pushRow();
      continue;
    }

    currentField += char;
  }

  pushField();
  pushRow();

  if (rows.length === 0) return [];
  const header = rows.shift().map(value => value.trim());

  return rows
    .filter(row => row.some(value => value.trim().length > 0))
    .map(row => {
      const record = {};
      for (let index = 0; index < header.length; index += 1) {
        record[header[index]] = row[index] ?? '';
      }
      return record;
    });
};

const deriveBrowseCompKey = (password, length) => {
  const digest = createHash('sha256').update(password).digest();
  const output = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    output[index] = digest[index % digest.length];
  }
  return output;
};

const decryptBrowseCompCiphertext = (ciphertextB64, password) => {
  const encrypted = Buffer.from(ciphertextB64 || '', 'base64');
  const key = deriveBrowseCompKey(password || '', encrypted.length);
  const output = Buffer.alloc(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) {
    output[index] = encrypted[index] ^ key[index];
  }
  return output.toString('utf8');
};

const buildBrowseCompPrompt = question =>
  BROWSECOMP_QUERY_TEMPLATE.replace('{Question}', String(question || '').trim());

const extractBrowseCompExactAnswer = responseText => {
  const text = typeof responseText === 'string' ? responseText : '';
  const match = text.match(/(?:^|\n)\s*Exact Answer:\s*([\s\S]*?)(?:\n\s*Confidence:|$)/i);
  if (!match || typeof match[1] !== 'string') return '';
  return match[1].trim();
};

const extractBrowseCompConfidence = responseText => {
  const text = typeof responseText === 'string' ? responseText : '';
  const match = text.match(/(?:^|\n)\s*Confidence:\s*([^\n]+)/i);
  return match && typeof match[1] === 'string' ? match[1].trim() : '';
};

const buildBrowseCompJudgePrompt = ({ question, correctAnswer, response }) =>
  BROWSECOMP_GRADER_TEMPLATE.replace('{question}', question)
    .replace('{correct_answer}', correctAnswer)
    .replace('{response}', response);

const normalizeComparableAnswer = value =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

const compareBrowseCompAnswersPreview = (expected, actual) => {
  const normalizedExpected = normalizeComparableAnswer(expected);
  const normalizedActual = normalizeComparableAnswer(actual);
  if (!normalizedExpected || !normalizedActual) return false;
  if (normalizedExpected === normalizedActual) return true;

  const expectedNumber = Number(normalizedExpected);
  const actualNumber = Number(normalizedActual);
  if (Number.isFinite(expectedNumber) && Number.isFinite(actualNumber)) {
    const tolerance = Math.max(1e-9, Math.abs(expectedNumber) * 1e-6);
    return Math.abs(expectedNumber - actualNumber) <= tolerance;
  }

  return false;
};

const normalizeTask = (task, index) => {
  if (!task || typeof task !== 'object' || Array.isArray(task)) {
    throw new Error(`Task ${index + 1} is not a valid object`);
  }

  const rawId =
    (typeof task.id === 'string' && task.id.trim()) ||
    (typeof task.task_id === 'string' && task.task_id.trim()) ||
    (typeof task.sample_id === 'string' && task.sample_id.trim()) ||
    `task_${index + 1}`;

  const messages = Array.isArray(task.messages) ? task.messages : null;
  const prompt =
    typeof task.prompt === 'string'
      ? task.prompt
      : typeof task.question === 'string'
        ? task.question
        : '';

  if ((!messages || messages.length === 0) && !prompt.trim()) {
    throw new Error(`Task "${rawId}" must define prompt or messages`);
  }

  return {
    id: rawId,
    prompt: prompt.trim(),
    messages:
      messages && messages.length > 0
        ? messages
        : [{ role: 'user', content: prompt.trim() }],
    expectedAnswer:
      typeof task.expectedAnswer === 'string'
        ? task.expectedAnswer
        : typeof task.expected_answer === 'string'
          ? task.expected_answer
          : '',
    scoring:
      task.scoring && typeof task.scoring === 'object' && !Array.isArray(task.scoring)
        ? task.scoring
        : null,
    tools: Array.isArray(task.tools) ? task.tools.filter(value => typeof value === 'string') : null,
    metadata:
      task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata
        : null,
  };
};

const loadTasksFromFile = async tasksPath => {
  const absolutePath = path.resolve(tasksPath);
  const raw = await fsp.readFile(absolutePath, 'utf8');

  if (absolutePath.endsWith('.jsonl')) {
    return raw
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => normalizeTask(JSON.parse(line), index));
  }

  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) {
    return parsed.map((task, index) => normalizeTask(task, index));
  }

  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.tasks)) {
    return parsed.tasks.map((task, index) => normalizeTask(task, index));
  }

  throw new Error('Task file must be a JSON array, JSON object with tasks[], or JSONL');
};

const loadBrowseCompOfficialTasks = async ({ datasetUrl }) => {
  const response = await fetch(datasetUrl || BROWSECOMP_OFFICIAL_DATASET_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch BrowseComp dataset (${response.status})`);
  }

  const csvText = await response.text();
  const rows = parseCsvRecords(csvText);
  return rows.map((row, index) => {
    const canary = typeof row.canary === 'string' ? row.canary : '';
    const question = decryptBrowseCompCiphertext(row.problem || '', canary);
    const expectedAnswer = decryptBrowseCompCiphertext(row.answer || '', canary);
    return normalizeTask(
      {
        id:
          (typeof row.id === 'string' && row.id.trim()) ||
          (typeof row.problem_id === 'string' && row.problem_id.trim()) ||
          `browsecomp_${index + 1}`,
        prompt: buildBrowseCompPrompt(question),
        expectedAnswer,
        scoring: {
          type: 'browsecomp-preview',
        },
        tools: ['web', 'fetch'],
        metadata: {
          benchmark: 'browsecomp',
          source: 'official',
          question,
        },
      },
      index
    );
  });
};

const loadTasks = async options => {
  const benchmark = options.benchmark.trim().toLowerCase();
  if (benchmark === 'browsecomp' && !options.tasksPath) {
    return await loadBrowseCompOfficialTasks({
      datasetUrl: options.browsecompUrl,
    });
  }

  return await loadTasksFromFile(options.tasksPath);
};

const buildHeaders = ({ clientId, clientToken, extraHeaders }) => ({
  Authorization: `Bearer ${clientToken}`,
  'X-Iki-Client': clientId,
  ...(extraHeaders || {}),
});

const requestJson = async (url, options = {}) => {
  const response = await fetch(url, options);
  let payload = null;
  const text = await response.text();
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }
  return { response, payload };
};

const waitForDaemonHealth = async ({ daemonUrl, timeoutMs }) => {
  const start = Date.now();
  let lastError = null;
  while (Date.now() - start < timeoutMs) {
    try {
      const { response, payload } = await requestJson(`${daemonUrl}/v1/health`);
      if (response.ok && payload && payload.success) {
        return payload;
      }
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
  throw new Error(
    `Timed out waiting for daemon health check after ${timeoutMs}ms` +
      (lastError ? `: ${String(lastError.message || lastError)}` : '')
  );
};

const registerClient = async ({ daemonUrl, clientName, bootstrapToken, allowedTools }) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/clients/register`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-iki-setup-token': bootstrapToken,
    },
    body: JSON.stringify({
      name: clientName || 'iKi Benchmark Harness',
      scopes: ['chat:read', 'chat:write', 'tools:run', 'tools:approve'],
      allowed_tools: allowedTools,
    }),
  });

  if (!response.ok || !payload?.success || !payload.client_id || !payload.token) {
    throw new Error(
      `Failed to register daemon client (${response.status}): ${JSON.stringify(payload)}`
    );
  }

  return {
    clientId: payload.client_id,
    clientToken: payload.token,
  };
};

const createThread = async ({ daemonUrl, clientId, clientToken, title, model }) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/chat/threads`, {
    method: 'POST',
    headers: {
      ...buildHeaders({ clientId, clientToken }),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      title,
      model,
    }),
  });

  if (!response.ok || !payload?.success || !payload.thread?.id) {
    throw new Error(`Failed to create thread (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload.thread;
};

const sendChat = async ({
  daemonUrl,
  clientId,
  clientToken,
  providerType,
  model,
  messages,
  tools,
  skillMode,
  threadId,
}) => {
  const { response, payload } = await requestJson(`${daemonUrl}/v1/chat/send`, {
    method: 'POST',
    headers: {
      ...buildHeaders({ clientId, clientToken }),
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      providerType,
      model,
      messages,
      ...(Array.isArray(tools) ? { tools } : {}),
      ...(typeof skillMode === 'string' ? { skillMode } : {}),
      ...(typeof threadId === 'string' && threadId.trim() ? { thread_id: threadId.trim() } : {}),
    }),
  });

  if (!response.ok || !payload?.success) {
    throw new Error(`Chat send failed (${response.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
};

const sanitizeFileName = value => value.replace(/[^a-zA-Z0-9._-]+/g, '_');

const finalizeAssistantText = chunks => {
  const deltas = [];
  for (const chunk of chunks) {
    if (
      chunk &&
      typeof chunk === 'object' &&
      chunk.type === 'text-delta' &&
      typeof chunk.delta === 'string'
    ) {
      deltas.push(chunk.delta);
    }
  }
  return deltas.join('');
};

const resolvePredictionText = ({ chunks, daemonResult }) => {
  const streamedText = finalizeAssistantText(chunks);
  if (streamedText) return streamedText;

  if (
    daemonResult &&
    typeof daemonResult === 'object' &&
    typeof daemonResult.text === 'string' &&
    daemonResult.text.trim()
  ) {
    return daemonResult.text;
  }

  return '';
};

const scorePrediction = async ({
  task,
  prediction,
  benchmark,
  judgeProviderType,
  judgeModel,
  daemonContext,
}) => {
  const expected = task.expectedAnswer.trim();
  if (!expected) return null;

  const scoring = task.scoring || {};
  const scoringType =
    typeof scoring.type === 'string' && scoring.type.trim()
      ? scoring.type.trim().toLowerCase()
      : 'exact';

  if (benchmark === 'browsecomp' || scoringType === 'browsecomp-preview') {
    const extractedAnswer = extractBrowseCompExactAnswer(prediction);
    const extractedConfidence = extractBrowseCompConfidence(prediction);

    if (judgeProviderType && judgeModel && daemonContext) {
      const judgePrompt = buildBrowseCompJudgePrompt({
        question:
          (task.metadata &&
            typeof task.metadata === 'object' &&
            typeof task.metadata.question === 'string' &&
            task.metadata.question) ||
          task.prompt,
        correctAnswer: expected,
        response: prediction,
      });

      const judgeResult = await sendChat({
        daemonUrl: daemonContext.daemonUrl,
        clientId: daemonContext.clientId,
        clientToken: daemonContext.clientToken,
        providerType: judgeProviderType,
        model: judgeModel,
        messages: [{ role: 'user', content: judgePrompt }],
        tools: [],
      });

      const judgeText = typeof judgeResult.text === 'string' ? judgeResult.text : '';
      const correctnessMatch = judgeText.match(/correct:\s*(yes|no)/i);
      return {
        type: 'browsecomp-judge',
        passed: correctnessMatch ? correctnessMatch[1].toLowerCase() === 'yes' : false,
        expected,
        extractedAnswer,
        extractedConfidence,
        judgeModel,
        judgeProviderType,
        judgeText,
      };
    }

    return {
      type: 'browsecomp-preview',
      passed: compareBrowseCompAnswersPreview(expected, extractedAnswer),
      expected,
      extractedAnswer,
      extractedConfidence,
    };
  }

  if (scoringType === 'contains') {
    return {
      type: 'contains',
      passed: prediction.includes(expected),
      expected,
    };
  }

  if (scoringType === 'regex') {
    const flags =
      typeof scoring.flags === 'string' && scoring.flags.trim() ? scoring.flags.trim() : '';
    const regex = new RegExp(expected, flags);
    return {
      type: 'regex',
      passed: regex.test(prediction),
      expected,
      flags,
    };
  }

  return {
    type: 'exact',
    passed: prediction.trim() === expected,
    expected,
  };
};

const streamTask = async ({ daemonUrl, clientId, clientToken, requestId, payload, timeoutMs }) =>
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(toWsUrl(daemonUrl), {
      headers: buildHeaders({ clientId, clientToken }),
    });

    const chunks = [];
    const daemonEvents = [];
    let settled = false;
    let ready = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      reject(new Error(`Stream timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}
      resolve(result);
    };

    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {}
      reject(error);
    };

    ws.on('message', rawData => {
      let parsed;
      try {
        parsed = JSON.parse(String(rawData));
      } catch (error) {
        fail(new Error(`Received non-JSON WebSocket payload: ${String(error.message || error)}`));
        return;
      }

      if (parsed && typeof parsed === 'object' && parsed.channel === 'daemon' && parsed.payload) {
        daemonEvents.push(parsed.payload);
        if (parsed.payload.type === 'ready') {
          ready = true;
          ws.send(
            JSON.stringify({
              type: 'start',
              request_id: requestId,
              payload,
            })
          );
          return;
        }

        if (parsed.payload.type === 'error') {
          fail(new Error(parsed.payload.error || 'Daemon stream error'));
          return;
        }

        if (parsed.payload.type === 'stream-result') {
          finish({
            daemonResult: parsed.payload,
            daemonEvents,
            chunks,
          });
          return;
        }

        return;
      }

      chunks.push(parsed);
    });

    ws.on('error', error => {
      fail(error);
    });

    ws.on('close', () => {
      if (!settled && !ready) {
        fail(new Error('WebSocket closed before daemon ready event'));
      } else if (!settled) {
        fail(new Error('WebSocket closed before stream completed'));
      }
    });
  });

const mapWithConcurrency = async ({ items, parallel, worker }) => {
  const results = new Array(items.length);
  let nextIndex = 0;

  const claimNextIndex = () => {
    if (nextIndex >= items.length) return null;
    const claimed = nextIndex;
    nextIndex += 1;
    return claimed;
  };

  const workerCount = Math.max(1, Math.min(items.length, parallel));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const currentIndex = claimNextIndex();
        if (currentIndex === null) {
          return;
        }
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      }
    })
  );

  return results;
};

const spawnDaemonProcess = async ({ host, port, userDataPath }) => {
  const daemonScriptPath = path.join(__dirname, '..', 'start-daemon.cjs');
  const child = spawn(process.execPath, [daemonScriptPath], {
    env: {
      ...process.env,
      IKI_USER_DATA_PATH: userDataPath,
      IKI_DAEMON_HOST: host,
      IKI_DAEMON_PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const forward = (stream, label) => {
    stream.on('data', chunk => {
      const text = String(chunk);
      if (!text) return;
      process.stderr.write(`[benchmark-daemon:${label}] ${text}`);
    });
  };

  if (child.stdout) forward(child.stdout, 'stdout');
  if (child.stderr) forward(child.stderr, 'stderr');

  child.on('error', error => {
    process.stderr.write(`[benchmark-daemon:error] ${String(error.message || error)}\n`);
  });

  return child;
};

const writeBenchmarkOutputs = async ({ outputDir, summary, taskResults, predictions, benchmark }) => {
  await fsp.writeFile(
    path.join(outputDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(outputDir, 'results.json'),
    `${JSON.stringify(taskResults, null, 2)}\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(outputDir, 'predictions.jsonl'),
    `${predictions.map(entry => JSON.stringify(entry)).join('\n')}\n`,
    'utf8'
  );

  if (benchmark === 'browsecomp') {
    await fsp.writeFile(
      path.join(outputDir, 'browsecomp.predictions.jsonl'),
      `${predictions
        .map(entry =>
          JSON.stringify({
            id: entry.id,
            response: entry.prediction,
            extracted_exact_answer: entry.extractedExactAnswer || '',
            extracted_confidence: entry.extractedConfidence || '',
            error: entry.error || null,
          })
        )
        .join('\n')}\n`,
      'utf8'
    );
  }
};

const runBenchmarkTask = async ({
  task,
  taskIndex,
  totalTasks,
  benchmark,
  options,
  daemonContext,
  resolvedTools,
  taskOutputDir,
}) => {
  const taskStarted = Date.now();
  const requestId = `${sanitizeFileName(task.id)}_${Date.now()}`;
  let threadId = null;

  try {
    const thread = await createThread({
      daemonUrl: daemonContext.daemonUrl,
      clientId: daemonContext.clientId,
      clientToken: daemonContext.clientToken,
      title: `[${benchmark}] ${task.id}`,
      model: options.model,
    });
    threadId = thread.id;

      const streamPayload = {
        providerType: options.providerType,
        model: options.model,
        thread_id: thread.id,
        messages: task.messages,
        ...(typeof options.maxIterations === 'number'
          ? { maxIterations: options.maxIterations }
          : {}),
        ...(resolvedTools.length > 0 ? { tools: resolvedTools } : {}),
        ...(task.tools && task.tools.length > 0 ? { tools: task.tools } : {}),
        ...(options.skillMode ? { skillMode: options.skillMode } : {}),
    };

    const streamResult = await streamTask({
      daemonUrl: daemonContext.daemonUrl,
      clientId: daemonContext.clientId,
      clientToken: daemonContext.clientToken,
      requestId,
      payload: streamPayload,
      timeoutMs: options.streamTimeoutMs,
    });

    const prediction = resolvePredictionText({
      chunks: streamResult.chunks,
      daemonResult: streamResult.daemonResult,
    });
    const score = await scorePrediction({
      task,
      prediction,
      benchmark,
      judgeProviderType: options.judgeProviderType,
      judgeModel: options.judgeModel,
      daemonContext,
    });
    const durationMs = Date.now() - taskStarted;
    const extractedExactAnswer =
      benchmark === 'browsecomp' ? extractBrowseCompExactAnswer(prediction) : '';
    const extractedConfidence =
      benchmark === 'browsecomp' ? extractBrowseCompConfidence(prediction) : '';

    const taskRecord = {
      id: task.id,
      success: Boolean(streamResult.daemonResult?.success),
      threadId,
      requestId,
      durationMs,
      prediction,
      expectedAnswer: task.expectedAnswer || null,
      score,
      ...(extractedExactAnswer ? { extractedExactAnswer } : {}),
      ...(extractedConfidence ? { extractedConfidence } : {}),
      chunkCount: streamResult.chunks.length,
      daemonResult: streamResult.daemonResult,
      daemonEvents: streamResult.daemonEvents,
      chunks: streamResult.chunks,
      metadata: task.metadata,
    };

    await fsp.writeFile(
      path.join(taskOutputDir, `${sanitizeFileName(task.id)}.json`),
      `${JSON.stringify(taskRecord, null, 2)}\n`,
      'utf8'
    );

    return {
      taskIndex,
      totalTasks,
      taskRecord,
      predictionRecord: {
        id: task.id,
        prediction,
        ...(extractedExactAnswer ? { extractedExactAnswer } : {}),
        ...(extractedConfidence ? { extractedConfidence } : {}),
      },
      ok: true,
    };
  } catch (error) {
    const durationMs = Date.now() - taskStarted;
    const taskRecord = {
      id: task.id,
      success: false,
      threadId,
      requestId,
      durationMs,
      prediction: '',
      expectedAnswer: task.expectedAnswer || null,
      score: null,
      error: String(error && error.message ? error.message : error),
      metadata: task.metadata,
    };

    await fsp.writeFile(
      path.join(taskOutputDir, `${sanitizeFileName(task.id)}.json`),
      `${JSON.stringify(taskRecord, null, 2)}\n`,
      'utf8'
    );

    return {
      taskIndex,
      totalTasks,
      taskRecord,
      predictionRecord: {
        id: task.id,
        prediction: '',
        error: taskRecord.error,
      },
      ok: false,
    };
  }
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  const benchmark = options.benchmark.trim().toLowerCase() || DEFAULT_BENCHMARK;
  const defaultTools = getDefaultToolsForBenchmark(benchmark);
  const explicitTools = parseList(options.tools);
  const resolvedTools = explicitTools.length > 0 ? explicitTools : defaultTools;

  if (options.spawnDaemon && !options.userDataPath) {
    throw new Error(
      'Benchmark daemon runs require --user-data-path pointing to a preconfigured iKi profile. ' +
        'Spawning a brand-new temporary profile would not include any enabled providers yet.'
    );
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDir = path.resolve(
    options.outputDir || path.join('benchmark-runs', `${benchmark}-${timestamp}`)
  );
  const taskOutputDir = path.join(outputDir, 'tasks');
  await ensureDir(taskOutputDir);

  const allTasks = await loadTasks(options);
  const tasks = allTasks.slice(0, Math.min(allTasks.length, options.limit));
  if (tasks.length === 0) {
    throw new Error('No tasks to run after applying --limit');
  }

  let userDataPath = options.userDataPath ? path.resolve(options.userDataPath) : '';
  let daemonChild = null;
  let daemonHost = options.host;
  let daemonPort = Number.isInteger(options.port) ? options.port : null;
  let daemonUrl = options.daemonUrl || '';

  if (options.spawnDaemon) {
    if (userDataPath) {
      await ensureDir(userDataPath);
    }

    if (!daemonPort) {
      daemonPort = await findOpenPort(daemonHost);
    }

    daemonUrl = deriveDaemonUrl({
      host: daemonHost,
      port: daemonPort,
      daemonUrl: options.daemonUrl,
    });

    daemonChild = await spawnDaemonProcess({
      host: daemonHost,
      port: daemonPort,
      userDataPath,
    });
  } else {
    daemonUrl = deriveDaemonUrl({
      daemonUrl: options.daemonUrl,
      host: daemonHost,
      port: daemonPort,
    });
  }

  const cleanup = async () => {
    if (daemonChild && !options.keepDaemon && !daemonChild.killed) {
      daemonChild.kill('SIGTERM');
    }
  };

  process.on('SIGINT', () => {
    void cleanup().finally(() => process.exit(130));
  });
  process.on('SIGTERM', () => {
    void cleanup().finally(() => process.exit(143));
  });

  try {
    const health = await waitForDaemonHealth({
      daemonUrl,
      timeoutMs: options.healthTimeoutMs,
    });

    let clientId = options.clientId || '';
    let clientToken = options.clientToken || '';
    if (!clientId || !clientToken) {
      const bootstrapToken = options.bootstrapToken || (userDataPath ? await readBootstrapToken(userDataPath) : '');
      if (!bootstrapToken) {
        throw new Error(
          'Missing daemon credentials. Provide --client-id and --client-token, or use ' +
            '--spawn-daemon / --user-data-path / --bootstrap-token so the harness can register.'
        );
      }

      const registered = await registerClient({
        daemonUrl,
        bootstrapToken,
        clientName: options.clientName,
        allowedTools: resolvedTools,
      });
      clientId = registered.clientId;
      clientToken = registered.clientToken;
    }

    const daemonContext = {
      daemonUrl,
      clientId,
      clientToken,
    };

    const predictionRecords = new Array(tasks.length);
    const taskResults = new Array(tasks.length);
    const startedAt = new Date().toISOString();
    let completedTasks = 0;

    await mapWithConcurrency({
      items: tasks,
      parallel: options.parallel,
      worker: async (task, index) => {
        const taskOutcome = await runBenchmarkTask({
          task,
          taskIndex: index,
          totalTasks: tasks.length,
          benchmark,
          options,
          daemonContext,
          resolvedTools,
          taskOutputDir,
        });

        taskResults[index] = taskOutcome.taskRecord;
        predictionRecords[index] = taskOutcome.predictionRecord;
        completedTasks += 1;

        process.stdout.write(
          `[${completedTasks}/${tasks.length}] ${task.id}: ${taskOutcome.ok ? 'ok' : 'failed'} (${taskOutcome.taskRecord.durationMs}ms)\n`
        );

        return taskOutcome;
      },
    });

    const finalizedTaskResults = taskResults.filter(Boolean);
    const finalizedPredictions = predictionRecords.filter(Boolean);

    const scoredTasks = finalizedTaskResults.filter(
      task => task.score && typeof task.score.passed === 'boolean'
    );
    const passedTasks = scoredTasks.filter(task => task.score.passed);
    const succeededTasks = finalizedTaskResults.filter(task => task.success);
    const summary = {
      benchmark,
      providerType: options.providerType,
      model: options.model,
      ...(options.judgeProviderType && options.judgeModel
        ? {
            judgeProviderType: options.judgeProviderType,
            judgeModel: options.judgeModel,
          }
        : {}),
      daemonUrl,
      daemonHealth: health,
      userDataPath: userDataPath || null,
      tools: resolvedTools,
      ...(typeof options.maxIterations === 'number' ? { maxIterations: options.maxIterations } : {}),
      parallel: options.parallel,
      startedAt,
      finishedAt: new Date().toISOString(),
      totalTasks: finalizedTaskResults.length,
      succeededTasks: succeededTasks.length,
      failedTasks: finalizedTaskResults.length - succeededTasks.length,
      scoredTasks: scoredTasks.length,
      passedTasks: passedTasks.length,
      passRate: scoredTasks.length > 0 ? passedTasks.length / scoredTasks.length : null,
    };

    await writeBenchmarkOutputs({
      outputDir,
      summary,
      taskResults: finalizedTaskResults,
      predictions: finalizedPredictions,
      benchmark,
    });

    process.stdout.write(`Wrote benchmark artifacts to ${outputDir}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } finally {
    await cleanup();
  }
};

module.exports = {
  BROWSECOMP_OFFICIAL_DATASET_URL,
  BROWSECOMP_QUERY_TEMPLATE,
  BROWSECOMP_GRADER_TEMPLATE,
  parseArgs,
  parseCsvRecords,
  deriveBrowseCompKey,
  decryptBrowseCompCiphertext,
  buildBrowseCompPrompt,
  extractBrowseCompExactAnswer,
  extractBrowseCompConfidence,
  buildBrowseCompJudgePrompt,
  compareBrowseCompAnswersPreview,
  normalizeTask,
  loadBrowseCompOfficialTasks,
  loadTasks,
  scorePrediction,
  mapWithConcurrency,
  resolvePredictionText,
};

if (require.main === module) {
  void main().catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
