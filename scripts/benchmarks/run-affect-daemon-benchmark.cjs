#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const { writeTraceArtifacts } = require('./trace_flamegraph.cjs');
const { buildDaemonBenchmarkVisualization } = require('./run-daemon-benchmark.cjs');

const DEFAULT_PARALLEL = 1;
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_SYSTEM_ID_SUFFIX = 'runtime';
const VALID_INTERVENTION_STATES = new Set([
  'stabilize',
  'clarify',
  'co_plan',
  'guided_execute',
  'autonomous_execute',
]);

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const roundDurationMs = value =>
  Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;

const createPhaseRecorder = () => {
  const baseMs = performance.now();
  const phases = {};

  const now = () => roundDurationMs(performance.now() - baseMs) ?? 0;

  return {
    now,
    startPhase: name => {
      phases[name] = { startedAtMs: now() };
    },
    endPhase: name => {
      const phase = phases[name] || {};
      const endedAtMs = now();
      phases[name] = {
        ...phase,
        endedAtMs,
        durationMs:
          Number.isFinite(phase.startedAtMs) && endedAtMs >= phase.startedAtMs
            ? roundDurationMs(endedAtMs - phase.startedAtMs)
            : null,
      };
    },
    snapshot: () => JSON.parse(JSON.stringify({ phases })),
  };
};

const shiftTimeline = ({ spans, markers, offsetMs }) => ({
  spans: spans.map(span => ({
    ...span,
    startMs: roundDurationMs(span.startMs + offsetMs) ?? span.startMs + offsetMs,
  })),
  markers: markers.map(marker => ({
    ...marker,
    atMs: roundDurationMs(marker.atMs + offsetMs) ?? marker.atMs + offsetMs,
  })),
});

const buildAffectBenchmarkVisualization = ({
  options,
  wrapperProfile,
  daemonSummary,
  daemonTaskResults,
  scoreSummary,
}) => {
  const wrapperPhases = wrapperProfile?.phases || {};
  const totalDurationMs =
    wrapperPhases.benchmark?.durationMs ??
    roundDurationMs(
      Object.values(wrapperPhases).reduce(
        (max, phase) =>
          Math.max(
            max,
            Number.isFinite(phase?.endedAtMs) ? phase.endedAtMs : 0
          ),
        0
      )
    ) ??
    1;

  const spans = [
    {
      track: 'Affect Run',
      label: 'affect benchmark run',
      startMs: 0,
      durationMs: totalDurationMs,
      category: 'run',
      detail: {
        providerType: options.providerType,
        model: options.model,
      },
    },
  ];
  const markers = [];
  const tracks = ['Affect Run', 'Wrapper Phases'];

  for (const [phaseName, phase] of Object.entries(wrapperPhases)) {
    if (phaseName === 'benchmark') continue;
    if (!Number.isFinite(phase?.startedAtMs) || !Number.isFinite(phase?.durationMs)) continue;
    spans.push({
      track: 'Wrapper Phases',
      label: phaseName,
      startMs: phase.startedAtMs,
      durationMs: phase.durationMs,
      category:
        phaseName === 'daemonBenchmark'
          ? 'daemon'
          : phaseName === 'scoreAffect'
            ? 'scoring'
            : phaseName === 'prepareInputs' || phaseName === 'loadArtifacts'
              ? 'io'
              : 'wrapper',
      detail: phase,
    });
  }

  const daemonPhase = wrapperPhases.daemonBenchmark;
  if (daemonPhase && daemonSummary) {
    const daemonTimeline = buildDaemonBenchmarkVisualization({
      benchmark: 'affect-daemon',
      options,
      runProfile: {
        phases: {
          benchmark: {
            durationMs: daemonPhase.durationMs,
          },
          executeTasks: {
            startedAtMs: 0,
            endedAtMs: daemonPhase.durationMs,
            durationMs: daemonPhase.durationMs,
          },
        },
      },
      taskResults: daemonTaskResults,
    });
    const shifted = shiftTimeline({
      spans: daemonTimeline.spans,
      markers: daemonTimeline.markers,
      offsetMs: daemonPhase.startedAtMs,
    });
    tracks.push(...daemonTimeline.tracks.filter(track => !tracks.includes(track)));
    spans.push(...shifted.spans);
    markers.push(...shifted.markers);
  }

  if (scoreSummary?.overall?.length) {
    markers.push({
      track: 'Affect Run',
      label: 'score_ready',
      atMs:
        wrapperPhases.scoreAffect?.endedAtMs ??
        wrapperPhases.loadArtifacts?.endedAtMs ??
        totalDurationMs,
      category: 'event',
      detail: {
        systems: scoreSummary.overall.map(entry => entry.system_id),
      },
    });
  }

  return {
    title: 'Affect benchmark full-pipeline flamegraph',
    totalDurationMs,
    spans,
    markers,
    tracks,
    metadata: {
      providerType: options.providerType,
      model: options.model,
      totalCases: daemonTaskResults.length,
      parsedPredictions:
        typeof scoreSummary?.overall?.[0]?.valid_predictions === 'number'
          ? scoreSummary.overall[0].valid_predictions
          : null,
    },
  };
};

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const normalizeProviderType = value => normalizeText(value).toLowerCase();

