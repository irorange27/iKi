#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');

const {
  normalizeCase,
  normalizeGold,
} = require('./run-affect-benchmark.cjs');

const VALID_AFFECT_MODES = new Set(['no_affect', 'tone_only', 'explicit_policy']);
const SCORE_KEYS = [
  'state_exact_match',
  'escalation_exact_match',
  'policy_over_intervention',
  'policy_under_help',
  'escalation_error',
  'policy_composite_error',
];

const MODE_LABELS = {
  no_affect: '无情感信号（no_affect）',
  tone_only: '仅语气/上下文（tone_only）',
  explicit_policy: '显式情感策略（explicit_policy）',
};

const SET_LABELS = {
  main: '主测试集',
  neutral: '中性对照集',
};

const MAIN_VARIANT_LABELS = {
  ready_execute: '已准备执行',
  blocked_by_affect: '情绪阻塞',
  ambiguous_need: '需求未明',
  boundary_or_escalate: '边界/升级',
  underspecified_execute: '信息不足但请求直接执行',
};

const normalizeText = value => {
  if (typeof value !== 'string') return '';
  return value.trim();
};

const ensureDir = async dirPath => {
  await fsp.mkdir(dirPath, { recursive: true });
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

const average = values => {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const round = value => {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
};

const formatRate = value => {
  if (!Number.isFinite(value)) return 'NA';
  return `${(value * 100).toFixed(1)}%`;
};

const formatDeltaPoints = value => {
  if (!Number.isFinite(value)) return 'NA';
  const points = Math.abs(value * 100).toFixed(1);
  if (value === 0) return '持平';
  return `${value < 0 ? '下降' : '上升'} ${points} 个百分点`;
};

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
      case 'run':
        parsed.runs.push(consumeValue());
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
  if (parsed.runs.length === 0) throw new Error('Missing required --run');

  return parsed;
};

const parseRunMapping = value => {
  const raw = normalizeText(value);
  const separatorIndex = raw.indexOf('=');
  if (separatorIndex <= 0 || separatorIndex === raw.length - 1) {
    throw new Error(`Invalid --run value "${value}". Expected <mode>=<dir>`);
  }

  const mode = raw.slice(0, separatorIndex).trim();
  const dir = raw.slice(separatorIndex + 1).trim();
  if (!VALID_AFFECT_MODES.has(mode)) {
    throw new Error(`Invalid run mode "${mode}"`);
  }
  if (!dir) {
    throw new Error(`Invalid run dir in "${value}"`);
  }

  return {
    mode,
    dir: path.resolve(dir),
  };
};

const buildCaseMetadata = ({ mainCases, mainGolds, neutralCases, neutralGolds }) => {
  const metadata = new Map();
  const allCases = [
    ...mainCases.map(entry => ({ ...entry, setId: 'main' })),
    ...neutralCases.map(entry => ({ ...entry, setId: 'neutral' })),
  ];
  const allGolds = [
    ...mainGolds.map(entry => ({ ...entry, setId: 'main' })),
    ...neutralGolds.map(entry => ({ ...entry, setId: 'neutral' })),
  ];

  const caseById = new Map(allCases.map(entry => [entry.caseId, entry]));
  for (const goldEntry of allGolds) {
    const caseEntry = caseById.get(goldEntry.caseId);
    if (!caseEntry) {
      throw new Error(`Gold references unknown case_id "${goldEntry.caseId}"`);
    }

    metadata.set(goldEntry.caseId, {
      caseId: goldEntry.caseId,
      setId: goldEntry.setId,
      setLabel: SET_LABELS[goldEntry.setId],
      baseTaskId: goldEntry.baseTaskId || caseEntry.baseTaskId || '',
      variantId: goldEntry.variantId || caseEntry.variantId || '',
      variantLabel:
        goldEntry.setId === 'main'
          ? MAIN_VARIANT_LABELS[goldEntry.variantId] || (goldEntry.variantId || '未命名变体')
          : goldEntry.variantId || '中性样本',
      slice: goldEntry.slice || caseEntry.slice || '',
      taskDomain: goldEntry.taskDomain || '',
      goldLabels: goldEntry.labels,
    });
  }

  return metadata;
};

const summarizeScoreRows = rows => ({
  total_cases: rows.length,
  valid_predictions: rows.filter(row => row.valid_prediction).length,
  missing_predictions: rows.filter(row => row.status === 'missing_prediction').length,
  coverage_rate: round(average(rows.map(row => Number(Boolean(row.valid_prediction))))),
  state_exact_match_rate: round(average(rows.map(row => row.state_exact_match || 0))),
  escalation_exact_match_rate: round(average(rows.map(row => row.escalation_exact_match || 0))),
  policy_over_intervention_rate: round(
    average(rows.map(row => row.policy_over_intervention || 0))
  ),
  policy_under_help_rate: round(average(rows.map(row => row.policy_under_help || 0))),
  escalation_error_rate: round(average(rows.map(row => row.escalation_error || 0))),
  policy_composite_error_rate: round(
    average(rows.map(row => row.policy_composite_error || 0))
  ),
});

const buildScoreIndex = scoreRows =>
  new Map(scoreRows.map(row => [row.case_id, row]));

const buildParsedPredictionIndex = parsedRows => {
  const index = new Map();
  for (const row of parsedRows) {
    if (!row || row.ok !== true || !row.prediction) continue;
    index.set(row.prediction.case_id, row.prediction);
  }
  return index;
};

const loadRunArtifacts = async run => {
  const scoreResults = await readJsonFile(path.join(run.dir, 'score', 'results.json'));
  const parsedResults = await readJsonFile(path.join(run.dir, 'parsed-results.json'));
  const runSummary = await readJsonFile(path.join(run.dir, 'run-summary.json'));

  return {
    mode: run.mode,
    dir: run.dir,
    runSummary,
    scoreRows: Array.isArray(scoreResults.results) ? scoreResults.results : [],
    parsedRows: Array.isArray(parsedResults) ? parsedResults : [],
  };
};

const buildSetMetrics = ({ runs, caseMetadata }) => {
  const rows = [];

  for (const run of runs) {
    const scoreRows = run.scoreRows.map(row => ({
      ...row,
      caseMeta: caseMetadata.get(row.case_id) || null,
    }));

    for (const setId of ['main', 'neutral']) {
      const setRows = scoreRows.filter(row => row.caseMeta?.setId === setId);
      rows.push({
        mode: run.mode,
        modeLabel: MODE_LABELS[run.mode],
        setId,
        setLabel: SET_LABELS[setId],
        ...summarizeScoreRows(setRows),
      });
    }
  }

  return rows;
};

const buildMainVariantMetrics = ({ runs, caseMetadata }) => {
  const variantIds = Array.from(
    new Set(
      Array.from(caseMetadata.values())
        .filter(entry => entry.setId === 'main')
        .map(entry => entry.variantId)
    )
  );

  return variantIds.map(variantId => {
    const row = {
      variantId,
      variantLabel: MAIN_VARIANT_LABELS[variantId] || variantId,
      totalCases: Array.from(caseMetadata.values()).filter(
        entry => entry.setId === 'main' && entry.variantId === variantId
      ).length,
    };

    for (const run of runs) {
      const subset = run.scoreRows.filter(rowEntry => {
        const meta = caseMetadata.get(rowEntry.case_id);
        return meta?.setId === 'main' && meta.variantId === variantId;
      });
      row[run.mode] = summarizeScoreRows(subset);
    }

    const base = row.no_affect?.policy_composite_error_rate;
    const explicit = row.explicit_policy?.policy_composite_error_rate;
    const toneOnly = row.tone_only?.policy_composite_error_rate;
    row.explicitVsNoAffectDelta = Number.isFinite(base) && Number.isFinite(explicit)
      ? round(explicit - base)
      : null;
    row.explicitVsToneOnlyDelta = Number.isFinite(toneOnly) && Number.isFinite(explicit)
      ? round(explicit - toneOnly)
      : null;

    return row;
  });
};

const buildRuntimeAudit = ({ runs, caseMetadata }) =>
  runs.map(run => {
    const validPredictions = run.parsedRows
      .filter(row => row?.ok === true && row.prediction)
      .map(row => row.prediction);

    const bySet = {};
    for (const setId of ['main', 'neutral']) {
      const setPredictions = validPredictions.filter(
        entry => caseMetadata.get(entry.case_id)?.setId === setId
      );
      bySet[setId] = {
        parsed_cases: setPredictions.length,
        runtime_policy_applied_rate: round(
          average(
            setPredictions.map(entry =>
              Number(Boolean(entry.metadata?.runtime_policy_applied))
            )
          )
        ),
        runtime_policy_affect_used_rate: round(
          average(
            setPredictions.map(entry =>
              Number(Boolean(entry.metadata?.runtime_policy_affect_used))
            )
          )
        ),
      };
    }

    return {
      mode: run.mode,
      modeLabel: MODE_LABELS[run.mode],
      all: {
        parsed_cases: validPredictions.length,
        runtime_policy_applied_rate: round(
          average(
            validPredictions.map(entry =>
              Number(Boolean(entry.metadata?.runtime_policy_applied))
            )
          )
        ),
        runtime_policy_affect_used_rate: round(
          average(
            validPredictions.map(entry =>
              Number(Boolean(entry.metadata?.runtime_policy_affect_used))
            )
          )
        ),
      },
      bySet,
    };
  });

const buildPairwiseComparison = ({ runs, caseMetadata, baselineMode = 'no_affect' }) => {
  const runByMode = new Map(runs.map(run => [run.mode, run]));
  const baseline = runByMode.get(baselineMode);
  if (!baseline) return [];

  const baselineScoreIndex = buildScoreIndex(baseline.scoreRows);
  const baselinePredictionIndex = buildParsedPredictionIndex(baseline.parsedRows);
  const comparisons = [];

  for (const run of runs) {
    if (run.mode === baselineMode) continue;

    const runScoreIndex = buildScoreIndex(run.scoreRows);
    const runPredictionIndex = buildParsedPredictionIndex(run.parsedRows);

    for (const setId of ['main', 'neutral']) {
      const caseIds = Array.from(caseMetadata.values())
        .filter(entry => entry.setId === setId)
        .map(entry => entry.caseId);

      const improvedFlags = [];
      const worsenedFlags = [];
      const unchangedFlags = [];
      const changeFlags = [];
      const affectUsedFlags = [];
      const appliedFlags = [];

      for (const caseId of caseIds) {
        const baselineScore = baselineScoreIndex.get(caseId);
        const currentScore = runScoreIndex.get(caseId);
        if (baselineScore && currentScore) {
          const baselineError = baselineScore.policy_composite_error;
          const currentError = currentScore.policy_composite_error;
          improvedFlags.push(Number(currentError < baselineError));
          worsenedFlags.push(Number(currentError > baselineError));
          unchangedFlags.push(Number(currentError === baselineError));
        }

        const baselinePrediction = baselinePredictionIndex.get(caseId);
        const currentPrediction = runPredictionIndex.get(caseId);
        if (baselinePrediction && currentPrediction) {
          changeFlags.push(
            Number(
              baselinePrediction.policy_action?.intervention_state !==
                currentPrediction.policy_action?.intervention_state ||
                baselinePrediction.policy_action?.escalate !==
                  currentPrediction.policy_action?.escalate
            )
          );
          affectUsedFlags.push(
            Number(Boolean(currentPrediction.metadata?.runtime_policy_affect_used))
          );
          appliedFlags.push(
            Number(Boolean(currentPrediction.metadata?.runtime_policy_applied))
          );
        }
      }

      comparisons.push({
        baselineMode,
        targetMode: run.mode,
        targetModeLabel: MODE_LABELS[run.mode],
        setId,
        setLabel: SET_LABELS[setId],
        total_cases: caseIds.length,
        policy_improved_rate: round(average(improvedFlags)),
        policy_worsened_rate: round(average(worsenedFlags)),
        policy_unchanged_rate: round(average(unchangedFlags)),
        predicted_action_compared_cases: changeFlags.length,
        predicted_action_change_rate: round(average(changeFlags)),
        target_runtime_policy_affect_used_rate: round(average(affectUsedFlags)),
        target_runtime_policy_applied_rate: round(average(appliedFlags)),
      });
    }
  }

  return comparisons;
};

const selectSetMetric = (rows, setId, mode) =>
  rows.find(entry => entry.setId === setId && entry.mode === mode) || null;

const buildNarrative = ({ setMetrics, pairwiseComparisons, runtimeAudit }) => {
  const mainExplicit = selectSetMetric(setMetrics, 'main', 'explicit_policy');
  const mainNoAffect = selectSetMetric(setMetrics, 'main', 'no_affect');
  const mainToneOnly = selectSetMetric(setMetrics, 'main', 'tone_only');
  const neutralExplicit = selectSetMetric(setMetrics, 'neutral', 'explicit_policy');
  const neutralNoAffect = selectSetMetric(setMetrics, 'neutral', 'no_affect');
  const neutralToneOnly = selectSetMetric(setMetrics, 'neutral', 'tone_only');
  const explicitAudit = runtimeAudit.find(entry => entry.mode === 'explicit_policy');
  const toneOnlyAudit = runtimeAudit.find(entry => entry.mode === 'tone_only');
  const explicitVsBaselineMain = pairwiseComparisons.find(
    entry => entry.targetMode === 'explicit_policy' && entry.setId === 'main'
  );
  const toneOnlyVsBaselineMain = pairwiseComparisons.find(
    entry => entry.targetMode === 'tone_only' && entry.setId === 'main'
  );

  const lines = [];

  if (mainExplicit && mainNoAffect && mainToneOnly) {
    lines.push(
      `在主测试集上，\`explicit_policy\` 的 \`policy_composite_error_rate\` 为 ${formatRate(mainExplicit.policy_composite_error_rate)}，相较 \`no_affect\` 的 ${formatRate(mainNoAffect.policy_composite_error_rate)} ${formatDeltaPoints(mainExplicit.policy_composite_error_rate - mainNoAffect.policy_composite_error_rate)}，相较 \`tone_only\` 的 ${formatRate(mainToneOnly.policy_composite_error_rate)} ${formatDeltaPoints(mainExplicit.policy_composite_error_rate - mainToneOnly.policy_composite_error_rate)}。`
    );
  }

  if (neutralExplicit && neutralNoAffect && neutralToneOnly) {
    lines.push(
      `在中性对照集上，\`explicit_policy\` 的 \`policy_composite_error_rate\` 为 ${formatRate(neutralExplicit.policy_composite_error_rate)}，相较 \`no_affect\` 的 ${formatRate(neutralNoAffect.policy_composite_error_rate)} ${formatDeltaPoints(neutralExplicit.policy_composite_error_rate - neutralNoAffect.policy_composite_error_rate)}，相较 \`tone_only\` 的 ${formatRate(neutralToneOnly.policy_composite_error_rate)} ${formatDeltaPoints(neutralExplicit.policy_composite_error_rate - neutralToneOnly.policy_composite_error_rate)}。`
    );
  }

  if (explicitVsBaselineMain && toneOnlyVsBaselineMain) {
    lines.push(
      `相对 \`no_affect\`，主测试集中 \`explicit_policy\` 的案例级动作变化率为 ${formatRate(explicitVsBaselineMain.predicted_action_change_rate)}，而 \`tone_only\` 为 ${formatRate(toneOnlyVsBaselineMain.predicted_action_change_rate)}；若前者显著更高，可作为“情感信号改变了干预方式而不只是改变语气”的辅助证据。`
    );
  }

  if (explicitAudit && toneOnlyAudit) {
    lines.push(
      `运行时审计显示，\`explicit_policy\` 的 \`runtime_policy_applied\` 比例为 ${formatRate(explicitAudit.all.runtime_policy_applied_rate)}、\`runtime_policy_affect_used\` 比例为 ${formatRate(explicitAudit.all.runtime_policy_affect_used_rate)}；\`tone_only\` 对应比例分别为 ${formatRate(toneOnlyAudit.all.runtime_policy_applied_rate)} 和 ${formatRate(toneOnlyAudit.all.runtime_policy_affect_used_rate)}。`
    );
  }

  return lines;
};

const buildMarkdownReport = ({
  setMetrics,
  mainVariantMetrics,
  runtimeAudit,
  pairwiseComparisons,
  narrative,
  runDirs,
}) => {
  const mainRows = ['no_affect', 'tone_only', 'explicit_policy']
    .map(mode => selectSetMetric(setMetrics, 'main', mode))
    .filter(Boolean)
    .map(entry => [
      entry.modeLabel,
      entry.total_cases,
      formatRate(entry.coverage_rate),
      formatRate(entry.policy_composite_error_rate),
      formatRate(entry.policy_over_intervention_rate),
      formatRate(entry.policy_under_help_rate),
      formatRate(entry.escalation_error_rate),
    ]);

  const neutralRows = ['no_affect', 'tone_only', 'explicit_policy']
    .map(mode => selectSetMetric(setMetrics, 'neutral', mode))
    .filter(Boolean)
    .map(entry => [
      entry.modeLabel,
      entry.total_cases,
      formatRate(entry.coverage_rate),
      formatRate(entry.policy_composite_error_rate),
      formatRate(entry.policy_over_intervention_rate),
      formatRate(entry.policy_under_help_rate),
      formatRate(entry.escalation_error_rate),
    ]);

  const variantRows = mainVariantMetrics.map(entry => [
    entry.variantLabel,
    entry.totalCases,
    formatRate(entry.no_affect?.policy_composite_error_rate),
    formatRate(entry.tone_only?.policy_composite_error_rate),
    formatRate(entry.explicit_policy?.policy_composite_error_rate),
    formatDeltaPoints(entry.explicitVsNoAffectDelta),
  ]);

  const comparisonRows = pairwiseComparisons.map(entry => [
    `${entry.targetModeLabel} 相对 ${MODE_LABELS[entry.baselineMode]}`,
    entry.setLabel,
    entry.total_cases,
    formatRate(entry.policy_improved_rate),
    formatRate(entry.policy_worsened_rate),
    formatRate(entry.predicted_action_change_rate),
    formatRate(entry.target_runtime_policy_affect_used_rate),
    formatRate(entry.target_runtime_policy_applied_rate),
  ]);

  const auditRows = runtimeAudit.map(entry => [
    entry.modeLabel,
    entry.all.parsed_cases,
    formatRate(entry.all.runtime_policy_applied_rate),
    formatRate(entry.all.runtime_policy_affect_used_rate),
    formatRate(entry.bySet.main.runtime_policy_affect_used_rate),
    formatRate(entry.bySet.neutral.runtime_policy_affect_used_rate),
  ]);

  return [
    '# 论文正文草稿：实验结果',
    '',
    '## 使用说明',
    '',
    '以下内容由 benchmark 运行产物自动汇总生成，目标是作为论文“实验结果”部分的直接改写底稿，而不是最终定稿。',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '运行目录：',
    ...runDirs.map(entry => `- \`${entry.mode}\`: \`${entry.dir}\``),
    '',
    '## 可直接写入正文的结果概述',
    '',
    ...narrative.map(line => `- ${line}`),
    '',
    '## 表 1 主测试集总体结果',
    '',
    buildMarkdownTable(
      ['条件', '样本数', '覆盖率', '复合错误率', '过度干预率', '帮助不足率', '升级错误率'],
      mainRows
    ),
    '',
    '## 表 2 中性对照集总体结果',
    '',
    buildMarkdownTable(
      ['条件', '样本数', '覆盖率', '复合错误率', '过度干预率', '帮助不足率', '升级错误率'],
      neutralRows
    ),
    '',
    '## 表 3 主测试集按变体结果',
    '',
    buildMarkdownTable(
      [
        '变体',
        '样本数',
        'no_affect 复合错误率',
        'tone_only 复合错误率',
        'explicit_policy 复合错误率',
        'explicit 相对 no_affect',
      ],
      variantRows
    ),
    '',
    '## 表 4 相对 no_affect 的案例级变化',
    '',
    buildMarkdownTable(
      ['比较', '数据集', '样本数', '改善率', '恶化率', '动作变化率', 'affect_used 率', 'policy_applied 率'],
      comparisonRows
    ),
    '',
    '## 表 5 运行时审计',
    '',
    buildMarkdownTable(
      ['条件', '已解析样本', 'policy_applied 率', 'affect_used 率', '主测试集 affect_used 率', '中性集 affect_used 率'],
      auditRows
    ),
    '',
    '## 写作提醒',
    '',
    '- 如果主测试集下降而中性对照集没有明显恶化，可以分别对应研究问题一和研究问题二。',
    '- 如果 `explicit_policy` 的动作变化率明显高于 `tone_only`，同时运行时审计里 `policy_applied` 为高而 `tone_only` 接近零，可以支撑研究问题三。',
    '- 正文里建议把“百分点变化”作为主表述，把原始比率放在表格中。',
    '',
  ].join('\n');
};

const main = async argv => {
  const options = parseArgs(argv);
  const runDirs = options.runs.map(parseRunMapping);
  const outputDir = path.resolve(options.outputDir);

  const [mainCases, mainGolds, neutralCases, neutralGolds] = await Promise.all([
    readJsonLines(options.mainCasesPath).then(rows => rows.map(normalizeCase)),
    readJsonLines(options.mainGoldPath).then(rows => rows.map(normalizeGold)),
    readJsonLines(options.neutralCasesPath).then(rows => rows.map(normalizeCase)),
    readJsonLines(options.neutralGoldPath).then(rows => rows.map(normalizeGold)),
  ]);

  const caseMetadata = buildCaseMetadata({
    mainCases,
    mainGolds,
    neutralCases,
    neutralGolds,
  });

  const runs = [];
  for (const runDir of runDirs) {
    runs.push(await loadRunArtifacts(runDir));
  }

  runs.sort((left, right) => {
    const modeOrder = ['no_affect', 'tone_only', 'explicit_policy'];
    return modeOrder.indexOf(left.mode) - modeOrder.indexOf(right.mode);
  });

  const setMetrics = buildSetMetrics({ runs, caseMetadata });
  const mainVariantMetrics = buildMainVariantMetrics({ runs, caseMetadata });
  const runtimeAudit = buildRuntimeAudit({ runs, caseMetadata });
  const pairwiseComparisons = buildPairwiseComparison({ runs, caseMetadata });
  const narrative = buildNarrative({
    setMetrics,
    pairwiseComparisons,
    runtimeAudit,
  });

  const summary = {
    generatedAt: new Date().toISOString(),
    datasets: {
      mainCasesPath: path.resolve(options.mainCasesPath),
      mainGoldPath: path.resolve(options.mainGoldPath),
      neutralCasesPath: path.resolve(options.neutralCasesPath),
      neutralGoldPath: path.resolve(options.neutralGoldPath),
    },
    runs: runDirs,
    setMetrics,
    mainVariantMetrics,
    runtimeAudit,
    pairwiseComparisons,
    narrative,
  };

  await ensureDir(outputDir);
  await fsp.writeFile(
    path.join(outputDir, 'thesis-results-summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8'
  );

  const markdown = buildMarkdownReport({
    setMetrics,
    mainVariantMetrics,
    runtimeAudit,
    pairwiseComparisons,
    narrative,
    runDirs,
  });

  await fsp.writeFile(path.join(outputDir, 'paper-results-section.md'), `${markdown}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

module.exports = {
  MODE_LABELS,
  SET_LABELS,
  MAIN_VARIANT_LABELS,
  parseArgs,
  parseRunMapping,
  buildCaseMetadata,
  summarizeScoreRows,
  buildSetMetrics,
  buildMainVariantMetrics,
  buildRuntimeAudit,
  buildPairwiseComparison,
  buildNarrative,
  buildMarkdownReport,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
