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

const hashStringToSeed = value => {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createMulberry32 = seed => {
  let current = seed >>> 0;
  return () => {
    current += 0x6d2b79f5;
    let t = current;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleDeterministic = (items, seed) => {
  const output = [...items];
  const random = createMulberry32(seed);
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
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
      case 'matrix':
        parsed.matrixPath = consumeValue();
        break;
      case 'conversations':
        parsed.conversationsPath = consumeValue();
        break;
      case 'output-dir':
        parsed.outputDir = consumeValue();
        break;
      case 'seed':
        parsed.seed = Number.parseInt(consumeValue(), 10);
        break;
      case 'modes':
        parsed.modes = normalizeText(consumeValue())
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
        break;
      case 'format':
        parsed.format = normalizeText(consumeValue());
        break;
      case 'runs-dir':
        parsed.runsDir = consumeValue();
        break;
      default:
        throw new Error(`Unknown option: --${key}`);
    }
  }

  if (!parsed.matrixPath) throw new Error('Missing required --matrix');
  if (!parsed.conversationsPath) throw new Error('Missing required --conversations');
  if (!parsed.outputDir) throw new Error('Missing required --output-dir');

  if (!Number.isFinite(parsed.seed) || parsed.seed <= 0) {
    parsed.seed = 20260427;
  }
  if (!parsed.format || (parsed.format !== 'jsonl' && parsed.format !== 'csv')) {
    parsed.format = 'jsonl';
  }

  const validModes = ['no_affect', 'tone_only', 'explicit_policy'];
  if (!parsed.modes || parsed.modes.length < 2) {
    parsed.modes = ['no_affect', 'explicit_policy'];
  }
  for (const mode of parsed.modes) {
    if (!validModes.includes(mode)) {
      throw new Error(`Invalid mode "${mode}". Expected one of: ${validModes.join(', ')}`);
    }
  }

  return parsed;
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

const writeJsonLines = async (filePath, rows) => {
  const serialized = rows.map(row => JSON.stringify(row)).join('\n');
  await fsp.writeFile(filePath, serialized ? `${serialized}\n` : '', 'utf8');
};

const buildSceneContext = conversations => {
  const index = new Map();
  for (const entry of conversations) {
    const sceneId = normalizeText(entry.scene_id || entry.sceneId || '');
    if (!sceneId) continue;

    const history = Array.isArray(entry.history) ? entry.history : [];
    const taskContext = entry.task_context || entry.taskContext || {};

    index.set(sceneId, {
      scene_id: sceneId,
      narrative: normalizeText(entry.narrative || ''),
      history: history.map(msg => ({
        role: msg.role || '',
        text: normalizeText(msg.text ?? msg.content ?? ''),
      })).filter(m => m.role && m.text),
      current_user_message: normalizeText(entry.current_user_message || entry.currentUserMessage || ''),
      task_context: {
        goal: normalizeText(taskContext.goal || ''),
        deliverable: normalizeText(taskContext.deliverable || ''),
        constraints: Array.isArray(taskContext.constraints) ? taskContext.constraints : [],
      },
    });
  }

  return index;
};

const readResponseText = async ({ runsDir, sceneId, mode, modeDir }) => {
  if (!runsDir) return '';

  const dirName = modeDir || mode;
  const taskFile = path.join(runsDir, dirName, 'daemon', 'tasks', `${sceneId}.json`);
  try {
    const task = JSON.parse(await fsp.readFile(taskFile, 'utf8'));
    const text = typeof task.prediction === 'string'
      ? task.prediction
      : (task.result?.text || task.result?.prediction || '');
    return normalizeText(text);
  } catch {
    return '';
  }
};

const buildBlindPairs = async ({ matrix, sceneContext, modes, seed, runsDir }) => {
  const perScene = matrix.comparisonMatrix?.perScene || [];
  const pairs = [];
  const judgeKey = [];

  if (modes.length !== 2) {
    throw new Error('Blind evaluation currently supports exactly 2 modes for pairwise comparison');
  }

  const [modeA, modeB] = modes;

  for (const sceneEntry of perScene) {
    const sceneId = sceneEntry.scene_id;
    const context = sceneContext.get(sceneId);
    const metricsA = sceneEntry[modeA];
    const metricsB = sceneEntry[modeB];

    if (!metricsA || !metricsB) continue;

    let textA = metricsA.reply_text || '';
    let textB = metricsB.reply_text || '';

    if (runsDir) {
      const entries = await fsp.readdir(runsDir, { withFileTypes: true });
      const modeDirs = {};
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        for (const m of [modeA, modeB]) {
          if (entry.name.endsWith('-' + m)) {
            modeDirs[m] = entry.name;
          }
        }
      }
      textA = await readResponseText({ runsDir, sceneId, mode: modeA, modeDir: modeDirs[modeA] || modeA });
      textB = await readResponseText({ runsDir, sceneId, mode: modeB, modeDir: modeDirs[modeB] || modeB });
    }

    if (!textA || !textB) continue;

    const pairSeed = hashStringToSeed(`${seed}:${sceneId}`);
    const random = createMulberry32(pairSeed);
    const swapOrder = random() > 0.5;

    pairs.push({
      scene_id: sceneId,
      context: context ? {
        history: context.history,
        current_user_message: context.current_user_message,
        task_context: context.task_context,
      } : null,
      response_a: swapOrder ? textB : textA,
      response_a_stance: swapOrder ? metricsB.interaction_stance : metricsA.interaction_stance,
      response_b: swapOrder ? textA : textB,
      response_b_stance: swapOrder ? metricsA.interaction_stance : metricsB.interaction_stance,
    });

    judgeKey.push({
      scene_id: sceneId,
      slot_a_mode: swapOrder ? modeB : modeA,
      slot_b_mode: swapOrder ? modeA : modeB,
    });
  }

  return { pairs, judgeKey };
};

const buildJudgeInputJsonl = ({ pairs }) =>
  pairs.map((pair, index) => ({
    judge_item_id: `v3_judge_${String(index + 1).padStart(4, '0')}`,
    scene_id: pair.scene_id,
    context: pair.context,
    response_a: pair.response_a,
    response_b: pair.response_b,
  }));

const buildJudgeInputCsv = ({ pairs }) => {
  const header = 'judge_item_id,scene_id,history,current_user_message,task_goal,response_a,response_b';
  const rows = pairs.map((pair, index) => {
    const judgeItemId = `v3_judge_${String(index + 1).padStart(4, '0')}`;
    const historyStr = (pair.context?.history || [])
      .map(m => `${m.role}: ${m.text}`)
      .join(' | ');
    const userMsg = pair.context?.current_user_message || '';
    const taskGoal = pair.context?.task_context?.goal || '';

    const escapeCsv = s => `"${String(s).replace(/"/g, '""')}"`;

    return [
      judgeItemId,
      pair.scene_id,
      escapeCsv(historyStr),
      escapeCsv(userMsg),
      escapeCsv(taskGoal),
      escapeCsv(pair.response_a),
      escapeCsv(pair.response_b),
    ].join(',');
  });

  return `${header}\n${rows.join('\n')}\n`;
};

const buildEvaluationTemplate = ({ pairs, modes, matrixPath }) => {
  const [modeA, modeB] = modes;

  return [
    '# V3 盲评模板',
    '',
    '## 说明',
    '',
    `本文件包含 ${pairs.length} 个场景的盲评对比。每个场景展示了同一用户消息的两种 AI 回复（A 和 B），`,
    `分别来自两个不同系统条件。你的任务是判断哪个回复更好。`,
    '',
    '## 评估维度',
    '',
    '请从以下维度综合判断：',
    '1. **恰当性**：回复是否在恰当的时机做了恰当的事？（该推进时推进，该承接时承接）',
    '2. **帮助性**：回复是否真正帮助用户推进了他们的任务？',
    '3. **尊重感**：回复是否尊重用户的自主性和当前状态？',
    '4. **整体偏好**：综合考虑，你更偏好哪个回复？',
    '',
    '## 评分方式',
    '',
    '对每个场景，选择：',
    '- **偏好 A**：回复 A 明显更好',
    '- **偏好 B**：回复 B 明显更好',
    '- **无偏好**：两者质量相当或各有优劣',
    '',
    `系统条件：A 和 B 分别是 \`${modeA}\` 和 \`${modeB}\` 的随机排列结果。`,
    '',
    `生成时间：${new Date().toISOString()}`,
    `数据来源：${matrixPath}`,
    '',
  ].join('\n');
};

const main = async argv => {
  const options = parseArgs(argv);
  const outputDir = path.resolve(options.outputDir);
  await ensureDir(outputDir);

  const matrix = await readJsonFile(options.matrixPath);
  const conversations = await readJsonLines(options.conversationsPath);
  const sceneContext = buildSceneContext(conversations);

  const { pairs, judgeKey } = await buildBlindPairs({
    matrix,
    sceneContext,
    modes: options.modes,
    seed: options.seed,
    runsDir: options.runsDir || null,
  });

  const judgeInputPath = path.join(outputDir, 'v3-blind-judge-input.jsonl');
  const judgeKeyPath = path.join(outputDir, 'v3-blind-judge-key.jsonl');
  const templatePath = path.join(outputDir, 'v3-blind-evaluation-template.md');

  const judgeInput = buildJudgeInputJsonl({ pairs });
  await writeJsonLines(judgeInputPath, judgeInput);

  await writeJsonLines(judgeKeyPath, judgeKey);

  const template = buildEvaluationTemplate({
    pairs,
    modes: options.modes,
    matrixPath: options.matrixPath,
  });
  await fsp.writeFile(templatePath, `${template}\n`, 'utf8');

  if (options.format === 'csv') {
    const csvPath = path.join(outputDir, 'v3-blind-judge-input.csv');
    const csv = buildJudgeInputCsv({ pairs });
    await fsp.writeFile(csvPath, csv, 'utf8');
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    modes: options.modes,
    seed: options.seed,
    totalPairs: pairs.length,
    outputDir,
    judgeInputPath,
    judgeKeyPath,
    templatePath,
  };

  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
};

module.exports = {
  parseArgs,
  buildSceneContext,
  buildBlindPairs,
  buildJudgeInputJsonl,
  buildJudgeInputCsv,
  hashStringToSeed,
  shuffleDeterministic,
};

if (require.main === module) {
  void main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${String(error && error.stack ? error.stack : error)}\n`);
    process.exit(1);
  });
}
