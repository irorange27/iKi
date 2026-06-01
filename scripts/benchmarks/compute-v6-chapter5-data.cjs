#!/usr/bin/env node
// Compute scene-level stance changes and stratification for V6 Chapter 5
const fs = require('fs');
const path = require('path');

const BASE = '/Users/nina/Developer/MyRepo/iki/research/affect-thesis-v3';
const RUNS = `${BASE}/runs-v6-hardblock`;
const LABELS = JSON.parse(fs.readFileSync(`${BASE}/scenario_labels.json`, 'utf8'));

const CONDITIONS = ['no_affect', 'tone_only', 'explicit_policy'];

// Load all emotion behavioral metrics
const emotionMetrics = {};
for (const cond of CONDITIONS) {
  emotionMetrics[cond] = JSON.parse(
    fs.readFileSync(`${RUNS}/emotion-${cond}/behavioral-metrics.json`, 'utf8')
  );
}

// Scene-level stance comparison
console.log('=== SCENE-LEVEL STANCE COMPARISON ===');
const stances = {};
for (const cond of CONDITIONS) {
  stances[cond] = {};
  for (const s of emotionMetrics[cond].per_scene) {
    stances[cond][s.scene_id] = s.metrics.interaction_stance;
  }
}

// Find scenes where explicit_policy differs from no_affect
const changedScenes = [];
for (const label of LABELS) {
  const sid = label.scene_id;
  const na = stances['no_affect'][sid];
  const ep = stances['explicit_policy'][sid];
  const to = stances['tone_only'][sid];
  if (na !== ep) {
    changedScenes.push({ scene_id: sid, no_affect: na, tone_only: to, explicit_policy: ep, ...label });
  }
}

console.log(`Scenes with stance change (no_affect → explicit_policy): ${changedScenes.length}`);
for (const s of changedScenes) {
  console.log(`  ${s.scene_id}: no_affect=${s.no_affect} → explicit_policy=${s.explicit_policy} (tone_only=${s.tone_only}) | val=${s.valence} arous=${s.arousal} info=${s.information_completeness} task=${s.task_complexity}`);
}

// Count direction
const neutralToClarify = changedScenes.filter(s => s.no_affect === 'neutral' && s.explicit_policy === 'clarify');
const clarifyToNeutral = changedScenes.filter(s => s.no_affect === 'clarify' && s.explicit_policy === 'neutral');
console.log(`\nneutral→clarify: ${neutralToClarify.length}`);
for (const s of neutralToClarify) console.log(`  ${s.scene_id}`);
console.log(`clarify→neutral: ${clarifyToNeutral.length}`);
for (const s of clarifyToNeutral) console.log(`  ${s.scene_id}`);

// Safety check: no explicit_policy push_forward when no_affect is clarify
const dangerous = changedScenes.filter(s => s.no_affect === 'clarify' && s.explicit_policy === 'push_forward');
console.log(`\nSafety violations (clarify→push_forward): ${dangerous.length}`);

// Stratification analysis
console.log('\n=== STRATIFICATION ANALYSIS ===');

function computeClarifyRate(condition, filterFn) {
  const scenes = emotionMetrics[condition].per_scene.filter(s => {
    const label = LABELS.find(l => l.scene_id === s.scene_id);
    return label && filterFn(label);
  });
  if (scenes.length === 0) return { n: 0, rate: 0 };
  const clarify = scenes.filter(s => s.metrics.interaction_stance === 'clarify').length;
  return { n: scenes.length, rate: clarify / scenes.length };
}

const strata = [
  { name: '高唤醒度（>0.60）', fn: l => l.arousal > 0.60 },
  { name: '低唤醒度（≤0.60）', fn: l => l.arousal <= 0.60 },
  { name: '低信息完整度（≤0.30）', fn: l => l.information_completeness <= 0.30 },
  { name: '高信息完整度（>0.30）', fn: l => l.information_completeness > 0.30 },
  { name: '高任务复杂度（high）', fn: l => l.task_complexity === 'high' },
  { name: '中任务复杂度（medium）', fn: l => l.task_complexity === 'medium' },
];

console.log('Subgroup                    n   no_affect  tone_only  explicit_policy');
console.log('-'.repeat(80));
for (const stratum of strata) {
  const results = CONDITIONS.map(c => computeClarifyRate(c, stratum.fn));
  const n = results[0].n;
  const rates = results.map(r => `${(r.rate * 100).toFixed(1)}%`);
  console.log(`${stratum.name.padEnd(28)} ${String(n).padStart(2)}  ${rates.join('    ')}`);
}

// Also compute push_forward rates
console.log('\nPush_forward rates by subgroup:');
for (const stratum of strata) {
  const results = CONDITIONS.map(c => {
    const scenes = emotionMetrics[c].per_scene.filter(s => {
      const label = LABELS.find(l => l.scene_id === s.scene_id);
      return label && stratum.fn(label);
    });
    if (scenes.length === 0) return 'N/A';
    const pf = scenes.filter(s => s.metrics.interaction_stance === 'push_forward').length;
    return `${(pf / scenes.length * 100).toFixed(1)}%`;
  });
  console.log(`  ${stratum.name}: ${results.join(' / ')}`);
}

// List all clarify and neutral scenes per condition for reference
console.log('\n=== PER-CONDITION STANCE SUMMARY ===');
for (const cond of CONDITIONS) {
  const clarifyScenes = emotionMetrics[cond].per_scene.filter(s => s.metrics.interaction_stance === 'clarify').map(s => s.scene_id);
  const neutralScenes = emotionMetrics[cond].per_scene.filter(s => s.metrics.interaction_stance === 'neutral').map(s => s.scene_id);
  const pfScenes = emotionMetrics[cond].per_scene.filter(s => s.metrics.interaction_stance === 'push_forward').map(s => s.scene_id);
  console.log(`${cond}: clarify=[${clarifyScenes.join(', ')}] (${clarifyScenes.length})`);
  console.log(`  neutral=[${neutralScenes.length}] push_forward=[${pfScenes.length}]`);
}