const splitPathList = value =>
  normalizeText(value)
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);

const parseArgs = argv => {
  const parsed = {
    parallel: DEFAULT_PARALLEL,
    healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    streamTimeoutMs: DEFAULT_STREAM_TIMEOUT_MS,
    maxIterations: 1,
    systemIdSuffix: DEFAULT_SYSTEM_ID_SUFFIX,
    affectMode: 'explicit_policy',
    contextMode: 'benchmark_clean',
    keepIntermediate: false,
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
      case 'cases':
        parsed.casesPaths = splitPathList(consumeValue());
        break;
      case 'gold':
        parsed.goldPaths = splitPathList(consumeValue());
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'provider':
        parsed.providerType = normalizeProviderType(consumeValue());
        break;
      case 'model':
        parsed.model = consumeValue();
        break;
      case 'system-id-suffix':
        parsed.systemIdSuffix = normalizeText(consumeValue());
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
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.casesPaths || parsed.casesPaths.length === 0) {
    throw new Error('Missing required --cases');
  }
  if (!parsed.goldPaths || parsed.goldPaths.length === 0) {
    throw new Error('Missing required --gold');
  }
  if (!parsed.outputDir) {
    throw new Error('Missing required --output-dir');
  }
  if (!parsed.providerType) {
    throw new Error('Missing required --provider');
  }
  if (!parsed.model) {
    throw new Error('Missing required --model');
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

const mergeJsonlRows = async paths => {
  const rows = [];
  for (const filePath of paths) {
    rows.push(...(await readJsonLines(filePath)));
  }
  return rows;
};

const buildTaskContextSystemMessage = taskContext => {
  if (!taskContext || typeof taskContext !== 'object' || Array.isArray(taskContext)) {
    return '';
  }

  const lines = ['Benchmark task context (treat as operative constraints for this turn):'];
  const pushLine = (label, value) => {
    if (typeof value !== 'string' || !value.trim()) return;
    lines.push(`- ${label}: ${value.trim()}`);
  };

  pushLine('goal', taskContext.goal);
  pushLine('deliverable', taskContext.deliverable);
  if (Array.isArray(taskContext.constraints) && taskContext.constraints.length > 0) {
    lines.push('- constraints:');
    for (const entry of taskContext.constraints) {
      if (typeof entry !== 'string' || !entry.trim()) continue;
      lines.push(`  - ${entry.trim()}`);
    }
  }

  return lines.length > 1 ? lines.join('\n') : '';
};

const normalizeHistoryMessages = history =>
  Array.isArray(history)
    ? history
        .map(entry => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
          const role =
            entry.role === 'user' || entry.role === 'assistant' ? entry.role : null;
          const content = normalizeText(entry.text ?? entry.content);
          if (!role || !content) return null;
          return { role, content };
        })
        .filter(Boolean)
    : [];

const buildDaemonTasks = (cases, options = {}) =>
  cases.map(entry => ({
    id: entry.case_id,
    setupMessages: [
      ...normalizeHistoryMessages(entry.history).map(message => ({
        ...message,
        ...(message.role === 'user' ? { awaitEmotionAnalysis: true } : {}),
      })),
      ...(normalizeText(entry.current_user_message)
        ? [
            {
              role: 'user',
              content: normalizeText(entry.current_user_message),
              awaitEmotionAnalysis: true,
            },
          ]
        : []),
    ],
    messages: [
      ...normalizeHistoryMessages(entry.history),
      ...(buildTaskContextSystemMessage(entry.task_context)
        ? [{ role: 'system', content: buildTaskContextSystemMessage(entry.task_context) }]
        : []),
      { role: 'user', content: normalizeText(entry.current_user_message) },
    ],
    experimental_context: {
      affectMode: options.affectMode || 'explicit_policy',
      contextMode: options.contextMode || 'benchmark_clean',
      ...(options.awaitRealtimeAffect === true ? { awaitRealtimeAffect: true } : {}),
    },
    metadata: {
      benchmark: 'affect-screening',
      case_id: entry.case_id,
      base_task_id: entry.base_task_id || '',
      variant_id: entry.variant_id || '',
      slice: entry.slice || '',
      affect_mode: options.affectMode || 'explicit_policy',
      context_mode: options.contextMode || 'benchmark_clean',
      ...(options.awaitRealtimeAffect === true ? { await_realtime_affect: true } : {}),
    },
  }));

const extractFirstJsonObject = text => {
  const source = normalizeText(text);
  if (!source) return '';

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  return '';
};

const parseModelJson = text => {
  const direct = normalizeText(text);
  if (!direct) return null;

  try {
    return JSON.parse(direct);
  } catch {}

  const fenceMatch = direct.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  const objectText = extractFirstJsonObject(direct);
  if (objectText) {
    try {
      return JSON.parse(objectText);
    } catch {}
  }

  return null;
};

const normalizeBinaryFlag = value => {
  if (value === 0 || value === 1) return value;
  if (value === '0' || value === '1') return Number.parseInt(value, 10);
  return null;
};

const parseRuntimePolicyAction = thread => {
  if (!thread || typeof thread !== 'object') return null;
  const metadataRaw = typeof thread.metadata === 'string' ? thread.metadata : '';
  if (!metadataRaw.trim()) return null;

  let metadata;
  try {
    metadata = JSON.parse(metadataRaw);
  } catch {
    return null;
  }

  const policy =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata.interventionPolicy
      : null;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    return null;
  }

  const interventionState = normalizeText(policy.interventionState);
  const escalate = normalizeBinaryFlag(policy.escalate);
  if (!VALID_INTERVENTION_STATES.has(interventionState) || escalate === null) {
    return null;
  }

  return {
    intervention_state: interventionState,
    escalate,
    applied: policy.applied === true,
    affect_used: policy.affectUsed === true,
  };
};

