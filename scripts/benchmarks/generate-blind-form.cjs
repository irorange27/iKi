#!/usr/bin/env node

const fsp = require('node:fs/promises');
const path = require('node:path');

const parseArgs = argv => {
  const parsed = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw new Error(`Unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const next = argv[i + 1];
    const consume = () => { if (!next || next.startsWith('--')) throw new Error(`Missing value for --${key}`); i++; return next; };
    switch (key) {
      case 'input': parsed.inputPath = consume(); break;
      case 'output-dir': parsed.outputDir = consume(); break;
      case 'title': parsed.title = consume(); break;
      default: throw new Error(`Unknown option: --${key}`);
    }
  }
  if (!parsed.inputPath) throw new Error('Missing --input');
  if (!parsed.outputDir) throw new Error('Missing --output-dir');
  return parsed;
};

const readJsonLines = async fp => {
  const raw = await fsp.readFile(path.resolve(fp), 'utf8');
  return raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => JSON.parse(l));
};

const escapeHtml = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const renderHistory = history => {
  if (!history?.length) return '';
  return history.map(m => {
    const roleLabel = m.role === 'user' ? '🧑 用户' : '🤖 助手';
    return `<div class="msg ${m.role}"><span class="role">${roleLabel}</span>${escapeHtml(m.text)}</div>`;
  }).join('\n');
};

const renderScene = (item, index) => {
  const ctx = item.context || {};
  const historyHtml = renderHistory(ctx.history);
  const userMsg = escapeHtml(ctx.current_user_message || '');
  const goal = escapeHtml(ctx.task_context?.goal || '');
  const deliverable = escapeHtml(ctx.task_context?.deliverable || '');
  const constraints = (ctx.task_context?.constraints || []).map(c => escapeHtml(c));

  const prefId = (dim, val) => `j${index + 1}_${dim}_${val}`;

  return `
<div class="scene" id="scene-${index + 1}">
  <div class="scene-header">
    <span class="scene-num">场景 ${index + 1}</span>
    <span class="scene-id">${escapeHtml(item.scene_id)}</span>
    <span class="progress-badge">${index + 1}/30</span>
  </div>

  <div class="context-block">
    <div class="section-title">对话背景</div>
    ${historyHtml}
    <div class="current-msg">
      <span class="role current">💬 用户当前消息</span>
      <p>${userMsg}</p>
    </div>
  </div>

  <div class="task-block">
    <div class="section-title">任务信息</div>
    <div class="task-item"><strong>目标：</strong>${goal}</div>
    <div class="task-item"><strong>期望产出：</strong>${deliverable}</div>
    ${constraints.length ? `<div class="task-item"><strong>约束：</strong>${constraints.join('；')}</div>` : ''}
  </div>

  <div class="responses">
    <div class="response-card a">
      <div class="response-label">回复 A</div>
      <div class="response-text">${escapeHtml(item.response_a)}</div>
    </div>
    <div class="response-card b">
      <div class="response-label">回复 B</div>
      <div class="response-text">${escapeHtml(item.response_b)}</div>
    </div>
  </div>

  <div class="judgment">
    <div class="section-title">你的判断</div>
    <div class="dims">
      <div class="dim">
        <span class="dim-label">恰当性</span>
        <label><input type="radio" name="j${index + 1}_恰当性" value="a"> 偏好 A</label>
        <label><input type="radio" name="j${index + 1}_恰当性" value="b"> 偏好 B</label>
        <label><input type="radio" name="j${index + 1}_恰当性" value="none" checked> 无偏好</label>
      </div>
      <div class="dim">
        <span class="dim-label">帮助性</span>
        <label><input type="radio" name="j${index + 1}_帮助性" value="a"> 偏好 A</label>
        <label><input type="radio" name="j${index + 1}_帮助性" value="b"> 偏好 B</label>
        <label><input type="radio" name="j${index + 1}_帮助性" value="none" checked> 无偏好</label>
      </div>
      <div class="dim">
        <span class="dim-label">尊重感</span>
        <label><input type="radio" name="j${index + 1}_尊重感" value="a"> 偏好 A</label>
        <label><input type="radio" name="j${index + 1}_尊重感" value="b"> 偏好 B</label>
        <label><input type="radio" name="j${index + 1}_尊重感" value="none" checked> 无偏好</label>
      </div>
      <div class="dim overall">
        <span class="dim-label">整体偏好</span>
        <label><input type="radio" name="j${index + 1}_整体偏好" value="a"> 偏好 A</label>
        <label><input type="radio" name="j${index + 1}_整体偏好" value="b"> 偏好 B</label>
        <label><input type="radio" name="j${index + 1}_整体偏好" value="none" checked> 无偏好</label>
      </div>
    </div>
  </div>
</div>`;
};

const buildHtml = (items, title) => `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title || 'V3 盲评')}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f5f5; color: #1a1a1a; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 20px; }

  .header { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .header h1 { font-size: 1.5em; margin-bottom: 8px; }
  .header .instructions { color: #666; font-size: .9em; }
  .header .instructions ul { margin: 8px 0 0 20px; }
  .header .instructions li { margin-bottom: 4px; }

  .scene { background: #fff; border-radius: 12px; padding: 24px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  .scene-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding-bottom: 12px; border-bottom: 2px solid #eee; }
  .scene-num { font-weight: 700; font-size: 1.15em; }
  .scene-id { color: #999; font-size: .85em; font-family: monospace; }
  .progress-badge { margin-left: auto; background: #e8f0fe; color: #1a73e8; padding: 2px 10px; border-radius: 12px; font-size: .8em; font-weight: 600; }

  .section-title { font-weight: 700; font-size: .85em; color: #666; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 8px; }

  .context-block { margin-bottom: 16px; }
  .msg { padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; font-size: .92em; }
  .msg.user { background: #f0f4ff; }
  .msg.assistant { background: #f5f5f5; }
  .role { font-size: .75em; font-weight: 600; color: #888; margin-right: 8px; display: inline-block; min-width: 56px; }
  .current-msg { background: #fff8e1; padding: 12px; border-radius: 8px; border-left: 3px solid #ffc107; margin-top: 10px; }
  .current-msg .role.current { color: #e65100; }

  .task-block { background: #f8f9fa; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; font-size: .88em; }
  .task-item { margin-bottom: 4px; }

  .responses { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; }
  @media (max-width: 640px) { .responses { grid-template-columns: 1fr; } }
  .response-card { padding: 16px; border-radius: 8px; border: 2px solid #e0e0e0; }
  .response-card.a { border-color: #90caf9; }
  .response-card.b { border-color: #f48fb1; }
  .response-label { font-weight: 700; font-size: .85em; margin-bottom: 8px; }
  .response-card.a .response-label { color: #1565c0; }
  .response-card.b .response-label { color: #c62828; }
  .response-text { font-size: .92em; white-space: pre-wrap; }

  .judgment { background: #fafafa; padding: 16px; border-radius: 8px; }
  .dims { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
  .dim { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: .9em; }
  .dim-label { font-weight: 600; min-width: 56px; color: #555; }
  .dim label { cursor: pointer; padding: 2px 8px; border-radius: 4px; border: 1px solid #ddd; font-size: .85em; user-select: none; }
  .dim label:has(input:checked) { background: #e8f0fe; border-color: #1a73e8; color: #1a73e8; }
  .dim input { display: none; }
  .dim.overall .dim-label { color: #c62828; }
  .dim.overall label:has(input:checked) { background: #fce4ec; border-color: #c62828; color: #c62828; }

  .export-bar { position: sticky; bottom: 16px; background: #fff; border-radius: 12px; padding: 16px 24px; box-shadow: 0 4px 12px rgba(0,0,0,.15); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; z-index: 100; }
  .export-bar .stats { font-size: .9em; color: #666; margin-right: auto; }
  .export-bar button { padding: 8px 20px; border: none; border-radius: 8px; font-size: .9em; font-weight: 600; cursor: pointer; }
  .btn-export { background: #1a73e8; color: #fff; }
  .btn-export:hover { background: #1557b0; }
  .btn-copy { background: #e8f0fe; color: #1a73e8; }
  .btn-copy:hover { background: #d2e3fc; }
  .output-area { display: none; margin-top: 12px; width: 100%; }
  .output-area textarea { width: 100%; height: 200px; font-family: monospace; font-size: .8em; border: 1px solid #ccc; border-radius: 8px; padding: 12px; resize: vertical; }
  .output-area.show { display: block; }

  .save-hint { font-size: .8em; color: #999; text-align: center; padding: 8px; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>V3 盲评 — 系统回复 A/B 对比</h1>
    <div class="instructions">
      <p>以下共 30 个场景。每个场景展示了同一段对话中，两个不同系统条件下 AI 回复的对比（A 和 B，顺序随机）。</p>
      <p>请从以下四个维度综合判断：</p>
      <ul>
        <li><strong>恰当性</strong>：回复是否在恰当的时机做了恰当的事</li>
        <li><strong>帮助性</strong>：回复是否真正帮助推进了用户的任务</li>
        <li><strong>尊重感</strong>：回复是否尊重用户的自主性和当前状态</li>
        <li><strong>整体偏好</strong>：综合考虑，你更偏好哪个回复</li>
      </ul>
      <p>默认选中"无偏好"。当你认为 A 或 B 明显更好时才选择偏好。</p>
      <p style="color:#c62828;margin-top:8px;">⚠️ 完成后请滚动到底部，点击"导出结果"按钮获取 JSONL 文件。</p>
    </div>
  </div>

  ${items.map((item, i) => renderScene(item, i)).join('\n')}

  <div class="export-bar" id="export-bar">
    <span class="stats" id="stats">已完成: 0/30 个整体偏好判断</span>
    <button class="btn-export" onclick="exportResults()">导出结果</button>
    <button class="btn-copy" onclick="copyJsonl()">复制 JSONL</button>
    <div class="output-area" id="output-area">
      <div class="save-hint">将下方内容保存为 <code>judgments.jsonl</code>，发送给实验负责人。</div>
      <textarea id="output-jsonl" readonly></textarea>
    </div>
  </div>
</div>

<script>
const ITEM_COUNT = ${items.length};
const SCENE_IDS = ${JSON.stringify(items.map(it => it.scene_id))};

function countDone() {
  let done = 0;
  for (let i = 0; i < ITEM_COUNT; i++) {
    const val = getRadioValue('j' + (i + 1) + '_整体偏好');
    if (val) done++;
  }
  return done;
}

function getRadioValue(name) {
  const checked = document.querySelector('input[name="' + name + '"]:checked');
  return checked ? checked.value : null;
}

function updateStats() {
  const done = countDone();
  const el = document.getElementById('stats');
  if (el) el.textContent = '已完成: ' + done + '/' + ITEM_COUNT + ' 个整体偏好判断';
}

document.querySelectorAll('input[type=radio]').forEach(r => {
  r.addEventListener('change', updateStats);
});

function buildJudgments() {
  const results = [];
  for (let i = 0; i < ITEM_COUNT; i++) {
    const entry = { scene_id: SCENE_IDS[i] };
    const overall = getRadioValue('j' + (i + 1) + '_整体偏好');
    entry.preference = overall || 'no_preference';
    entry.dimensions = {
      appropriateness: getRadioValue('j' + (i + 1) + '_恰当性') || 'none',
      helpfulness: getRadioValue('j' + (i + 1) + '_帮助性') || 'none',
      respect: getRadioValue('j' + (i + 1) + '_尊重感') || 'none',
      overall: overall || 'none',
    };
    results.push(entry);
  }
  return results;
}

function exportResults() {
  const judgments = buildJudgments();
  const jsonl = judgments.map(j => JSON.stringify(j)).join('\\n');
  const area = document.getElementById('output-area');
  const textarea = document.getElementById('output-jsonl');
  textarea.value = jsonl;
  area.classList.add('show');

  const blob = new Blob([jsonl + '\\n'], { type: 'application/jsonl' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'judgments.jsonl';
  a.click();
  URL.revokeObjectURL(url);
}

function copyJsonl() {
  const judgments = buildJudgments();
  const jsonl = judgments.map(j => JSON.stringify(j)).join('\\n');
  navigator.clipboard.writeText(jsonl + '\\n').then(() => {
    alert('已复制到剪贴板');
  }).catch(() => {
    const area = document.getElementById('output-area');
    const textarea = document.getElementById('output-jsonl');
    textarea.value = jsonl;
    area.classList.add('show');
  });
}

updateStats();
</script>
</body>
</html>`;

const main = async argv => {
  const opts = parseArgs(argv);
  const items = await readJsonLines(opts.inputPath);
  const title = opts.title || 'V3 盲评';
  const html = buildHtml(items, title);

  const outDir = path.resolve(opts.outputDir);
  await fsp.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'v3-blind-evaluation-form.html');
  await fsp.writeFile(outPath, html, 'utf8');
  process.stdout.write(`${outPath}\n`);
};

if (require.main === module) {
  main(process.argv.slice(2)).catch(err => { process.stderr.write(String(err.stack || err) + '\n'); process.exit(1); });
}
