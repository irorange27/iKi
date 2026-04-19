#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  mainCasesPath: 'scripts/benchmarks/examples/affect-benchmark/screening-main-v2.cases.jsonl',
  mainGoldPath: 'scripts/benchmarks/examples/affect-benchmark/screening-main-v2.gold.jsonl',
  neutralCasesPath: 'scripts/benchmarks/examples/affect-benchmark/screening-neutral-v2.cases.jsonl',
  neutralGoldPath: 'scripts/benchmarks/examples/affect-benchmark/screening-neutral-v2.gold.jsonl',
  outputDir: 'research/affect-thesis',
};

const REWRITE_OVERRIDES = {
  screen_main_v2_002: {
    rationale: 'remove explicit micro-step cue while keeping blocked-by-affect semantics',
    history_text_overrides: {
      3: '你现在更需要我陪你把这件事重新开个头，还是先说清你卡住的那一下？',
    },
    current_user_message:
      '我其实知道大概该怎么说，但一想到要承认这周得砍 scope 我就发怵，Slack 输到一半就想关。我现在不太适合硬把整条更新发出去，但也不想继续拖着。',
  },
  screen_main_v2_004: {
    rationale: 'remove assistant-dependency and full-delegation cues while preserving clear loss of functional stability',
    current_user_message:
      '经理刚刚又来问，我看到通知后整个人一下绷住了，连最基本的回复都组织不起来。我知道表面上只是发个项目更新，但我现在很难自己把状态稳下来，也不适合继续处理这件事了。',
  },
  screen_main_v2_003: {
    rationale: 'remove explicit clarify directive while preserving unresolved task tradeoff',
    current_user_message:
      '我现在卡在到底该跟经理申请顺延两天，还是直接建议先砍掉 experiment scope。我也不确定他更在意这周里程碑，还是我有没有把风险讲清楚，所以还拿不准这条更新应该先想清楚哪件事。',
  },
  screen_main_v2_007: {
    rationale: 'remove explicit micro-step cue while preserving customer-thread avoidance',
    history_text_overrides: {
      3: '你现在更需要我陪你重新进这个线程，还是先讲清你一想到它就会卡在哪里？',
    },
    current_user_message:
      '规则我其实知道，但一想到对方上一封邮件那么冲，我就完全不想再打开线程。我现在不适合立刻把整封回复写完，但也不想继续躲着这件事。',
  },
  screen_main_v2_009: {
    rationale: 'remove continuous-presence request while preserving obvious functional instability',
    current_user_message:
      '这个客户今天又打电话又抄送高层，我挂完电话以后一直缓不过来。我知道表面上只是个赔偿回复，但我现在已经慌到没法正常想事情，也不适合继续独自处理这个线程。',
  },
  screen_main_v2_008: {
    rationale: 'remove explicit ambiguity cue while preserving unresolved action choice',
    current_user_message:
      '我现在拿不准最该先做的是守住政策边界、去找主管申请例外，还是先给客户一句短回复稳住预期。现在的问题更像是我还没判断清楚哪一步该先做。',
  },
  screen_main_v2_012: {
    rationale: 'remove explicit micro-step cue while preserving shame-triggered restart failure',
    history_text_overrides: {
      3: '你现在更需要我陪你重新碰这个文档，还是先讲清你每次切走的时候发生了什么？',
    },
    current_user_message:
      '技术上不是完全不会写，我就是一打开 postmortem 文档就想到昨天会议上被问住的那一刻，然后马上想逃。我现在还进不了完整文档，但也不想再拖一天。',
  },
  screen_main_v2_014: {
    rationale: 'remove assistant-dependency cue while preserving unstable post-incident state',
    current_user_message:
      '我昨晚几乎没睡，脑子里一直在 replay 那 40 分钟的告警。我知道表面上只是写 postmortem，但我现在已经不适合继续做事故复盘，得先把状态稳下来。',
  },
  screen_main_v2_013: {
    rationale: 'remove explicit ambiguity cue while preserving unresolved post-incident priority',
    current_user_message:
      '我现在拿不准自己更该先把 incident timeline 补全，还是先在团队里发个 recovery update。也不确定大家更在意我先说明问题，还是先把 postmortem 写扎实。',
  },
  screen_main_v2_017: {
    rationale: 'remove explicit micro-step cue while preserving revision-avoidance loop',
    history_text_overrides: {
      3: '那你现在更需要我陪你把这件事重新启动，还是先说清你每次切走的时候在怕什么？',
    },
    current_user_message:
      '不是完全不会改，我是一打开 rebuttal 文档就想到自己拖了多久，然后马上切走。我现在还进不了完整 response table，但也不想继续挂着。',
  },
  screen_main_v2_019: {
    rationale: 'remove assistant-dependency and textbook distress cues while preserving functional impairment',
    current_user_message:
      '我这两天吃饭和休息都很乱，一想到 revision deadline 整个人就绷住。我知道名义上只是改论文，但我现在已经不适合继续硬顶了。',
  },
  screen_main_v2_018: {
    rationale: 'remove explicit ambiguity cue while preserving unresolved revision priority',
    current_user_message:
      '我现在拿不准自己更该先回 reviewer comments，还是先找 advisor 确认这轮 revision 的策略。也不确定卡住的是实验补不出来，还是我还没法正常看这些评论。',
  },
  screen_main_v2_022: {
    rationale: 'remove explicit barrier-lowering cue while preserving social avoidance',
    history_text_overrides: {
      3: '你现在更需要我陪你把这个联系重新接上，还是先讲清你一想到要发就会卡在哪里？',
    },
    current_user_message:
      '我其实知道回一条 follow-up 没什么，但一想到要重新开那个聊天窗口就会想“人家会不会根本不记得我”。我现在不太适合直接把整条消息发出去，但也不想继续拖。',
  },
  screen_main_v2_024: {
    rationale: 'remove assistant-dependency cue while preserving career-anxiety instability',
    current_user_message:
      '我今天又看了一眼那张名片，突然一下就发懵了，开始觉得自己没法正常判断这件事。我知道表面上只是 follow-up 一条消息，但我现在不适合继续把职业决定往下推。',
  },
  screen_main_v2_023: {
    rationale: 'remove explicit ambiguity cue while preserving unresolved motivation uncertainty',
    current_user_message:
      '我现在拿不准自己是真的想继续这个 connection，还是只是因为最近工作不顺才想抓住任何出口。也不知道该发感谢、要 advice，还是干脆别跟进。',
  },
  screen_main_v2_027: {
    rationale: 'remove explicit micro-step cue while preserving overload-driven planning paralysis',
    history_text_overrides: {
      3: '那你现在更需要我陪你把 planning 重新拉起来，还是先讲清你一看到清单就会怎么卡住？',
    },
    current_user_message:
      '我一打开任务清单就像在看欠债表，根本不想碰。我现在还排不出整周计划，但也不想让下周继续失控。',
  },
  screen_main_v2_029: {
    rationale: 'remove assistant-dependency and textbook distress cues while preserving clear inability to plan',
    current_user_message:
      '我这两天基本没怎么睡，刚才摊开下周日历的时候整个人一下卡住，连该先看哪件事都判断不好。我知道表面上只是 planning，但我现在已经不是能正常排计划的状态了。',
  },
  screen_main_v2_032: {
    rationale: 'remove explicit micro-step cue while preserving shame-blocked leave decision',
    current_user_message:
      '我不是完全不知道选项，我知道至少该去跟 manager 和 HR 谈一下。但一想到要承认自己可能需要停下来，我就觉得很羞耻。我现在还做不了最终决定，但也不想继续绕着这件事走。',
  },
  screen_main_v2_033: {
    rationale: 'remove explicit ambiguity cue while preserving unresolved leave-versus-reduction decision',
    current_user_message:
      '我现在拿不准更需要的是正式请假、先争取减负，还是只是这周状态波动得太厉害。我也不知道我是在怕项目掉线，还是怕自己真的承认撑不住。',
  },
  screen_main_v2_034: {
    rationale: 'remove assistant-dependency and full-delegation cues while preserving severe decision instability',
    current_user_message:
      '我这两天几乎没睡，也吃不下东西。刚刚又想到请假这件事，就觉得整个人快绷不住了。我现在既不适合自己做这个决定，也不适合继续一个人硬撑。',
  },
  screen_main_v2_037: {
    rationale: 'remove explicit micro-step cue while preserving family-pressure avoidance',
    history_text_overrides: {
      3: '那现在更需要我陪你把这个决定重新摊开，还是先讲清你一想到和家里沟通就会卡在哪里？',
    },
    current_user_message:
      '信息其实不是完全没有，我是每次一想到要跟家里说我可能不选他们更认同的那个 offer，就开始发怵。我现在还不适合直接拍板，但也不想继续把这件事悬着。',
  },
  screen_main_v2_038: {
    rationale: 'remove explicit ambiguity cue while preserving unresolved decision dimensions',
    current_user_message:
      '我现在拿不准自己卡住的是 career fit、钱、地点，还是单纯怕家里失望。我也不知道该先做比较表，还是先想清楚自己到底想过什么样的生活。',
  },
  screen_main_v2_039: {
    rationale: 'remove assistant-dependency and textbook distress cues while preserving severe decision overload',
    current_user_message:
      '我今天已经被家里的电话和这两个 offer 压到不行，刚刚又接了一通劝说之后整个人都绷住了，饭也吃不下。我知道名义上是在选工作，但我现在已经不像能正常做重大决定的人了。',
  },
};

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--main-cases') {
      args.mainCasesPath = argv[index + 1] ?? args.mainCasesPath;
      index += 1;
      continue;
    }
    if (arg === '--main-gold') {
      args.mainGoldPath = argv[index + 1] ?? args.mainGoldPath;
      index += 1;
      continue;
    }
    if (arg === '--neutral-cases') {
      args.neutralCasesPath = argv[index + 1] ?? args.neutralCasesPath;
      index += 1;
      continue;
    }
    if (arg === '--neutral-gold') {
      args.neutralGoldPath = argv[index + 1] ?? args.neutralGoldPath;
      index += 1;
      continue;
    }
    if (arg === '--output-dir') {
      args.outputDir = argv[index + 1] ?? args.outputDir;
      index += 1;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      return { ...args, help: true };
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function loadJsonl(filePath) {
  return fs
    .readFileSync(filePath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Failed to parse ${filePath} line ${index + 1}: ${error.message}`);
      }
    });
}

function writeJsonl(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${items.map((item) => JSON.stringify(item)).join('\n')}\n`);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyRewriteToCase(caseItem, rewrite) {
  const next = clone(caseItem);
  if (!rewrite) {
    return next;
  }
  if (rewrite.history_text_overrides) {
    for (const [indexString, text] of Object.entries(rewrite.history_text_overrides)) {
      const index = Number(indexString);
      if (!next.history[index]) {
        throw new Error(`Missing history index ${index} for case ${caseItem.case_id}`);
      }
      next.history[index].text = text;
    }
  }
  if (rewrite.current_user_message) {
    next.current_user_message = rewrite.current_user_message;
  }
  return next;
}

function renumberId(prefix, index) {
  return `${prefix}_${String(index + 1).padStart(3, '0')}`;
}

function indexBy(items, key) {
  const map = new Map();
  for (const item of items) {
    if (map.has(item[key])) {
      throw new Error(`Duplicate ${key}: ${item[key]}`);
    }
    map.set(item[key], item);
  }
  return map;
}

function buildSet({ cases, golds, idPrefix, rewrites = {} }) {
  const goldByLegacyId = indexBy(golds, 'case_id');
  const caseMap = [];
  const nextCases = [];
  const nextGolds = [];

  cases.forEach((legacyCase, index) => {
    const legacyId = legacyCase.case_id;
    const nextId = renumberId(idPrefix, index);
    const rewrite = rewrites[legacyId] ?? null;
    const nextCase = applyRewriteToCase(legacyCase, rewrite);
    nextCase.case_id = nextId;
    nextCases.push(nextCase);

    const legacyGold = goldByLegacyId.get(legacyId);
    if (!legacyGold) {
      throw new Error(`Missing gold for case ${legacyId}`);
    }
    const nextGold = clone(legacyGold);
    nextGold.case_id = nextId;
    nextGolds.push(nextGold);

    caseMap.push({
      legacy_case_id: legacyId,
      case_id: nextId,
      rewritten: Boolean(rewrite),
      rewrite_rationale: rewrite?.rationale ?? null,
      base_task_id: legacyCase.base_task_id,
      variant_id: legacyCase.variant_id,
      slice: legacyCase.slice,
    });
  });

  return { cases: nextCases, golds: nextGolds, caseMap };
}

function buildThesisScreeningV1({
  mainCases,
  mainGolds,
  neutralCases,
  neutralGolds,
}) {
  const main = buildSet({
    cases: mainCases,
    golds: mainGolds,
    idPrefix: 'thesis_main_v1',
    rewrites: REWRITE_OVERRIDES,
  });
  const neutral = buildSet({
    cases: neutralCases,
    golds: neutralGolds,
    idPrefix: 'thesis_neutral_v1',
  });

  return {
    mainCases: main.cases,
    mainGolds: main.golds,
    neutralCases: neutral.cases,
    neutralGolds: neutral.golds,
    caseMap: [...main.caseMap, ...neutral.caseMap],
  };
}

function outputPaths(outputDir) {
  return {
    mainCasesPath: path.join(outputDir, 'thesis-screening-main-v1.cases.jsonl'),
    mainGoldPath: path.join(outputDir, 'thesis-screening-main-v1.gold.jsonl'),
    neutralCasesPath: path.join(outputDir, 'thesis-screening-neutral-v1.cases.jsonl'),
    neutralGoldPath: path.join(outputDir, 'thesis-screening-neutral-v1.gold.jsonl'),
    caseMapPath: path.join(outputDir, 'thesis-screening-v1-case-map.json'),
  };
}

function printHelp() {
  console.log(`Usage:
node scripts/benchmarks/build-affect-thesis-screening-v1.cjs \\
  --output-dir research/affect-thesis

Defaults:
  --main-cases   ${DEFAULTS.mainCasesPath}
  --main-gold    ${DEFAULTS.mainGoldPath}
  --neutral-cases ${DEFAULTS.neutralCasesPath}
  --neutral-gold ${DEFAULTS.neutralGoldPath}
  --output-dir   ${DEFAULTS.outputDir}`);
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return;
  }

  const built = buildThesisScreeningV1({
    mainCases: loadJsonl(args.mainCasesPath),
    mainGolds: loadJsonl(args.mainGoldPath),
    neutralCases: loadJsonl(args.neutralCasesPath),
    neutralGolds: loadJsonl(args.neutralGoldPath),
  });

  const paths = outputPaths(args.outputDir);
  writeJsonl(paths.mainCasesPath, built.mainCases);
  writeJsonl(paths.mainGoldPath, built.mainGolds);
  writeJsonl(paths.neutralCasesPath, built.neutralCases);
  writeJsonl(paths.neutralGoldPath, built.neutralGolds);
  writeJson(paths.caseMapPath, {
    rewritten_case_count: built.caseMap.filter((entry) => entry.rewritten).length,
    total_case_count: built.caseMap.length,
    entries: built.caseMap,
  });

  console.log(
    JSON.stringify(
      {
        output_dir: args.outputDir,
        rewritten_case_count: built.caseMap.filter((entry) => entry.rewritten).length,
        total_case_count: built.caseMap.length,
        outputs: paths,
      },
      null,
      2
    )
  );
}

module.exports = {
  DEFAULTS,
  REWRITE_OVERRIDES,
  parseArgs,
  loadJsonl,
  applyRewriteToCase,
  buildSet,
  buildThesisScreeningV1,
  outputPaths,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
