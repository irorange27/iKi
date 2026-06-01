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

const parseArgs = argv => {
  const parsed = {};

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
      case 'judgments':
        parsed.judgmentsPath = consumeValue();
        break;
      case 'judge-key':
        parsed.judgeKeyPath = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'alpha':
        parsed.alpha = Number.parseFloat(consumeValue());
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.judgmentsPath) throw new Error('Missing required --judgments');
  if (!parsed.judgeKeyPath) throw new Error('Missing required --judge-key');
  if (!parsed.outputDir) throw new Error('Missing required --output-dir');
  if (!Number.isFinite(parsed.alpha) || parsed.alpha <= 0 || parsed.alpha >= 1) {
    parsed.alpha = 0.05;
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

const readJsonFile = async filePath =>
  JSON.parse(await fsp.readFile(path.resolve(filePath), 'utf8'));

const buildPreferenceTable = ({ judgments, judgeKey }) => {
  const keyBySceneId = new Map();
  for (const entry of judgeKey) {
    keyBySceneId.set(entry.scene_id, entry);
  }

  let prefA = 0;
  let prefB = 0;
  let noPref = 0;
  let total = 0;

  const perScene = [];

  for (const judgment of judgments) {
    const sceneId = normalizeText(judgment.scene_id || judgment.judge_item_id || '');
    const preference = normalizeText(judgment.preference || judgment.choice || '').toLowerCase();

    const key = keyBySceneId.get(sceneId);
    if (!key) {
      process.stderr.write(`[v3-analyze] Warning: No key found for scene "${sceneId}"\n`);
      continue;
    }

    total += 1;

    let resolvedPreference = 'no_preference';
    if (preference === 'a' || preference === 'prefer_a' || preference === '偏好a' || preference === '偏好 a') {
      resolvedPreference = 'a';
      prefA += 1;
    } else if (preference === 'b' || preference === 'prefer_b' || preference === '偏好b' || preference === '偏好 b') {
      resolvedPreference = 'b';
      prefB += 1;
    } else {
      noPref += 1;
    }

    const actualModePreferred = resolvedPreference === 'a'
      ? key.slot_a_mode
      : resolvedPreference === 'b'
        ? key.slot_b_mode
        : 'none';

    perScene.push({
      scene_id: sceneId,
      preference: resolvedPreference,
      slot_a_mode: key.slot_a_mode,
      slot_b_mode: key.slot_b_mode,
      actual_mode_preferred: actualModePreferred,
    });
  }

  return {
    total,
    prefA,
    prefB,
    noPref,
    prefARate: total > 0 ? prefA / total : 0,
    prefBRate: total > 0 ? prefB / total : 0,
    noPrefRate: total > 0 ? noPref / total : 0,
    perScene,
  };
};

const binomialTest = (k, n, p = 0.5) => {
  if (n === 0) return { pValue: 1, significant: false };

  let pValue = 0;
  for (let i = 0; i <= n; i += 1) {
    const prob = binomialProb(i, n, p);
    if (i >= k) pValue += prob;
  }

  return {
    pValue: Math.min(1, Math.round(pValue * 10000) / 10000),
    significant: pValue < 0.05,
  };
};

const binomialProb = (k, n, p) => {
  const coef = factorial(n) / (factorial(k) * factorial(n - k));
  return coef * Math.pow(p, k) * Math.pow(1 - p, n - k);
};

const factorial = n => {
  if (n <= 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i += 1) result *= i;
  return result;
};

const analyzeModePreferences = ({ perScene, modes }) => {
  const [modeA, modeB] = modes || ['no_affect', 'explicit_policy'];
  const modeCounts = { [modeA]: 0, [modeB]: 0 };

  for (const entry of perScene) {
    if (entry.actual_mode_preferred === modeA) modeCounts[modeA] += 1;
    if (entry.actual_mode_preferred === modeB) modeCounts[modeB] += 1;
  }

  const decidedTotal = modeCounts[modeA] + modeCounts[modeB];
  const winRate = decidedTotal > 0 ? modeCounts[modeB] / decidedTotal : 0;

  const { pValue, significant } = binomialTest(modeCounts[modeB], decidedTotal);

  return {
    [modeA]: modeCounts[modeA],
    [modeB]: modeCounts[modeB],
    decided_total: decidedTotal,
    winner: modeCounts[modeA] > modeCounts[modeB] ? modeA
      : modeCounts[modeB] > modeCounts[modeA] ? modeB : 'tie',
    win_rate_for_mode_b: Math.round(winRate * 10000) / 10000,
    binomial_p_value: pValue,
    statistically_significant: significant,
  };
};

const buildMarkdownReport = ({ preferenceTable, modeAnalysis, modes }) => {
  const [modeA, modeB] = modes || ['no_affect', 'explicit_policy'];

  return [
    '# V3 盲评结果分析',
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '## 总体偏好分布',
    '',
    `| 指标 | 数值 |`,
    `| --- | --- |`,
    `| 总评估数 | ${preferenceTable.total} |`,
    `| 偏好 A | ${preferenceTable.prefA} (${(preferenceTable.prefARate * 100).toFixed(1)}%) |`,
    `| 偏好 B | ${preferenceTable.prefB} (${(preferenceTable.prefBRate * 100).toFixed(1)}%) |`,
    `| 无偏好 | ${preferenceTable.noPref} (${(preferenceTable.noPrefRate * 100).toFixed(1)}%) |`,
    '',
    '## 系统条件偏好分析',
    '',
    `比较条件：\`${modeA}\` vs \`${modeB}\``,
    '',
    `| 指标 | 数值 |`,
    `| --- | --- |`,
    `| 偏好 \`${modeA}\` 的场景数 | ${modeAnalysis[modeA]} |`,
    `| 偏好 \`${modeB}\` 的场景数 | ${modeAnalysis[modeB]} |`,
    `| 有明确偏好的场景总数 | ${modeAnalysis.decided_total} |`,
    `| \`${modeB}\` 在有偏好场景中的胜率 | ${(modeAnalysis.win_rate_for_mode_b * 100).toFixed(1)}% |`,
    `| 二项检验 p 值 | ${modeAnalysis.binomial_p_value} |`,
    `| 统计显著 (α = 0.05) | ${modeAnalysis.statistically_significant ? '是' : '否'} |`,
    '',
    '## 逐场景详情',
    '',
    `| 场景 ID | 偏好 | 实际偏好模式 |`,
    `| --- | --- | --- |`,
    ...preferenceTable.perScene.map(entry =>
      `| ${entry.scene_id} | ${entry.preference} | ${entry.actual_mode_preferred} |`
    ),
    '',
    '## 写作建议',
    '',
    `- 如果 \`${modeB}\` 在有偏好场景中的胜率显著高于 50%（二项检验 p < 0.05），可以作为支持显式策略层有效性的证据。`,
    '- 高"无偏好"率说明两个条件在部分场景中差异不明显，这本身也是有价值的发现。',
    '- 正文中应同时报告整体偏好分布和二项检验结果。',
    '',
  ].join('\n');
};

const main = async argv => {
  const options = parseArgs(argv);
  const outputDir = path.resolve(options.outputDir);
  await ensureDir(outputDir);

  const judgments = await readJsonLines(options.judgmentsPath);
  const judgeKey = await readJsonLines(options.judgeKeyPath);

  const keyEntry = judgeKey[0] || {};
  const modes = [keyEntry.slot_a_mode, keyEntry.slot_b_mode].filter(Boolean);

  const preferenceTable = buildPreferenceTable({ judgments, judgeKey });
  const modeAnalysis = analyzeModePreferences({
    perScene: preferenceTable.perScene,
    modes,
  });

  const results = {
    generatedAt: new Date().toISOString(),
    judgmentsPath: options.judgmentsPath,
    judgeKeyPath: options.judgeKeyPath,
    totalJudgments: judgments.length,
    preferenceTable,
    modeAnalysis,
  };

  await fsp.writeFile(
    path.join(outputDir, 'v3-blind-analysis.json'),
    `${JSON.stringify(results, null, 2)}\n`,
    'utf8'
  );

  const markdown = buildMarkdownReport({ preferenceTable, modeAnalysis, modes });
  await fsp.writeFile(
    path.join(outputDir, 'v3-blind-analysis-report.md'),
    `${markdown}\n`,
    'utf8'
  );

  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
};

module.exports = {
  parseArgs,
  buildPreferenceTable,
  analyzeModePreferences,
  binomialTest,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
