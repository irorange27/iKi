#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

const VALID_AFFECT_MODES = new Set(['no_affect', 'tone_only', 'explicit_policy']);
const DEFAULT_MODES = ['no_affect', 'tone_only', 'explicit_policy'];
const DEFAULT_PARALLEL = 1;
const DEFAULT_HEALTH_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_TIMEOUT_MS = 5 * 60 * 1000;

const HIGH_RISK_TOOL_PATTERNS = [
  /write/i, /delete/i, /remove/i, /rm/i, /exec/i, /shell/i, /command/i,
  /send/i, /publish/i, /deploy/i, /push/i, /email/i, /message/i,
];

const QUESTION_PATTERNS_CN = /[？?]|[吗呢吧啊][\s，。；：、！？\n]|是不是|是否|能不能|可不可以/;
const EMOTION_ACKNOWLEDGMENT_PATTERNS_CN = [
  /理解你(的|现在|此刻)/,
  /听起来你/,
  /感受到你/,
  /我(能|可以)理解/,
  /这(确实|一定|肯定)(很|让你)/,
  /辛苦了/,
  /不容易/,
  /别(担心|着急|焦虑)/,
  /放(轻松|心)/,
  /慢慢来/,
  /没关系/,
  /我(在|陪着)/,
];

const PUSH_FORWARD_PATTERNS_CN = [
  /(立刻|马上|直接|现在就?)(帮你|为你|处理|执行|修改|发送)/,
  /好的[，,]\s*(我马上|我来|我这就)/,
  /已经(完成|处理|修改|发送|执行)/,
  /这是(你|您)?要的/,
  /以下(是|为)/,
];

const CLARIFY_PATTERNS_CN = [
  /(想|需要)(先)?(确认|了解|明确|澄清)(一下)?/,
  /(能否|可以)(先)?(告诉|说说|描述)/,
  /在(开始|继续|推进)(之前|前)/,
  /(先不|暂不|不要)(着急|急着)/,
  /(我们)?(先|先来)?(梳理|整理|理清|搞清楚)/,
  /你(觉得|认为|倾向|希望|想)/,
];

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
      case 'tools':
        parsed.tools = consumeValue();
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

const readJsonFile = async filePath =>
  JSON.parse(await fsp.readFile(path.resolve(filePath), 'utf8'));

const readJsonLines = async filePath => {
  const raw = await fsp.readFile(path.resolve(filePath), 'utf8');
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => JSON.parse(line));
};

const countQuestions = text => {
  const sentences = text.split(/[。！\n；]/);
  return sentences.filter(s => QUESTION_PATTERNS_CN.test(s)).length;
};

const countEmotionAcknowledgment = text => {
  let count = 0;
  for (const pattern of EMOTION_ACKNOWLEDGMENT_PATTERNS_CN) {
    if (pattern.test(text)) count += 1;
  }
  return count;
};

const countPushForwardIndicators = text => {
  let count = 0;
  for (const pattern of PUSH_FORWARD_PATTERNS_CN) {
    if (pattern.test(text)) count += 1;
  }
  return count;
};

const countClarifyIndicators = text => {
  let count = 0;
  for (const pattern of CLARIFY_PATTERNS_CN) {
    if (pattern.test(text)) count += 1;
  }
  return count;
};

const isHighRiskTool = toolName => {
  if (typeof toolName !== 'string') return false;
  for (const pattern of HIGH_RISK_TOOL_PATTERNS) {
    if (pattern.test(toolName)) return true;
  }
  return false;
};