const parseAffectPrediction = ({ caseId, systemId, rawText, metadata, thread }) => {
  const runtimePolicyAction = parseRuntimePolicyAction(thread);
  if (runtimePolicyAction && rawText) {
    const runtimeMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? {
          ...metadata,
          runtime_policy_applied: runtimePolicyAction.applied === true,
          runtime_policy_affect_used: runtimePolicyAction.affect_used === true,
        }
      : metadata;
    return {
      ok: true,
      prediction: {
        case_id: caseId,
        system_id: systemId,
        policy_action: runtimePolicyAction,
        assistant_response: rawText,
        metadata: runtimeMetadata,
      },
      raw_text: rawText,
    };
  }

  const parsed = parseModelJson(rawText);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      case_id: caseId,
      error: 'response_not_parseable_as_json',
      raw_text: rawText,
      metadata,
    };
  }

  const policyAction =
    parsed.policy_action && typeof parsed.policy_action === 'object' && !Array.isArray(parsed.policy_action)
      ? parsed.policy_action
      : parsed.policyAction && typeof parsed.policyAction === 'object' && !Array.isArray(parsed.policyAction)
        ? parsed.policyAction
        : parsed.policy && typeof parsed.policy === 'object' && !Array.isArray(parsed.policy)
          ? parsed.policy
          : null;
  if (!policyAction) {
    return {
      ok: false,
      case_id: caseId,
      error: 'missing_policy_action',
      raw_text: rawText,
      parsed,
      metadata,
    };
  }

  const interventionState = normalizeText(
    policyAction.intervention_state ?? policyAction.interventionState
  );
  const escalate = normalizeBinaryFlag(policyAction.escalate);
  const assistantResponse = normalizeText(
    parsed.assistant_response ?? parsed.assistantResponse
  );

  if (!VALID_INTERVENTION_STATES.has(interventionState)) {
    return {
      ok: false,
      case_id: caseId,
      error: `invalid_intervention_state:${interventionState || 'missing'}`,
      raw_text: rawText,
      parsed,
      metadata,
    };
  }
  if (escalate === null) {
    return {
      ok: false,
      case_id: caseId,
      error: 'invalid_escalate',
      raw_text: rawText,
      parsed,
      metadata,
    };
  }
  if (!assistantResponse) {
    return {
      ok: false,
      case_id: caseId,
      error: 'missing_assistant_response',
      raw_text: rawText,
      parsed,
      metadata,
    };
  }

  return {
    ok: true,
    prediction: {
      case_id: caseId,
      system_id: systemId,
      policy_action: {
        intervention_state: interventionState,
        escalate,
      },
      assistant_response: assistantResponse,
      metadata,
    },
    raw_text: rawText,
  };
};

