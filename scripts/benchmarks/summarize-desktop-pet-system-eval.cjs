#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
};

const round = value => {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 1000) / 1000;
};

const formatPercent = value => {
  if (!Number.isFinite(value)) return 'NA';
  return `${(value * 100).toFixed(1)}%`;
};

const formatNumber = (value, digits = 1) => {
  if (!Number.isFinite(value)) return 'NA';
  return value.toFixed(digits);
};

const formatMs = value => {
  if (!Number.isFinite(value)) return 'NA';
  return `${formatNumber(value, 1)} ms`;
};

const formatCount = value => {
  if (!Number.isFinite(value)) return 'NA';
  return String(value);
};

const pathExists = async targetPath => {
  try {
    await fsp.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJsonFile = async filePath =>
  JSON.parse(await fsp.readFile(path.resolve(filePath), 'utf8'));

const buildMarkdownTable = (headers, rows) => {
  const safeHeaders = headers.map(header => String(header));
  const lines = [
    `| ${safeHeaders.join(' | ')} |`,
    `| ${safeHeaders.map(() => '---').join(' | ')} |`,
  ];

  for (const row of rows) {
    lines.push(`| ${row.map(cell => String(cell)).join(' | ')} |`);
  }

  return lines.join('\n');
};

const parseArgs = argv => {
  const parsed = {
    runs: [],
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
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'run':
        parsed.runs.push(consumeValue());
        break;
      case 'observations':
        parsed.observationsPath = consumeValue();
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.outputDir) {
    throw new Error('Missing required --output-dir');
  }
  if (parsed.runs.length === 0) {
    throw new Error('Missing required --run');
  }

  return parsed;
};

const parseRunMapping = value => {
  const raw = normalizeText(value);
  const separatorIndex = raw.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new Error(`Invalid --run value "${value}". Expected <label>=<dir>`);
  }

  const label = raw.slice(0, separatorIndex).trim();
  const dir = raw.slice(separatorIndex + 1).trim();
  if (!label) {
    throw new Error(`Missing run label in "${value}"`);
  }
  if (!dir) {
    throw new Error(`Missing run dir in "${value}"`);
  }

  return {
    label,
    dir: path.resolve(dir),
  };
};

const loadLatencySummary = async ({ runDir, runSummary }) => {
  const candidatePaths = [];

  if (normalizeText(runSummary?.daemonLatencySummaryPath)) {
    candidatePaths.push(path.resolve(runSummary.daemonLatencySummaryPath));
  }
  candidatePaths.push(path.join(runDir, 'latency-summary.json'));
  candidatePaths.push(path.join(runDir, 'daemon', 'latency-summary.json'));

  for (const candidatePath of candidatePaths) {
    if (!(await pathExists(candidatePath))) continue;
    return {
      path: candidatePath,
      data: await readJsonFile(candidatePath),
    };
  }

  return null;
};

const buildRunRecord = async run => {
  const runSummaryPath = path.join(run.dir, 'run-summary.json');
  if (!(await pathExists(runSummaryPath))) {
    throw new Error(`Missing run-summary.json for run "${run.label}" at ${run.dir}`);
  }

  const runSummary = await readJsonFile(runSummaryPath);
  const latencySummary = await loadLatencySummary({
    runDir: run.dir,
    runSummary,
  });
  const overall = Array.isArray(runSummary.overall) ? runSummary.overall[0] || null : null;
  const topSource = latencySummary?.data?.topSources?.[0] || null;

  return {
    label: run.label,
    dir: run.dir,
    runSummaryPath,
    affectMode: normalizeText(runSummary.affectMode) || null,
    contextMode: normalizeText(runSummary.contextMode) || null,
    providerType: normalizeText(runSummary.providerType) || null,
    model: normalizeText(runSummary.model) || null,
    totalCases: Number.isFinite(runSummary.totalCases) ? runSummary.totalCases : null,
    parsedPredictions: Number.isFinite(runSummary.parsedPredictions)
      ? runSummary.parsedPredictions
      : null,
    parseFailures: Number.isFinite(runSummary.parseFailures) ? runSummary.parseFailures : null,
    coverageRate: Number.isFinite(overall?.coverage_rate) ? round(overall.coverage_rate) : null,
    policyCompositeErrorRate: Number.isFinite(overall?.policy_composite_error_rate)
      ? round(overall.policy_composite_error_rate)
      : null,
    latencySummaryPath: latencySummary?.path || null,
    averageTaskDurationMs: Number.isFinite(latencySummary?.data?.averageTaskDurationMs)
      ? round(latencySummary.data.averageTaskDurationMs)
      : null,
    firstTextDeltaAtMs: Number.isFinite(latencySummary?.data?.averages?.firstTextDeltaAtMs)
      ? round(latencySummary.data.averages.firstTextDeltaAtMs)
      : null,
    threadCreateMs: Number.isFinite(latencySummary?.data?.averages?.threadCreateMs)
      ? round(latencySummary.data.averages.threadCreateMs)
      : null,
    streamHandshakeMs: Number.isFinite(latencySummary?.data?.averages?.streamHandshakeMs)
      ? round(latencySummary.data.averages.streamHandshakeMs)
      : null,
    toolExecutionMs: Number.isFinite(latencySummary?.data?.averages?.toolExecutionMs)
      ? round(latencySummary.data.averages.toolExecutionMs)
      : null,
    topLatencySource: topSource
      ? {
          name: normalizeText(topSource.name) || null,
          shareOfProfiledTaskTime: Number.isFinite(topSource.shareOfProfiledTaskTime)
            ? round(topSource.shareOfProfiledTaskTime)
            : null,
          avgDurationMs: Number.isFinite(topSource.avgDurationMs) ? round(topSource.avgDurationMs) : null,
        }
      : null,
  };
};

const loadObservations = async observationsPath => {
  if (!observationsPath) {
    return null;
  }

  const payload = await readJsonFile(observationsPath);
  const resourceSamples = Array.isArray(payload.resourceSamples) ? payload.resourceSamples : [];
  const closedLoopChecks = Array.isArray(payload.closedLoopChecks) ? payload.closedLoopChecks : [];

  return {
    sourcePath: path.resolve(observationsPath),
    version: Number.isFinite(payload.version) ? payload.version : 1,
    environment: payload.environment && typeof payload.environment === 'object' ? payload.environment : {},
    resourceSamples: resourceSamples.map(sample => ({
      profileId: normalizeText(sample.profileId) || '',
      label: normalizeText(sample.label) || normalizeText(sample.profileId) || '未命名场景',
      source: normalizeText(sample.source) || '',
      sampleCount: Number.isFinite(sample.sampleCount) ? sample.sampleCount : null,
      windowSeconds: Number.isFinite(sample.windowSeconds) ? sample.windowSeconds : null,
      cpuPercentAvg: Number.isFinite(sample.cpuPercentAvg) ? round(sample.cpuPercentAvg) : null,
      cpuPercentPeak: Number.isFinite(sample.cpuPercentPeak) ? round(sample.cpuPercentPeak) : null,
      rssMbAvg: Number.isFinite(sample.rssMbAvg) ? round(sample.rssMbAvg) : null,
      rssMbPeak: Number.isFinite(sample.rssMbPeak) ? round(sample.rssMbPeak) : null,
      notes: normalizeText(sample.notes) || '',
    })),
    closedLoopChecks: closedLoopChecks.map(check => ({
      scenarioId: normalizeText(check.scenarioId) || '',
      label: normalizeText(check.label) || normalizeText(check.scenarioId) || '未命名检查',
      trigger: normalizeText(check.trigger) || '',
      expectedCompanionPhase: normalizeText(check.expectedCompanionPhase) || '',
      status: normalizeText(check.status).toLowerCase() || 'unknown',
      observedCompanionPhase: normalizeText(check.observedCompanionPhase) || '',
      observedLatencyMs: Number.isFinite(check.observedLatencyMs)
        ? round(check.observedLatencyMs)
        : null,
      notes: normalizeText(check.notes) || '',
    })),
  };
};

const summarizeObservations = observations => {
  if (!observations) {
    return {
      available: false,
      resourceSamples: [],
      closedLoopChecks: [],
      closedLoopSummary: {
        total: 0,
        pass: 0,
        partial: 0,
        fail: 0,
        unknown: 0,
      },
    };
  }

  const closedLoopSummary = {
    total: observations.closedLoopChecks.length,
    pass: 0,
    partial: 0,
    fail: 0,
    unknown: 0,
  };

  for (const check of observations.closedLoopChecks) {
    if (check.status === 'pass') closedLoopSummary.pass += 1;
    else if (check.status === 'partial') closedLoopSummary.partial += 1;
    else if (check.status === 'fail') closedLoopSummary.fail += 1;
    else closedLoopSummary.unknown += 1;
  }

  return {
    available: true,
    environment: observations.environment,
    resourceSamples: observations.resourceSamples,
    closedLoopChecks: observations.closedLoopChecks,
    closedLoopSummary,
  };
};

const buildSummaryHighlights = ({ runRecords, observationSummary }) => {
  const highlights = [];
  const runsWithFirstText = runRecords.filter(run => Number.isFinite(run.firstTextDeltaAtMs));
  const runsWithDuration = runRecords.filter(run => Number.isFinite(run.averageTaskDurationMs));

  if (runsWithFirstText.length > 0) {
    const sorted = [...runsWithFirstText].sort((left, right) => left.firstTextDeltaAtMs - right.firstTextDeltaAtMs);
    const fastest = sorted[0];
    const slowest = sorted[sorted.length - 1];
    highlights.push(
      `自动化运行中，首字延迟范围为 ${formatMs(fastest.firstTextDeltaAtMs)} 到 ${formatMs(
        slowest.firstTextDeltaAtMs
      )}，其中最快的是 \`${fastest.label}\`。`
    );
  }

  if (runsWithDuration.length > 0) {
    const sorted = [...runsWithDuration].sort(
      (left, right) => left.averageTaskDurationMs - right.averageTaskDurationMs
    );
    highlights.push(
      `平均任务时长最短的是 \`${sorted[0].label}\`（${formatMs(
        sorted[0].averageTaskDurationMs
      )}），可作为系统层响应性的代表性参考。`
    );
  }

  if (observationSummary.available) {
    const { total, pass, partial, fail } = observationSummary.closedLoopSummary;
    highlights.push(
      `功能闭环核查共记录 ${total} 个场景，其中通过 ${pass} 个、部分通过 ${partial} 个、失败 ${fail} 个。`
    );

    const idleSample = observationSummary.resourceSamples.find(
      sample => sample.profileId === 'idle_companion_visible'
    );
    if (idleSample && (Number.isFinite(idleSample.cpuPercentAvg) || Number.isFinite(idleSample.rssMbAvg))) {
      highlights.push(
        `空闲 companion 场景的资源采样记录为 CPU 均值 ${formatNumber(
          idleSample.cpuPercentAvg,
          1
        )}%、RSS 均值 ${formatNumber(idleSample.rssMbAvg, 1)} MB。`
      );
    }
  } else {
    highlights.push('当前未提供手工观测文件，因此资源占用与闭环核查部分仍需补录。');
  }

  return highlights;
};

const buildSystemEvalSummary = async options => {
  const runRecords = [];
  for (const run of options.runs.map(parseRunMapping)) {
    runRecords.push(await buildRunRecord(run));
  }

  const observations = await loadObservations(options.observationsPath);
  const observationSummary = summarizeObservations(observations);

  return {
    generatedAt: new Date().toISOString(),
    outputDir: path.resolve(options.outputDir),
    runs: runRecords,
    observationsPath: observations?.sourcePath || null,
    observationSummary,
    highlights: buildSummaryHighlights({
      runRecords,
      observationSummary,
    }),
  };
};

const renderPaperSystemEvalMarkdown = summary => {
  const env = summary.observationSummary.environment || {};
  const runRows = summary.runs.map(run => [
    run.label,
    formatCount(run.totalCases),
    formatPercent(run.coverageRate),
    formatMs(run.firstTextDeltaAtMs),
    formatMs(run.averageTaskDurationMs),
    formatMs(run.threadCreateMs),
    formatMs(run.streamHandshakeMs),
    run.topLatencySource?.name || 'NA',
    formatPercent(run.topLatencySource?.shareOfProfiledTaskTime),
    formatPercent(run.policyCompositeErrorRate),
  ]);

  const resourceRows = summary.observationSummary.resourceSamples.map(sample => [
    sample.label,
    formatCount(sample.sampleCount),
    formatCount(sample.windowSeconds),
    Number.isFinite(sample.cpuPercentAvg) ? `${formatNumber(sample.cpuPercentAvg, 1)}%` : 'NA',
    Number.isFinite(sample.cpuPercentPeak) ? `${formatNumber(sample.cpuPercentPeak, 1)}%` : 'NA',
    formatNumber(sample.rssMbAvg, 1),
    formatNumber(sample.rssMbPeak, 1),
    sample.source || 'NA',
  ]);

  const closedLoopRows = summary.observationSummary.closedLoopChecks.map(check => [
    check.label,
    check.status || 'unknown',
    check.expectedCompanionPhase || 'NA',
    check.observedCompanionPhase || 'NA',
    formatMs(check.observedLatencyMs),
    check.notes || 'NA',
  ]);

  const lines = [
    '# 论文正文草稿：系统层评估',
    '',
    '## 使用说明',
    '',
    '以下内容由系统评测汇总脚本自动生成，目标是作为论文“系统层评估”部分的直接改写底稿，而不是最终定稿。',
    '',
    `生成时间：${summary.generatedAt}`,
    '',
    '运行目录：',
    ...summary.runs.map(run => `- \`${run.label}\`: \`${run.dir}\``),
  ];

  if (summary.observationsPath) {
    lines.push(`- 手工观测：\`${summary.observationsPath}\``);
  }

  lines.push(
    '',
    '## 可直接写入正文的结果概述',
    '',
    ...summary.highlights.map(item => `- ${item}`),
    '',
    '## 评估环境',
    '',
    `- 设备：${normalizeText(env.machine) || '待补充'}`,
    `- 系统：${normalizeText(env.os) || '待补充'}`,
    `- 构建形态：${normalizeText(env.build) || '待补充'}`,
    `- 显示设置：${normalizeText(env.displayScale) || '待补充'}`,
    `- 环境备注：${normalizeText(env.notes) || '无'}`,
    '',
    '## 表 1 自动化运行摘要',
    '',
    buildMarkdownTable(
      ['运行', '样本数', '覆盖率', '首字延迟', '平均任务时长', '线程创建', '流握手', '主导耗时源', '主导耗时占比', '复合错误率'],
      runRows.length > 0 ? runRows : [['NA', 'NA', 'NA', 'NA', 'NA', 'NA', 'NA', 'NA', 'NA', 'NA']]
    ),
    '',
    '## 表 2 资源占用采样',
    '',
    buildMarkdownTable(
      ['场景', '样本数', '观测窗口(s)', 'CPU 均值', 'CPU 峰值', 'RSS 均值(MB)', 'RSS 峰值(MB)', '采样来源'],
      resourceRows.length > 0 ? resourceRows : [['暂无记录', 'NA', 'NA', 'NA', 'NA', 'NA', 'NA', 'NA']]
    ),
    '',
    '## 表 3 功能闭环核查',
    '',
    buildMarkdownTable(
      ['场景', '状态', '期望 phase', '观测 phase', '观测延迟', '备注'],
      closedLoopRows.length > 0 ? closedLoopRows : [['暂无记录', 'NA', 'NA', 'NA', 'NA', 'NA']]
    ),
    '',
    '## 写作提醒',
    '',
    '- 系统层章节应优先回答“闭环是否成立、延迟主要耗时在哪里、资源画像是否透明”这三个问题。',
    '- 如果闭环核查中存在 `partial` 或 `fail`，正文应诚实说明原因，不要把未通过场景写成“已稳定支持”。',
    '- 资源占用应强调为真实桌面环境下的观测记录，不应将不同机器间结果直接横向比较。',
  );

  return `${lines.join('\n')}\n`;
};

const writeOutputs = async summary => {
  await ensureDir(summary.outputDir);

  const summaryPath = path.join(summary.outputDir, 'system-eval-summary.json');
  const markdownPath = path.join(summary.outputDir, 'paper-system-eval-section.md');
  const markdown = renderPaperSystemEvalMarkdown(summary);

  await fsp.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await fsp.writeFile(markdownPath, markdown, 'utf8');

  return {
    summaryPath,
    markdownPath,
  };
};

const main = async argv => {
  const options = parseArgs(argv);
  const summary = await buildSystemEvalSummary(options);
  const outputs = await writeOutputs(summary);

  process.stdout.write(
    `${JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        runCount: summary.runs.length,
        observationsPath: summary.observationsPath,
        summaryPath: outputs.summaryPath,
        markdownPath: outputs.markdownPath,
      },
      null,
      2
    )}\n`
  );
};

if (require.main === module) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildSystemEvalSummary,
  parseArgs,
  parseRunMapping,
  renderPaperSystemEvalMarkdown,
};
