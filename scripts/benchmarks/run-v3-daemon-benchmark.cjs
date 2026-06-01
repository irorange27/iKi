#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const {
  extractBehavioralMetrics,
  buildV3DaemonTasks,
} = require('./run-v3-behavioral-matrix.cjs');

const DEFAULT_PARALLEL = 1;
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const readJsonLines = async filePath => {
  const raw = await fsp.readFile(path.resolve(filePath), 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
};

const writeJsonLines = async (filePath, rows) => {
  const serialized = rows.map(row => JSON.stringify(row)).join('\n');
  await fsp.writeFile(filePath, serialized ? `${serialized}\n` : '', 'utf8');
};

const getDefaultDesktopUserDataPath = () => {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'iki');
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'iki');
  }
  const xdgConfigHome = normalizeText(process.env.XDG_CONFIG_HOME);
  return path.join(xdgConfigHome || path.join(os.homedir(), '.config'), 'iki');
};

const parseArgs = argv => {
  const parsed = {
    parallel: DEFAULT_PARALLEL,
    healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    streamTimeoutMs: DEFAULT_STREAM_TIMEOUT_MS,
    maxIterations: 1,
    affectMode: 'explicit_policy',
    contextMode: 'benchmark_clean',
    spawnDaemon: false,
    awaitRealtimeAffect: false,
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
      case 'conversations':
        parsed.conversationsPath = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'provider':
        parsed.providerType = normalizeText(consumeValue()).toLowerCase();
        break;
      case 'model':
        parsed.model = consumeValue();
        break;
      case 'parallel':
        parsed.parallel = Number.parseInt(consumeValue(), 10);
        break;
      case 'daemon-url':
        parsed.daemonUrl = consumeValue();
        break;
      case 'spawn-daemon':
        parsed.spawnDaemon = true;
        break;
      case 'user-data-path':
        parsed.userDataPath = consumeValue();
        break;
      case 'bootstrap-token':
        parsed.bootstrapToken = consumeValue();
        break;
      case 'client-id':
        parsed.clientId = consumeValue();
        break;
      case 'client-token':
        parsed.clientToken = consumeValue();
        break;
      case 'client-name':
        parsed.clientName = consumeValue();
        break;
      case 'skill-mode':
        parsed.skillMode = consumeValue();
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
      case 'affect-mode':
        parsed.affectMode = normalizeText(consumeValue());
        break;
      case 'context-mode':
        parsed.contextMode = normalizeText(consumeValue());
        break;
      case 'await-realtime-affect':
        parsed.awaitRealtimeAffect = true;
        break;
      case 'keep-daemon':
        parsed.keepDaemon = true;
        break;
      case 'keep-intermediate':
        parsed.keepIntermediate = true;
        break;
      case 'profile-latency':
        parsed.profileLatency = true;
        break;
      case 'tools':
        parsed.tools = normalizeText(consumeValue());
        break;
      case 'system-id-suffix':
        parsed.systemIdSuffix = normalizeText(consumeValue());
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.conversationsPath) throw new Error('Missing required --conversations');
  if (!parsed.outputDir) throw new Error('Missing required --output-dir');
  if (!parsed.providerType) throw new Error('Missing required --provider');
  if (!parsed.model) throw new Error('Missing required --model');

  if (!Number.isFinite(parsed.parallel) || parsed.parallel <= 0) {
    parsed.parallel = DEFAULT_PARALLEL;
  }
  if (!Number.isFinite(parsed.healthTimeoutMs) || parsed.healthTimeoutMs <= 0) {
    parsed.healthTimeoutMs = DEFAULT_HEALTH_TIMEOUT_MS;
  }
  if (!Number.isFinite(parsed.streamTimeoutMs) || parsed.streamTimeoutMs <= 0) {
    parsed.streamTimeoutMs = DEFAULT_STREAM_TIMEOUT_MS;
  }
  if (!Number.isFinite(parsed.maxIterations) || parsed.maxIterations <= 0) {
    parsed.maxIterations = 1;
  }

  if (
    parsed.affectMode !== 'no_affect' &&
    parsed.affectMode !== 'tone_only' &&
    parsed.affectMode !== 'explicit_policy'
  ) {
    parsed.affectMode = 'explicit_policy';
  }
  if (parsed.contextMode !== 'default' && parsed.contextMode !== 'benchmark_clean') {
    parsed.contextMode = 'benchmark_clean';
  }

  return parsed;
};

