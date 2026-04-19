# Benchmark Harness

This directory contains lightweight harnesses for running external benchmarks against iKi without
hard-coding benchmark logic into the main product runtime.

## Current Scope

`run-daemon-benchmark.cjs` is a daemon black-box harness intended for answer-based benchmarks such
as BrowseComp and the simpler GAIA subsets.

`run-affect-benchmark.cjs` is a local scorer/packager for the affect-aware decision-point
benchmark. It does not call the daemon itself. Instead, it validates benchmark cases, gold labels,
and model predictions, computes automatic policy metrics, and exports blinded judge packets for
human evaluation.

It can:

- optionally spawn an isolated daemon instance
- register a disposable daemon client
- create one thread per task
- stream each task through `/v1/chat/stream`
- capture UI chunks, daemon events, and final answers
- optionally attach per-event receive timestamps plus task/run latency profiles
- export `summary.json`, `results.json`, and `predictions.jsonl`
- ingest the official BrowseComp CSV and transform it into iKi tasks
- emit BrowseComp-specific prediction exports including extracted `Exact Answer`
- preserve final assistant text even when a provider returns it only at stream completion instead
  of as incremental `text-delta` chunks

The affect benchmark harness can:

- load `cases.jsonl`, `gold.jsonl`, and `predictions.jsonl`
- validate the required `task_context -> policy_action + assistant_response` schema
- compute automatic policy metrics such as `policy_composite_error`
- export `results.json` and `summary.json`
- export blinded `judge_input.jsonl` plus internal `judge_key.jsonl`

The current main-benchmark contract is intentionally narrow:

- input exposes only `history`, `current_user_message`, and `task_context`
- output policy exposes only `intervention_state` and `escalate`
- `relationship_context`, `candidate_memory`, memory-write labels, and follow-up labels are not
  part of the main benchmark interface

The examples folder also includes a model-screening starter pack plus two fuller screening sets:

- `screening-blueprint.v1.json`
- `screening-main-preview.cases.jsonl`
- `screening-main-preview.gold.jsonl`
- `screening-neutral-preview.cases.jsonl`
- `screening-neutral-preview.gold.jsonl`
- `screening-main-v1.cases.jsonl`
- `screening-main-v1.gold.jsonl`
- `screening-neutral-v1.cases.jsonl`
- `screening-neutral-v1.gold.jsonl`
- `screening-blueprint.v2.json`
- `screening-main-v2.cases.jsonl`
- `screening-main-v2.gold.jsonl`
- `screening-neutral-v2.cases.jsonl`
- `screening-neutral-v2.gold.jsonl`

Use the `preview` files to sanity-check the harness and first-pass model behavior. Use the `v1`
files when you want the full `screen_48 + neutral_12` screening pass before deciding whether an
explicit affect-aware policy layer is still necessary. Use the `v2` files when `v1` mostly
exposes "under-help" / execution-calibration errors and you want a sharper pack that adds
`underspecified_execute` cases plus balanced neutral `clarify` controls.

For thesis work, the repository also now includes a deterministic helper that derives an internal
manifest scaffold from the frozen `v2` screening case/gold files. This does not create new
benchmark text; it backfills construction metadata, latent control fields, and cue-audit review
priority so the current synthetic screening set can be turned into a thesis-facing manifest for
rewrite and freeze work:

```bash
node scripts/benchmarks/derive-affect-thesis-manifest.cjs \
  --cases scripts/benchmarks/examples/affect-benchmark/screening-main-v2.cases.jsonl,scripts/benchmarks/examples/affect-benchmark/screening-neutral-v2.cases.jsonl \
  --gold scripts/benchmarks/examples/affect-benchmark/screening-main-v2.gold.jsonl,scripts/benchmarks/examples/affect-benchmark/screening-neutral-v2.gold.jsonl \
  --output research/affect-thesis/screening-v2-derived-manifest.v1.jsonl
```

The resulting file is an internal construction asset, not a benchmark input file. See
`docs/design/desktop-pet-affect-thesis-screening-v2-derivation.md` for the intended workflow and
limitations.

## Usage

```bash
npm run benchmark:daemon -- \
  --benchmark browsecomp \
  --provider openai \
  --model gpt-4.1-mini \
  --parallel 4 \
  --max-iterations 12 \
  --spawn-daemon \
  --user-data-path /path/to/preconfigured/iki-benchmark-profile
```

The command above will fetch the official BrowseComp dataset automatically when `--tasks` is
omitted.

To use a separate judge model with the public BrowseComp grader prompt:

```bash
npm run benchmark:daemon -- \
  --benchmark browsecomp \
  --provider openai \
  --model gpt-4.1-mini \
  --judge-provider openai \
  --judge-model gpt-4.1 \
  --parallel 4 \
  --max-iterations 12 \
  --spawn-daemon \
  --user-data-path /path/to/preconfigured/iki-benchmark-profile
```

To run a local/manual sample file instead of the official BrowseComp dataset:

```bash
npm run benchmark:daemon -- \
  --benchmark generic \
  --tasks scripts/benchmarks/examples/manual-sample.tasks.json \
  --provider openai \
  --model gpt-4.1-mini \
  --parallel 2 \
  --spawn-daemon \
  --user-data-path /path/to/preconfigured/iki-benchmark-profile
```

To score a local affect benchmark prediction file and build blinded judge packets:

```bash
npm run benchmark:affect -- \
  --cases scripts/benchmarks/examples/affect-benchmark/sample.cases.jsonl \
  --gold scripts/benchmarks/examples/affect-benchmark/sample.gold.jsonl \
  --predictions scripts/benchmarks/examples/affect-benchmark/sample.predictions.jsonl \
  --output-dir benchmark-runs/affect-sample
```

To score the screening preview files, point `--cases` / `--gold` at either the `screening-main`
or `screening-neutral` preview set and provide a matching prediction file generated by the model
condition you want to test.

To run the full screening pack through the daemon harness, point `--cases` / `--gold` at the
merged `v1` main + neutral files:

```bash
node scripts/benchmarks/run-affect-daemon-benchmark.cjs \
  --cases scripts/benchmarks/examples/affect-benchmark/screening-main-v1.cases.jsonl,scripts/benchmarks/examples/affect-benchmark/screening-neutral-v1.cases.jsonl \
  --gold scripts/benchmarks/examples/affect-benchmark/screening-main-v1.gold.jsonl,scripts/benchmarks/examples/affect-benchmark/screening-neutral-v1.gold.jsonl \
  --output-dir benchmark-runs/affect-screening/<system-id> \
  --provider <provider> \
  --model <model> \
  --parallel 1 \
  --profile-latency \
  --spawn-daemon \
  --user-data-path /path/to/preconfigured/iki-profile \
  --max-iterations 1
```

To run the sharper `v2` screening pack through the daemon harness:

```bash
node scripts/benchmarks/run-affect-daemon-benchmark.cjs \
  --cases scripts/benchmarks/examples/affect-benchmark/screening-main-v2.cases.jsonl,scripts/benchmarks/examples/affect-benchmark/screening-neutral-v2.cases.jsonl \
  --gold scripts/benchmarks/examples/affect-benchmark/screening-main-v2.gold.jsonl,scripts/benchmarks/examples/affect-benchmark/screening-neutral-v2.gold.jsonl \
  --output-dir benchmark-runs/affect-screening-v2/<system-id> \
  --provider <provider> \
  --model <model> \
  --parallel 1 \
  --profile-latency \
  --spawn-daemon \
  --user-data-path /path/to/preconfigured/iki-profile \
  --max-iterations 1
```

For thesis-style ablations, `run-affect-daemon-benchmark.cjs` now treats the three affect modes
as distinct runtime conditions rather than prompt aliases:

- `--affect-mode no_affect`
  - drops the affect block entirely
  - disables affect-based routing / applied policy
  - still records a runtime policy action for audit and scoring, but marks it as
    `runtime_policy_applied: false`
- `--affect-mode tone_only`
  - allows affect into system/context only
  - keeps runtime policy audit-only with `runtime_policy_applied: false`
- `--affect-mode explicit_policy`
  - allows affect into the explicit intervention policy
  - applies that policy to generation and records `runtime_policy_applied: true`
- `--await-realtime-affect`
  - forces same-turn affect analysis for the current benchmark turn before generation
  - primarily intended for thesis-style affect ablations, so the explicit policy condition does not
    depend on pre-existing thread emotion state or on whether the desktop profile has realtime
    analysis enabled

`parsed-results.json` now includes `runtime_policy_applied` and
`runtime_policy_affect_used` in prediction metadata so you can verify that the experiment
condition actually matched the intended runtime behavior before using the run in a paper table.

For the thesis-facing full matrix, the repository now also includes a wrapper that runs the three
runtime conditions sequentially on the frozen thesis dataset and then compiles a Chinese
paper-facing summary:

```bash
npm run benchmark:affect:thesis:run -- \
  --main-cases research/affect-thesis/thesis-screening-main-v1.cases.jsonl \
  --main-gold research/affect-thesis/thesis-screening-main-v1.gold.jsonl \
  --neutral-cases research/affect-thesis/thesis-screening-neutral-v1.cases.jsonl \
  --neutral-gold research/affect-thesis/thesis-screening-neutral-v1.gold.jsonl \
  --output-dir benchmark-runs/affect-thesis-v1/deepseek-chat \
  --provider deepseek \
  --model deepseek-chat \
  --parallel 1 \
  --spawn-daemon \
  --user-data-path /path/to/preconfigured/iki-profile \
  --max-iterations 1
```

That wrapper writes one subdirectory per mode plus:

- `thesis-matrix-run-summary.json`
- `thesis-results-summary.json`
- `paper-results-section.md`

The thesis matrix wrapper automatically enables same-turn affect analysis for the `tone_only` and
`explicit_policy` runs while leaving `no_affect` untouched. This keeps the ablation focused on
whether affect is used, not on whether an old thread already happened to contain usable affect
state.

## Provenance-First Thesis Dataset Pipeline

The repository now also includes a second thesis-data pipeline under
`research/affect-thesis-v2/`. This pipeline is for building a paper-facing synthetic dataset from
protocol to freeze, rather than only deriving a thesis set from an already-frozen screening pack.

The intended order is:

1. scaffold manifest slots from the blueprint
2. optionally append a supplement blueprint to rebalance thin distributions
3. render authoring packets with fixed prompts
4. generate or hand-write batch-level candidate responses
5. ingest those batch responses into a flat candidate pool
6. audit candidates for leakage / duplication / shape errors
7. review audited candidates and select one candidate per slot
8. backfill `selected_candidate_id` into the manifest from an explicit selection log
9. scaffold a formal annotation workset plus per-annotator log skeletons
10. annotate and adjudicate the selected candidates
11. backfill adjudicated labels into the manifest
12. freeze final `cases.jsonl` / `gold.jsonl` plus provenance map

To scaffold the v2 manifest:

```bash
npm run benchmark:affect:thesis:v2:scaffold
```

To build authoring packets from the scaffolded manifest:

```bash
npm run benchmark:affect:thesis:v2:packets
```

If you need to rebalance a thin slice without invalidating an already-reviewed manifest, append a
supplement blueprint instead of regenerating the whole manifest:

```bash
npm run benchmark:affect:thesis:v2:append -- \
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \
  --blueprint research/affect-thesis-v2/blueprint.neutral-balance-supplement.v1.json \
  --summary research/affect-thesis-v2/manifest-summary.v1.json \
  --output research/affect-thesis-v2/dataset-manifest.v1.jsonl
```

To ingest batch responses into a flat candidate pool:

```bash
npm run benchmark:affect:thesis:v2:ingest -- \
  --input research/affect-thesis-v2/candidate-batches.v1.jsonl \
  --output-dir research/affect-thesis-v2
```

To audit a flattened candidate pool:

```bash
npm run benchmark:affect:thesis:v2:audit -- \
  --candidates research/affect-thesis-v2/candidate-pool.v1.jsonl \
  --output-dir research/affect-thesis-v2/audits
```

To backfill reviewed candidate selections into the manifest:

```bash
npm run benchmark:affect:thesis:v2:select -- \
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \
  --selections research/affect-thesis-v2/selection-log.v1.jsonl \
  --candidates research/affect-thesis-v2/seed-merged/candidate-pool.v1.jsonl \
  --audit research/affect-thesis-v2/seed-merged/audits/candidate-audit.v1.jsonl \
  --output research/affect-thesis-v2/dataset-manifest.v1.jsonl \
  --summary research/affect-thesis-v2/selection-backfill-summary.v1.json
```

The selection log should be authored explicitly from human review. Use
`research/affect-thesis-v2/selection-log.template.v1.jsonl` as the starting point rather than
editing the manifest by hand.

To scaffold a formal annotation round from the selected candidates:

```bash
npm run benchmark:affect:thesis:v2:prepare-annotation -- \
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \
  --candidates research/affect-thesis-v2/seed-merged/candidate-pool.v1.jsonl \
  --round-id formal_v2 \
  --annotators annotator_a,annotator_b \
  --output-dir research/affect-thesis-v2
```

This command creates a blinded `annotation-workset`, one `annotation-log` skeleton per annotator,
an empty `adjudication-log`, and a round summary file. It refuses to overwrite existing files
unless `--force` is provided, because these files may already contain human labels.