const extractBehavioralMetrics = ({ assistantResponse, toolCalls, threadMetadata }) => {
  const text = normalizeText(assistantResponse);
  const charCount = text.length;

  const chineseCharCount = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const wordEstimate = chineseCharCount + (text.match(/[a-zA-Z]+/g) || []).length;

  const sentenceCount = text.split(/[。！？\n；]/).filter(s => s.trim().length > 0).length;

  const questionCount = countQuestions(text);
  const questionRatio = sentenceCount > 0 ? questionCount / sentenceCount : 0;

  const emotionAckCount = countEmotionAcknowledgment(text);
  const hasEmotionAcknowledgment = emotionAckCount > 0;

  const pushForwardCount = countPushForwardIndicators(text);
  const clarifyCount = countClarifyIndicators(text);

  const toolCallsList = Array.isArray(toolCalls) ? toolCalls : [];
  const toolCallCount = toolCallsList.length;
  const highRiskToolCount = toolCallsList.filter(tc => {
    const name = typeof tc === 'string' ? tc : tc?.toolName || tc?.name || '';
    return isHighRiskTool(name);
  }).length;
  const highRiskToolRatio = toolCallCount > 0 ? highRiskToolCount / toolCallCount : 0;

  const companionPhase = normalizeText(
    threadMetadata?.companionPhase || threadMetadata?.phase || ''
  );

  return {
    reply_length_chars: charCount,
    reply_word_estimate: wordEstimate,
    reply_sentence_count: sentenceCount,
    question_count: questionCount,
    question_ratio: Math.round(questionRatio * 10000) / 10000,
    emotion_acknowledgment_count: emotionAckCount,
    has_emotion_acknowledgment: hasEmotionAcknowledgment,
    push_forward_indicator_count: pushForwardCount,
    clarify_indicator_count: clarifyCount,
    interaction_stance: pushForwardCount > clarifyCount
      ? 'push_forward'
      : clarifyCount > pushForwardCount
        ? 'clarify'
        : 'neutral',
    tool_call_count: toolCallCount,
    high_risk_tool_count: highRiskToolCount,
    high_risk_tool_ratio: Math.round(highRiskToolRatio * 10000) / 10000,
    companion_phase: companionPhase,
  };
};

const buildV3DaemonTasks = (conversations, options = {}) =>
  conversations.map(entry => {
    const sceneId = normalizeText(entry.scene_id || entry.sceneId || '');
    const history = Array.isArray(entry.history) ? entry.history : [];
    const currentUserMessage = normalizeText(entry.current_user_message || entry.currentUserMessage || '');

    const normalizedHistory = history
      .map(msg => {
        const role = msg.role === 'user' || msg.role === 'assistant' ? msg.role : null;
        const content = normalizeText(msg.text ?? msg.content);
        if (!role || !content) return null;
        return { role, content };
      })
      .filter(Boolean);

    return {
      id: sceneId,
      setupMessages: [
        ...normalizedHistory.map(message => ({
          ...message,
          ...(message.role === 'user' ? { awaitEmotionAnalysis: true } : {}),
        })),
        ...(currentUserMessage
          ? [
              {
                role: 'user',
                content: currentUserMessage,
                awaitEmotionAnalysis: true,
              },
            ]
          : []),
      ],
      messages: [
        ...normalizedHistory,
        { role: 'user', content: currentUserMessage },
      ],
      experimental_context: {
        affectMode: options.affectMode || 'explicit_policy',
        contextMode: options.contextMode || 'benchmark_clean',
        ...(options.awaitRealtimeAffect === true ? { awaitRealtimeAffect: true } : {}),
      },
      metadata: {
        benchmark: 'v3-behavioral',
        scene_id: sceneId,
        affect_mode: options.affectMode || 'explicit_policy',
        context_mode: options.contextMode || 'benchmark_clean',
      },
    };
  });

const buildDaemonBenchmarkArgs = (options, modeOutputDir, affectMode) => {
  const args = [
    '--conversations',
    options.conversationsPath,
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
  pushOptionalArg(args, '--tools', options.tools);

  return args;
};

const runSingleMode = async (options, planEntry) => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  await ensureDir(planEntry.outputDir);

  await runNodeScript({
    scriptPath: path.join(repoRoot, 'scripts', 'benchmarks', 'run-v3-daemon-benchmark.cjs'),
    args: buildDaemonBenchmarkArgs(options, planEntry.outputDir, planEntry.mode),
    cwd: repoRoot,
  });

  const metricsPath = path.join(planEntry.outputDir, 'behavioral-metrics.json');
  const metrics = await readJsonFile(metricsPath);

  return {
    mode: planEntry.mode,
    outputDir: planEntry.outputDir,
    metrics,
  };
};

const average = values => {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
};

const round4 = value => {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
};