const runNodeScript = async ({ scriptPath, args, cwd }) =>
  new Promise((resolve, reject) => {
    const resolvedScriptPath = path.resolve(scriptPath);
    const child = spawn(process.execPath, [resolvedScriptPath, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      const text = String(chunk);
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on('data', chunk => {
      const text = String(chunk);
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${path.basename(scriptPath)} exited with code ${code}\n${stderr || stdout}`.trim()
        )
      );
    });
  });

const extractToolCallsFromDaemonResult = taskRecord => {
  const toolCalls = [];
  const seen = new Set();

  // Source 1: thread steps
  const thread = taskRecord.thread;
  if (thread && typeof thread === 'object') {
    const steps = thread.steps || thread.agentSteps || [];
    for (const step of steps) {
      if (step.toolCalls && Array.isArray(step.toolCalls)) {
        for (const tc of step.toolCalls) {
          const name = tc.toolName || tc.name || tc.function?.name || 'unknown';
          const key = `${name}::${tc.status || tc.outcome || ''}`;
          if (!seen.has(key)) {
            seen.add(key);
            toolCalls.push({
              toolName: name,
              status: tc.status || tc.outcome || 'unknown',
            });
          }
        }
      }
    }
  }

  // Source 2: stream chunks (daemon emits tool-call events in streaming)
  const chunks = Array.isArray(taskRecord.chunks) ? taskRecord.chunks : [];
  const toolInputAvailable = new Map();
  const toolOutputs = new Map();

  for (const chunk of chunks) {
    if (chunk.type === 'tool-input-available' && chunk.toolCallId && chunk.toolName) {
      toolInputAvailable.set(chunk.toolCallId, chunk.toolName);
    }
    if (chunk.type === 'tool-output-available' && chunk.toolCallId) {
      toolOutputs.set(chunk.toolCallId, 'completed');
    }
    if (chunk.type === 'tool-output-error' && chunk.toolCallId) {
      toolOutputs.set(chunk.toolCallId, 'error');
    }
  }

  for (const [callId, toolName] of toolInputAvailable) {
    const status = toolOutputs.get(callId) || 'unknown';
    const key = `${toolName}::${status}`;
    if (!seen.has(key)) {
      seen.add(key);
      toolCalls.push({ toolName, status });
    }
  }

  return toolCalls;
};

const average = values => {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const round4 = value => {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
};

const computeAggregateMetrics = perSceneMetrics => {
  if (!perSceneMetrics.length) return {};

  const replyLengths = perSceneMetrics.map(m => m.metrics.reply_length_chars).filter(v => Number.isFinite(v));
  const questionRatios = perSceneMetrics.map(m => m.metrics.question_ratio).filter(v => Number.isFinite(v));
  const emotionAcks = perSceneMetrics.map(m => m.metrics.has_emotion_acknowledgment ? 1 : 0);
  const toolCallCounts = perSceneMetrics.map(m => m.metrics.tool_call_count).filter(v => Number.isFinite(v));
  const highRiskCounts = perSceneMetrics.map(m => m.metrics.high_risk_tool_count).filter(v => Number.isFinite(v));
  const highRiskTotalCalls = perSceneMetrics.map(m => m.metrics.tool_call_count).filter(v => Number.isFinite(v));
  const clarifyStance = perSceneMetrics.map(m => m.metrics.interaction_stance === 'clarify' ? 1 : 0);
  const pushForwardStance = perSceneMetrics.map(m => m.metrics.interaction_stance === 'push_forward' ? 1 : 0);
  const neutralStance = perSceneMetrics.map(m => m.metrics.interaction_stance === 'neutral' ? 1 : 0);

  const totalHighRiskCalls = highRiskCounts.reduce((s, v) => s + v, 0);
  const totalToolCalls = highRiskTotalCalls.reduce((s, v) => s + v, 0);

  return {
    scene_count: perSceneMetrics.length,
    avg_reply_length_chars: round4(average(replyLengths)),
    avg_question_ratio: round4(average(questionRatios)),
    emotion_acknowledgment_rate: round4(average(emotionAcks)),
    avg_tool_call_count: round4(average(toolCallCounts)),
    high_risk_tool_rate: totalToolCalls > 0 ? round4(totalHighRiskCalls / totalToolCalls) : 0,
    clarify_stance_rate: round4(average(clarifyStance)),
    push_forward_stance_rate: round4(average(pushForwardStance)),
    neutral_stance_rate: round4(average(neutralStance)),
  };
};

const main = async argv => {
  const options = parseArgs(argv);
  const outputDir = path.resolve(options.outputDir);
  const inputDir = path.join(outputDir, 'inputs');
  const daemonOutputDir = path.join(outputDir, 'daemon');
  await ensureDir(inputDir);
  await ensureDir(daemonOutputDir);

  const conversations = await readJsonLines(options.conversationsPath);
  process.stderr.write(`[v3-daemon] Loaded ${conversations.length} conversations\n`);

  const tasks = buildV3DaemonTasks(conversations, {
    affectMode: options.affectMode,
    contextMode: options.contextMode,
    awaitRealtimeAffect: options.awaitRealtimeAffect,
  });

  const tasksPath = path.join(inputDir, 'tasks.json');
  const conversationsPath = path.join(inputDir, 'conversations.jsonl');
  await fsp.writeFile(tasksPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
  await writeJsonLines(conversationsPath, conversations);

  const daemonArgs = [
    '--benchmark',
    'generic',
    '--tasks',
    tasksPath,
    '--output-dir',
    daemonOutputDir,
    '--provider',
    options.providerType,
    '--model',
    options.model,
    '--parallel',
    String(options.parallel),
    '--health-timeout-ms',
    String(options.healthTimeoutMs),
    '--stream-timeout-ms',
    String(options.streamTimeoutMs),
    '--max-iterations',
    String(options.maxIterations),
  ];

  if (options.daemonUrl) daemonArgs.push('--daemon-url', options.daemonUrl);
  if (options.spawnDaemon) daemonArgs.push('--spawn-daemon');
  if (options.userDataPath) daemonArgs.push('--user-data-path', options.userDataPath);
  if (options.bootstrapToken) daemonArgs.push('--bootstrap-token', options.bootstrapToken);
  if (options.clientId) daemonArgs.push('--client-id', options.clientId);
  if (options.clientToken) daemonArgs.push('--client-token', options.clientToken);
  if (options.clientName) daemonArgs.push('--client-name', options.clientName);
  if (options.skillMode) daemonArgs.push('--skill-mode', options.skillMode);
  if (options.keepDaemon) daemonArgs.push('--keep-daemon');
  if (options.profileLatency) daemonArgs.push('--profile-latency');
  if (options.tools) daemonArgs.push('--tools', options.tools);

  process.stderr.write(`[v3-daemon] Running daemon benchmark...\n`);
  await runNodeScript({
    scriptPath: path.join(path.resolve(__dirname, '..', '..'), 'scripts', 'benchmarks', 'run-daemon-benchmark.cjs'),
    args: daemonArgs,
    cwd: path.resolve(__dirname, '..', '..'),
  }).catch(async error => {
    if (!options.spawnDaemon && !options.daemonUrl) {
      const fallbackUserDataPath = path.resolve(options.userDataPath || getDefaultDesktopUserDataPath());
      process.stderr.write(
        `[v3-daemon] direct daemon connection failed; retrying with --spawn-daemon using ${fallbackUserDataPath}\n`
      );

      const retryArgs = [...daemonArgs, '--spawn-daemon', '--user-data-path', fallbackUserDataPath];
      await runNodeScript({
        scriptPath: path.join(path.resolve(__dirname, '..', '..'), 'scripts', 'benchmarks', 'run-daemon-benchmark.cjs'),
        args: retryArgs,
        cwd: path.resolve(__dirname, '..', '..'),
      });
      return;
    }
    throw error;
  });

  const daemonResults = JSON.parse(
    await fsp.readFile(path.join(daemonOutputDir, 'results.json'), 'utf8')
  );

  const perSceneMetrics = [];
  for (const taskRecord of daemonResults) {
    const sceneId = taskRecord.id || '';
    const assistantResponse = normalizeText(taskRecord.prediction || '');
    const toolCalls = extractToolCallsFromDaemonResult(taskRecord);
    const threadMetadata = taskRecord.thread?.metadata || {};

    const metrics = extractBehavioralMetrics({
      assistantResponse,
      toolCalls,
      threadMetadata,
    });

    perSceneMetrics.push({
      scene_id: sceneId,
      metrics,
      tool_calls_detail: toolCalls,
    });
  }

  const aggregates = computeAggregateMetrics(perSceneMetrics);

  const behavioralMetrics = {
    generatedAt: new Date().toISOString(),
    affectMode: options.affectMode,
    providerType: options.providerType,
    model: options.model,
    totalScenes: conversations.length,
    per_scene: perSceneMetrics,
    aggregates,
  };

  await fsp.writeFile(
    path.join(outputDir, 'behavioral-metrics.json'),
    `${JSON.stringify(behavioralMetrics, null, 2)}\n`,
    'utf8'
  );

  const runSummary = {
    providerType: options.providerType,
    model: options.model,
    affectMode: options.affectMode,
    contextMode: options.contextMode,
    totalScenes: conversations.length,
    daemonTaskCount: daemonResults.length,
    outputDir,
    aggregates,
  };

  await fsp.writeFile(
    path.join(outputDir, 'run-summary.json'),
    `${JSON.stringify(runSummary, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${JSON.stringify(runSummary, null, 2)}\n`);
};

module.exports = {
  parseArgs,
  extractToolCallsFromDaemonResult,
  computeAggregateMetrics,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