If humans should annotate in a spreadsheet rather than editing JSONL directly, export CSV sheets:

```bash
npm run benchmark:affect:thesis:v2:export-annotation-sheets -- \
  --workset research/affect-thesis-v2/annotation-workset.formal_v2.jsonl \
  --annotations research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl,research/affect-thesis-v2/annotation-log.formal_v2.annotator_b.jsonl \
  --output-dir research/affect-thesis-v2
```

After the annotators fill those CSV sheets, import each sheet back into its canonical JSONL log:

```bash
npm run benchmark:affect:thesis:v2:import-annotation-sheet -- \
  --sheet research/affect-thesis-v2/annotation-sheet.formal_v2.annotator_a.csv \
  --template research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl \
  --output research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl
```

To backfill annotation/adjudication results into the manifest:

```bash
npm run benchmark:affect:thesis:v2:backfill -- \
  --annotations research/affect-thesis-v2/annotation-log.formal_v2.annotator_a.jsonl,research/affect-thesis-v2/annotation-log.formal_v2.annotator_b.jsonl \
  --adjudications research/affect-thesis-v2/adjudication-log.formal_v2.jsonl \
  --round-id formal_v2 \
  --output research/affect-thesis-v2/dataset-manifest.v1.jsonl \
  --summary research/affect-thesis-v2/label-backfill-summary.v1.json
```

To freeze the selected candidates into a final dataset:

```bash
npm run benchmark:affect:thesis:v2:freeze -- \
  --manifest research/affect-thesis-v2/dataset-manifest.v1.jsonl \
  --candidates research/affect-thesis-v2/seed-merged/candidate-pool.v1.jsonl \
  --audit research/affect-thesis-v2/seed-merged/audits/candidate-audit.v1.jsonl \
  --output-dir research/affect-thesis-v2/frozen
```

By default, freeze now rejects partial manifests and requires adjudicated `final_labels` in the
manifest instead of silently reusing `expected_label_tendency`. The escape hatches
`--allow-partial` and `--allow-expected-labels` exist only for preview / debug artifacts and
should not be used for the thesis final dataset.

This v2 pipeline does not claim that the earliest synthetic text can be re-generated byte-for-byte.
Instead, it treats `blueprint -> manifest -> candidate pool -> audit -> selection log -> manifest
backfill -> label backfill -> freeze` as the reproducible artifact chain that a thesis can cite and
defend.

If the runs already exist and you only want to rebuild the thesis tables / prose:

```bash
npm run benchmark:affect:thesis:summary -- \
  --main-cases research/affect-thesis/thesis-screening-main-v1.cases.jsonl \
  --main-gold research/affect-thesis/thesis-screening-main-v1.gold.jsonl \
  --neutral-cases research/affect-thesis/thesis-screening-neutral-v1.cases.jsonl \
  --neutral-gold research/affect-thesis/thesis-screening-neutral-v1.gold.jsonl \
  --output-dir benchmark-runs/affect-thesis-v1/deepseek-chat \
  --run no_affect=benchmark-runs/affect-thesis-v1/deepseek-chat/deepseek-deepseek-chat-no_affect \
  --run tone_only=benchmark-runs/affect-thesis-v1/deepseek-chat/deepseek-deepseek-chat-tone_only \
  --run explicit_policy=benchmark-runs/affect-thesis-v1/deepseek-chat/deepseek-deepseek-chat-explicit_policy
```

For the thesis-facing desktop-pet system evaluation package, keep the existing run directories and
combine them with a manually recorded observation file:

```bash
npm run benchmark:desktop-pet:system:summary -- \
  --output-dir benchmark-runs/desktop-pet-system-eval/deepseek-chat \
  --run no_affect=benchmark-runs/affect-thesis-v1/deepseek-chat/deepseek-deepseek-chat-no_affect \
  --run tone_only=benchmark-runs/affect-thesis-v1/deepseek-chat/deepseek-deepseek-chat-tone_only \
  --run explicit_policy=benchmark-runs/affect-thesis-v1/deepseek-chat/deepseek-deepseek-chat-explicit_policy \
  --observations research/desktop-pet-system-eval/system-eval-observations.json
```

That command writes:

- `system-eval-summary.json`
- `paper-system-eval-section.md`

The expected manual observation template lives at:

- `research/desktop-pet-system-eval/system-eval-observations.template.json`

When `--profile-latency` is enabled on the daemon harness (directly or via the affect wrapper), the
run also emits:

- `latency-summary.json` in the daemon output directory with aggregated latency attribution
- `benchmark-flamegraph.flamegraph.html` in the daemon output directory for a self-contained flame
  chart view of the benchmark run
- `benchmark-flamegraph.trace.json` in the daemon output directory for Perfetto /
  `chrome://tracing`-style inspection
- per-task `latencyProfile` objects inside `results.json` and `tasks/<task>.json`
- `receivedAtMs` on captured `chunks` / `daemonEvents` so you can inspect where time was spent
- affect-wrapper `full-pipeline.flamegraph.html` / `full-pipeline.trace.json` artifacts that place
  input preparation, the child daemon run, prediction parsing, and final affect scoring onto one
  full-pipeline timeline
- affect-wrapper `run-summary.json` fields pointing at the daemon latency summary and flamegraph

If you want to target an already running daemon, provide either:

- `--client-id` + `--client-token`
- or `--user-data-path` / `--bootstrap-token` so the harness can register its own client

Important:

- `--provider` values are normalized to lowercase by the harness, so `DeepSeek` becomes `deepseek`
- `--spawn-daemon` now requires `--user-data-path`
- `--parallel` defaults to `1`; increase it gradually (`2`, `4`, then `8`) based on provider rate
  limits and daemon stability
- `--profile-latency` is best used with `--parallel 1` when you want a clean attribution for one
  affect-aware benchmark run; it separates thread creation, stream handshake, model-only waiting,
  tool execution wall time, and scoring time
- `--max-iterations` lets daemon benchmark runs raise the tool-loop ceiling without changing normal
  desktop chat defaults; BrowseComp-style browse-heavy tasks often need more than the product
  default of `5`, so start with `12`
- that profile must already contain an enabled provider configuration; the harness does not create
  provider records automatically
- `benchmark:affect` defaults to `--mode end_to_end`; use `--mode policy_only` if you only want to
  score structured policy outputs without assistant text

## Affect Benchmark Files

Minimal case shape:

```json
{
  "case_id": "aa_main_001",
  "history": [
    { "role": "user", "text": "..." }
  ],
  "current_user_message": "...",
  "task_context": {
    "goal": "...",
    "constraints": ["..."]
  }
}
```

Minimal gold shape:

```json
{
  "case_id": "aa_main_001",
  "labels": {
    "intervention_state": "co_plan",
    "escalate": 0
  }
}
```

Minimal prediction shape:

```json
{
  "case_id": "aa_main_001",
  "system_id": "M_proposed",
  "policy_action": {
    "intervention_state": "co_plan",
    "escalate": 0
  },
  "assistant_response": "..."
}
```

Allowed `intervention_state` values:

- `stabilize`
- `clarify`
- `co_plan`
- `guided_execute`
- `autonomous_execute`

## Generic Task File Format

The harness accepts:

- JSON array
- JSON object with `tasks: []`
- JSONL with one task object per line

Minimal task shape:

```json
{
  "id": "sample_001",
  "prompt": "Answer the question using the available tools."
}
```

Supported fields:

```json
{
  "id": "sample_001",
  "prompt": "Question text",
  "messages": [
    { "role": "user", "content": "Question text" }
  ],
  "expectedAnswer": "gold answer",
  "scoring": { "type": "exact" },
  "tools": ["web", "fetch"],
  "metadata": { "source": "browsecomp-dev" }
}
```

Scoring modes:

- `exact`
- `contains`
- `regex`

The built-in scorer is intentionally simple. For official benchmark reporting, prefer the
benchmark's own evaluator and use `predictions.jsonl` as the exported prediction file.

When `--parallel > 1`, progress logs are emitted in completion order while `results.json`,
`summary.json`, and prediction exports remain in stable task order.

For BrowseComp specifically:

- the harness applies the official answer format prompt
- the harness extracts `Exact Answer` and `Confidence` from model output
- without `--judge-provider` / `--judge-model`, the local score is only a preview score
- with judge options, the harness runs the public BrowseComp grader prompt through iKi's
  non-tool chat path and records that judgement

## Known Limits

- This harness is currently best suited for answer-based external benchmarks.
- It does not yet bind explicit workspaces to daemon-created benchmark threads.
- It does not yet integrate benchmark-owned tool environments through MCP.
- It is not appropriate for browser-control benchmarks such as WebArena until iKi has a real
  browser automation surface.
- BrowseComp support reuses the public dataset/prompt shape, but local preview scores are not a
  substitute for official leaderboard submission/evaluation.
- The affect benchmark harness currently assumes predictions have already been generated; it does
  not yet run daemon/model inference directly.
