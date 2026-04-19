#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const VALID_AFFECT_MODES = new Set(['no_affect', 'tone_only', 'explicit_policy']);
const DEFAULT_MODES = ['no_affect', 'tone_only', 'explicit_policy'];
const DEFAULT_PARALLEL = 1;
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const splitList = value =>
  normalizeText(value)
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean);

const sanitizePathSegment = value =>
  normalizeText(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'run';

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const parseArgs = argv => {
  const parsed = {
    modes: [...DEFAULT_MODES],
    parallel: DEFAULT_PARALLEL,
    healthTimeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
    streamTimeoutMs: DEFAULT_STREAM_TIMEOUT_MS,
    maxIterations: 1,
    contextMode: 'benchmark_clean',
    skipSummary: false,
    spawnDaemon: false,
    keepDaemon: false,
    keepIntermediate: false,
    profileLatency: false,
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
      case 'main-cases':
        parsed.mainCasesPath = consumeValue();
        break;
      case 'main-gold':
        parsed.mainGoldPath = consumeValue();
        break;
      case 'neutral-cases':
        parsed.neutralCasesPath = consumeValue();
        break;
      case 'neutral-gold':
        parsed.neutralGoldPath = consumeValue();
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
      case 'modes':
        parsed.modes = splitList(consumeValue());
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
      case 'context-mode':
        parsed.contextMode = normalizeText(consumeValue());
        break;
      case 'system-id-suffix':
        parsed.systemIdSuffix = normalizeText(consumeValue());
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
      case 'keep-daemon':
        parsed.keepDaemon = true;
        break;
      case 'keep-intermediate':
        parsed.keepIntermediate = true;
        break;
      case 'profile-latency':
        parsed.profileLatency = true;
        break;
      case 'skip-summary':
        parsed.skipSummary = true;
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.mainCasesPath) throw new Error('Missing required --main-cases');
  if (!parsed.mainGoldPath) throw new Error('Missing required --main-gold');
  if (!parsed.neutralCasesPath) throw new Error('Missing required --neutral-cases');
  if (!parsed.neutralGoldPath) throw new Error('Missing required --neutral-gold');
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
  if (parsed.contextMode !== 'default' && parsed.contextMode !== 'benchmark_clean') {
    parsed.contextMode = 'benchmark_clean';
  }

  const dedupedModes = [];
  for (const mode of parsed.modes) {
    if (!VALID_AFFECT_MODES.has(mode)) {
      throw new Error(
        `Invalid affect mode "${mode}". Expected one of: no_affect, tone_only, explicit_policy`
      );
    }
    if (!dedupedModes.includes(mode)) {
      dedupedModes.push(mode);
    }
  }
  if (dedupedModes.length === 0) {
    throw new Error('At least one affect mode is required');
  }
  parsed.modes = dedupedModes;

  return parsed;
};

const buildModeRunPlan = options => {
  const rootDir = path.resolve(options.outputDir);
  const systemSlug = `${sanitizePathSegment(options.providerType)}-${sanitizePathSegment(options.model)}`;

  return options.modes.map(mode => ({
    mode,
    outputDir: path.join(rootDir, `${systemSlug}-${mode}`),
  }));
};

const runNodeScript = ({ scriptPath, args, cwd }) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd,
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${path.basename(scriptPath)}) with exit code ${code}`));
    });
  });

const pushOptionalArg = (args, flag, value) => {
  if (!normalizeText(value)) return;
  args.push(flag, value);
};

const buildBenchmarkArgs = (options, modeOutputDir, affectMode) => {
  const args = [
    '--cases',
    `${options.mainCasesPath},${options.neutralCasesPath}`,
    '--gold',
    `${options.mainGoldPath},${options.neutralGoldPath}`,
    '--output-dir',
    modeOutputDir,
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
    '--affect-mode',
    affectMode,
    '--context-mode',
    options.contextMode,
  ];

  pushOptionalArg(args, '--system-id-suffix', options.systemIdSuffix);
  pushOptionalArg(args, '--daemon-url', options.daemonUrl);
  pushOptionalArg(args, '--user-data-path', options.userDataPath);
  pushOptionalArg(args, '--bootstrap-token', options.bootstrapToken);
  pushOptionalArg(args, '--client-id', options.clientId);
  pushOptionalArg(args, '--client-token', options.clientToken);
  pushOptionalArg(args, '--client-name', options.clientName);
  pushOptionalArg(args, '--skill-mode', options.skillMode);

  if (options.spawnDaemon) args.push('--spawn-daemon');
  if (options.keepDaemon) args.push('--keep-daemon');
  if (options.keepIntermediate) args.push('--keep-intermediate');
  if (options.profileLatency) args.push('--profile-latency');
  if (affectMode !== 'no_affect') args.push('--await-realtime-affect');

  return args;
};

const readJsonFile = async filePath =>
  JSON.parse(await fsp.readFile(path.resolve(filePath), 'utf8'));

const main = async argv => {
  const options = parseArgs(argv);
  const repoRoot = path.resolve(__dirname, '..', '..');
  const outputRoot = path.resolve(options.outputDir);
  const runPlan = buildModeRunPlan(options);

  await ensureDir(outputRoot);

  const completedRuns = [];
  for (const plan of runPlan) {
    await ensureDir(plan.outputDir);
    await runNodeScript({
      scriptPath: path.join(repoRoot, 'scripts', 'benchmarks', 'run-affect-daemon-benchmark.cjs'),
      args: buildBenchmarkArgs(options, plan.outputDir, plan.mode),
      cwd: repoRoot,
    });

    completedRuns.push({
      mode: plan.mode,
      outputDir: plan.outputDir,
      runSummaryPath: path.join(plan.outputDir, 'run-summary.json'),
    });
  }

  const summaryArtifacts = {};
  if (!options.skipSummary) {
    const summaryArgs = [
      '--main-cases',
      options.mainCasesPath,
      '--main-gold',
      options.mainGoldPath,
      '--neutral-cases',
      options.neutralCasesPath,
      '--neutral-gold',
      options.neutralGoldPath,
      '--output-dir',
      outputRoot,
    ];

    for (const run of completedRuns) {
      summaryArgs.push('--run', `${run.mode}=${run.outputDir}`);
    }

    await runNodeScript({
      scriptPath: path.join(
        repoRoot,
        'scripts',
        'benchmarks',
        'summarize-affect-thesis-results.cjs'
      ),
      args: summaryArgs,
      cwd: repoRoot,
    });

    summaryArtifacts.summaryJsonPath = path.join(outputRoot, 'thesis-results-summary.json');
    summaryArtifacts.summaryMarkdownPath = path.join(outputRoot, 'paper-results-section.md');
  }

  const runSummaries = [];
  for (const run of completedRuns) {
    runSummaries.push({
      mode: run.mode,
      outputDir: run.outputDir,
      runSummary: await readJsonFile(run.runSummaryPath),
    });
  }

  const matrixSummary = {
    generatedAt: new Date().toISOString(),
    providerType: options.providerType,
    model: options.model,
    modes: completedRuns.map(entry => entry.mode),
    datasets: {
      mainCasesPath: path.resolve(options.mainCasesPath),
      mainGoldPath: path.resolve(options.mainGoldPath),
      neutralCasesPath: path.resolve(options.neutralCasesPath),
      neutralGoldPath: path.resolve(options.neutralGoldPath),
    },
    runs: runSummaries,
    ...summaryArtifacts,
  };

  await fsp.writeFile(
    path.join(outputRoot, 'thesis-matrix-run-summary.json'),
    `${JSON.stringify(matrixSummary, null, 2)}\n`,
    'utf8'
  );

  process.stdout.write(`${JSON.stringify(matrixSummary, null, 2)}\n`);
};

module.exports = {
  DEFAULT_MODES,
  VALID_AFFECT_MODES,
  parseArgs,
  buildModeRunPlan,
  sanitizePathSegment,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
