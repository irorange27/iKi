# Benchmark Harness

This directory contains lightweight harnesses for running external benchmarks against iKi without
hard-coding benchmark logic into the main product runtime.

## Current Scope

`run-daemon-benchmark.cjs` is a daemon black-box harness intended for answer-based benchmarks such
as BrowseComp and the simpler GAIA subsets.

It can:

- optionally spawn an isolated daemon instance
- register a disposable daemon client
- create one thread per task
- stream each task through `/v1/chat/stream`
- capture UI chunks, daemon events, and final answers
- export `summary.json`, `results.json`, and `predictions.jsonl`
- ingest the official BrowseComp CSV and transform it into iKi tasks
- emit BrowseComp-specific prediction exports including extracted `Exact Answer`
- preserve final assistant text even when a provider returns it only at stream completion instead
  of as incremental `text-delta` chunks

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

If you want to target an already running daemon, provide either:

- `--client-id` + `--client-token`
- or `--user-data-path` / `--bootstrap-token` so the harness can register its own client

Important:

- `--provider` values are normalized to lowercase by the harness, so `DeepSeek` becomes `deepseek`
- `--spawn-daemon` now requires `--user-data-path`
- `--parallel` defaults to `1`; increase it gradually (`2`, `4`, then `8`) based on provider rate
  limits and daemon stability
- `--max-iterations` lets daemon benchmark runs raise the tool-loop ceiling without changing normal
  desktop chat defaults; BrowseComp-style browse-heavy tasks often need more than the product
  default of `5`, so start with `12`
- that profile must already contain an enabled provider configuration; the harness does not create
  provider records automatically

## Task File Format

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