const runNodeScript = async ({ scriptPath, args, cwd }) =>
  await new Promise((resolve, reject) => {
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

const main = async argv => {
  const options = parseArgs(argv);
  const recorder = options.profileLatency ? createPhaseRecorder() : null;
  recorder?.startPhase('benchmark');
  const outputDir = path.resolve(options.outputDir);
  const inputDir = path.join(outputDir, 'inputs');
  const daemonOutputDir = path.join(outputDir, 'daemon');
  const scoreOutputDir = path.join(outputDir, 'score');
  await ensureDir(inputDir);
  await ensureDir(daemonOutputDir);

  recorder?.startPhase('prepareInputs');
  const mergedCases = await mergeJsonlRows(options.casesPaths);
  const mergedGold = await mergeJsonlRows(options.goldPaths);

  const tasks = buildDaemonTasks(mergedCases, {
    affectMode: options.affectMode,
    contextMode: options.contextMode,
  });
  const tasksPath = path.join(inputDir, 'tasks.json');
  const mergedCasesPath = path.join(inputDir, 'cases.merged.jsonl');
  const mergedGoldPath = path.join(inputDir, 'gold.merged.jsonl');
  await fsp.writeFile(tasksPath, `${JSON.stringify(tasks, null, 2)}\n`, 'utf8');
  await writeJsonLines(mergedCasesPath, mergedCases);
  await writeJsonLines(mergedGoldPath, mergedGold);
  recorder?.endPhase('prepareInputs');

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

  recorder?.startPhase('daemonBenchmark');
  await runNodeScript({
    scriptPath: path.join(path.resolve(__dirname, '..', '..'), 'scripts', 'benchmarks', 'run-daemon-benchmark.cjs'),
    args: daemonArgs,
    cwd: path.resolve(__dirname, '..', '..'),
  }).catch(async error => {
    if (!options.spawnDaemon && !options.daemonUrl) {
      const fallbackUserDataPath = path.resolve(options.userDataPath || getDefaultDesktopUserDataPath());
      process.stderr.write(
        `[affect-daemon-benchmark] direct daemon connection failed; retrying with --spawn-daemon using ${fallbackUserDataPath}\n`
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
  recorder?.endPhase('daemonBenchmark');

  recorder?.startPhase('loadArtifacts');
  const daemonSummary = JSON.parse(
    await fsp.readFile(path.join(daemonOutputDir, 'summary.json'), 'utf8')
  );
  const daemonResults = JSON.parse(
    await fsp.readFile(path.join(daemonOutputDir, 'results.json'), 'utf8')
  );
  const systemId = `${options.providerType}_${options.model}_${options.systemIdSuffix}`;

  const parseRows = daemonResults.map(taskRecord =>
    parseAffectPrediction({
      caseId: taskRecord.id,
      systemId,
      rawText: normalizeText(taskRecord.prediction),
      thread: taskRecord.thread,
      metadata: {
        provider: options.providerType,
        model: options.model,
        daemon_duration_ms: taskRecord.durationMs,
        affect_mode: options.affectMode,
        context_mode: options.contextMode,
      },
    })
  );

  const validPredictions = parseRows.filter(entry => entry.ok).map(entry => entry.prediction);
  const parseFailures = parseRows.filter(entry => !entry.ok);
  const predictionsPath = path.join(outputDir, 'affect.predictions.jsonl');
  await writeJsonLines(predictionsPath, validPredictions);
  await fsp.writeFile(
    path.join(outputDir, 'parsed-results.json'),
    `${JSON.stringify(parseRows, null, 2)}\n`,
    'utf8'
  );
  await fsp.writeFile(
    path.join(outputDir, 'parse-failures.json'),
    `${JSON.stringify(parseFailures, null, 2)}\n`,
    'utf8'
  );
  recorder?.endPhase('loadArtifacts');

  recorder?.startPhase('scoreAffect');
  await runNodeScript({
    scriptPath: path.join(path.resolve(__dirname, '..', '..'), 'scripts', 'benchmarks', 'run-affect-benchmark.cjs'),
    args: [
      '--cases',
      mergedCasesPath,
      '--gold',
      mergedGoldPath,
      '--predictions',
      predictionsPath,
      '--output-dir',
      scoreOutputDir,
    ],
    cwd: path.resolve(__dirname, '..', '..'),
  });
  recorder?.endPhase('scoreAffect');

  const scoreSummary = JSON.parse(
    await fsp.readFile(path.join(scoreOutputDir, 'summary.json'), 'utf8')
  );
  const daemonLatencySummaryPath = path.join(daemonOutputDir, 'latency-summary.json');
  let daemonLatencySummary = null;
  if (options.profileLatency) {
    try {
      daemonLatencySummary = JSON.parse(await fsp.readFile(daemonLatencySummaryPath, 'utf8'));
    } catch {}
  }

  const runSummary = {
    providerType: options.providerType,
    model: options.model,
    systemId,
    affectMode: options.affectMode,
    contextMode: options.contextMode,
    totalCases: mergedGold.length,
    parsedPredictions: validPredictions.length,
    parseFailures: parseFailures.length,
    outputDir,
    scoreOutputDir,
    overall: scoreSummary.overall,
    ...(options.profileLatency
      ? {
          profileLatency: true,
          daemonLatencySummaryPath,
          flamegraphHtmlPath: path.join(outputDir, 'full-pipeline.flamegraph.html'),
          traceJsonPath: path.join(outputDir, 'full-pipeline.trace.json'),
          ...(daemonLatencySummary
            ? {
                daemonLatencyTopSources: daemonLatencySummary.topSources?.slice(0, 5) || [],
              }
            : {}),
        }
      : {}),
  };

  recorder?.startPhase('writeSummary');
  await fsp.writeFile(
    path.join(outputDir, 'run-summary.json'),
    `${JSON.stringify(runSummary, null, 2)}\n`,
    'utf8'
  );

  if (!options.keepIntermediate) {
    await Promise.allSettled([fsp.unlink(tasksPath)]);
  }
  recorder?.endPhase('writeSummary');
  recorder?.endPhase('benchmark');

  if (options.profileLatency) {
    await writeTraceArtifacts({
      outputDir,
      basename: 'full-pipeline',
      ...buildAffectBenchmarkVisualization({
        options,
        wrapperProfile: recorder.snapshot(),
        daemonSummary,
        daemonTaskResults: daemonResults,
        scoreSummary,
      }),
    });
  }

  process.stdout.write(`${JSON.stringify(runSummary, null, 2)}\n`);
};

module.exports = {
  VALID_INTERVENTION_STATES,
  parseArgs,
  buildTaskContextSystemMessage,
  buildDaemonTasks,
  extractFirstJsonObject,
  parseModelJson,
  parseRuntimePolicyAction,
  parseAffectPrediction,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