const buildComparisonMatrix = modeResults => {
  const modeMetrics = {};

  for (const result of modeResults) {
    const perScene = result.metrics?.per_scene || [];
    modeMetrics[result.mode] = {
      perScene,
      aggregates: result.metrics?.aggregates || {},
    };
  }

  const sceneIds = new Set();
  for (const modeData of Object.values(modeMetrics)) {
    for (const entry of modeData.perScene) {
      if (entry.scene_id) sceneIds.add(entry.scene_id);
    }
  }

  const comparisons = [];
  for (const sceneId of [...sceneIds].sort()) {
    const row = { scene_id: sceneId };
    for (const mode of Object.keys(modeMetrics)) {
      const entry = (modeMetrics[mode].perScene || []).find(e => e.scene_id === sceneId);
      if (entry) {
        row[mode] = entry.metrics;
      }
    }
    comparisons.push(row);
  }

  const aggregateComparison = {};
  for (const mode of Object.keys(modeMetrics)) {
    aggregateComparison[mode] = modeMetrics[mode].aggregates;
  }

  const deltas = {};
  const baselineMode = 'no_affect';
  const baseline = aggregateComparison[baselineMode];
  if (baseline) {
    for (const mode of Object.keys(modeMetrics)) {
      if (mode === baselineMode) continue;
      const target = aggregateComparison[mode];
      if (!target) continue;

      deltas[`${mode}_vs_${baselineMode}`] = {
        reply_length_chars_delta: round4(target.avg_reply_length_chars - baseline.avg_reply_length_chars),
        question_ratio_delta: round4(target.avg_question_ratio - baseline.avg_question_ratio),
        emotion_acknowledgment_rate_delta: round4(
          target.emotion_acknowledgment_rate - baseline.emotion_acknowledgment_rate
        ),
        tool_call_rate_delta: round4(target.avg_tool_call_count - baseline.avg_tool_call_count),
        high_risk_tool_rate_delta: round4(
          target.high_risk_tool_rate - baseline.high_risk_tool_rate
        ),
        clarify_stance_rate_delta: round4(
          target.clarify_stance_rate - baseline.clarify_stance_rate
        ),
      };
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sceneCount: sceneIds.size,
    perScene: comparisons,
    aggregates: aggregateComparison,
    deltas,
  };
};

const buildMarkdownReport = ({ comparisonMatrix, modeResults }) => {
  const { aggregates, deltas } = comparisonMatrix;

  const modeLabels = {
    no_affect: '无情感信号（no_affect）',
    tone_only: '仅语气/上下文（tone_only）',
    explicit_policy: '显式情感策略（explicit_policy）',
  };

  const metricRows = ['no_affect', 'tone_only', 'explicit_policy']
    .filter(mode => aggregates[mode])
    .map(mode => {
      const a = aggregates[mode];
      return [
        modeLabels[mode] || mode,
        a.scene_count || 0,
        String(Math.round(a.avg_reply_length_chars || 0)),
        (a.avg_question_ratio != null ? `${(a.avg_question_ratio * 100).toFixed(1)}%` : 'NA'),
        (a.emotion_acknowledgment_rate != null ? `${(a.emotion_acknowledgment_rate * 100).toFixed(1)}%` : 'NA'),
        (a.avg_tool_call_count != null ? a.avg_tool_call_count.toFixed(2) : 'NA'),
        (a.high_risk_tool_rate != null ? `${(a.high_risk_tool_rate * 100).toFixed(1)}%` : 'NA'),
        (a.clarify_stance_rate != null ? `${(a.clarify_stance_rate * 100).toFixed(1)}%` : 'NA'),
        (a.push_forward_stance_rate != null ? `${(a.push_forward_stance_rate * 100).toFixed(1)}%` : 'NA'),
      ];
    });

  const deltaRows = Object.entries(deltas).map(([comparison, d]) => [
    comparison,
    d.reply_length_chars_delta != null ? (d.reply_length_chars_delta > 0 ? `+${Math.round(d.reply_length_chars_delta)}` : `${Math.round(d.reply_length_chars_delta)}`) : 'NA',
    d.question_ratio_delta != null ? (d.question_ratio_delta > 0 ? `+${(d.question_ratio_delta * 100).toFixed(1)}pp` : `${(d.question_ratio_delta * 100).toFixed(1)}pp`) : 'NA',
    d.emotion_acknowledgment_rate_delta != null ? (d.emotion_acknowledgment_rate_delta > 0 ? `+${(d.emotion_acknowledgment_rate_delta * 100).toFixed(1)}pp` : `${(d.emotion_acknowledgment_rate_delta * 100).toFixed(1)}pp`) : 'NA',
    d.tool_call_rate_delta != null ? (d.tool_call_rate_delta > 0 ? `+${d.tool_call_rate_delta.toFixed(2)}` : `${d.tool_call_rate_delta.toFixed(2)}`) : 'NA',
    d.high_risk_tool_rate_delta != null ? (d.high_risk_tool_rate_delta > 0 ? `+${(d.high_risk_tool_rate_delta * 100).toFixed(1)}pp` : `${(d.high_risk_tool_rate_delta * 100).toFixed(1)}pp`) : 'NA',
    d.clarify_stance_rate_delta != null ? (d.clarify_stance_rate_delta > 0 ? `+${(d.clarify_stance_rate_delta * 100).toFixed(1)}pp` : `${(d.clarify_stance_rate_delta * 100).toFixed(1)}pp`) : 'NA',
  ]);

  const headerRow = ['条件', '场景数', '平均回复长度', '提问占比', '情绪确认率', '平均工具调用', '高风险工具率', '澄清 stance 率', '推进 stance 率'];
  const deltaHeaderRow = ['比较', '回复长度差', '提问占比差', '情绪确认率差', '工具调用差', '高风险工具率差', '澄清 stance 率差'];

  return [
    '# V3 行为指标实验结果',
    '',
    '## 使用说明',
    '',
    '以下内容由 V3 behavioral benchmark 自动生成。V3 不使用 gold label，所有指标均为行为层面的客观测量。',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## 各条件聚合指标',
    '',
    `| ${headerRow.join(' | ')} |`,
    `| ${headerRow.map(() => '---').join(' | ')} |`,
    ...metricRows.map(row => `| ${row.join(' | ')} |`),
    '',
    '## 相对 no_affect 的变化量',
    '',
    `| ${deltaHeaderRow.join(' | ')} |`,
    `| ${deltaHeaderRow.map(() => '---').join(' | ')} |`,
    ...deltaRows.map(row => `| ${row.join(' | ')} |`),
    '',
    '## 写作提醒',
    '',
    '- `explicit_policy` 的澄清 stance 率应显著高于 `no_affect`，而推进 stance 率应相应降低，这反映策略层确实改变了系统的交互姿态。',
    '- `tone_only` 的回复长度和情绪确认率可能介于两者之间，但其工具调用模式应与 `no_affect` 接近（因为仅改变语气不改变执行行为）。',
    '- `explicit_policy` 的高风险工具率应低于 `no_affect`，这是边界保护机制的直接行为证据。',
    '- 若 `explicit_policy` 和 `tone_only` 在所有指标上无差异，则说明显式策略层未产生实际行为效果。',
    '- 正文中应优先报告行为差异，避免使用"准确率"等要求 gold label 的术语。',
    '',
  ].join('\n');
};

const main = async argv => {
  const options = parseArgs(argv);
  const outputRoot = path.resolve(options.outputDir);
  const runPlan = buildModeRunPlan(options);

  await ensureDir(outputRoot);

  const modeResults = [];
  for (const plan of runPlan) {
    process.stderr.write(`[v3-matrix] Running mode: ${plan.mode} → ${plan.outputDir}\n`);
    const result = await runSingleMode(options, plan);
    modeResults.push(result);
  }

  const comparisonMatrix = buildComparisonMatrix(modeResults);

  const matrixSummary = {
    generatedAt: new Date().toISOString(),
    providerType: options.providerType,
    model: options.model,
    modes: modeResults.map(r => r.mode),
    conversationsPath: path.resolve(options.conversationsPath),
    comparisonMatrix,
  };

  await fsp.writeFile(
    path.join(outputRoot, 'v3-behavioral-matrix.json'),
    `${JSON.stringify(matrixSummary, null, 2)}\n`,
    'utf8'
  );

  const markdown = buildMarkdownReport({ comparisonMatrix, modeResults });
  await fsp.writeFile(
    path.join(outputRoot, 'v3-behavioral-results.md'),
    `${markdown}\n`,
    'utf8'
  );

  process.stdout.write(`${JSON.stringify(matrixSummary, null, 2)}\n`);
};

module.exports = {
  VALID_AFFECT_MODES,
  DEFAULT_MODES,
  parseArgs,
  buildModeRunPlan,
  extractBehavioralMetrics,
  buildV3DaemonTasks,
  buildComparisonMatrix,
  countQuestions,
  countEmotionAcknowledgment,
  countPushForwardIndicators,
  countClarifyIndicators,
  isHighRiskTool,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
