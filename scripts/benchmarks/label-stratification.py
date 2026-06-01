#!/usr/bin/env python3
"""Post-hoc stratification labeler for V3 benchmark scenarios.

Estimates valence, arousal, information_completeness, and task_complexity
for each scenario using a lightweight model call. These labels are used ONLY
for post-hoc stratified analysis, NOT as gold labels for evaluation.

IMPORTANT: The labeling prompt MUST NOT mention intervention states (stabilize,
clarify, etc.), affect modes (no_affect, tone_only, explicit_policy), or any
system implementation details.
"""

import json
import os
import sqlite3
import sys
import time
from urllib.request import Request, urlopen
from urllib.error import URLError

DEEPSEEK_API = "https://api.deepseek.com/v1/chat/completions"
LABELING_MODEL = "deepseek-chat"
DB_PATH = os.path.expanduser("~/Library/Application Support/iki/iKi_v0.db")
REQUEST_DELAY = 0.5  # seconds between requests to avoid rate limiting

SYSTEM_PROMPT = """You are a research assistant helping label scenario data for stratified analysis.

For each scenario, you will read a description of a person's situation and their interaction with an AI assistant. Your task is to estimate four dimensions:

1. **valence** (float, -1.0 to 1.0): How positive or negative the user's emotional state is.
   - -1.0 = very negative (distressed, frustrated, hopeless)
   - 0.0 = neutral (calm, matter-of-fact)
   - 1.0 = very positive (happy, confident, optimistic)

2. **arousal** (float, 0.0 to 1.0): How activated/agitated the user's emotional state is.
   - 0.0 = very low (lethargic, withdrawn, flat)
   - 0.5 = moderate (attentive, mildly engaged)
   - 1.0 = very high (anxious, frantic, highly agitated)

3. **information_completeness** (float, 0.0 to 1.0): How complete the information is for the task.
   - 0.0 = critical information missing, goals unclear
   - 0.5 = some information available but gaps remain
   - 1.0 = all necessary information is present and clear

4. **task_complexity** (string, one of: "low", "medium", "high"):
   - "low" = simple, straightforward task with few steps and low stakes
   - "medium" = moderate complexity, multiple steps or some ambiguity
   - "high" = complex task with many dependencies, high stakes, or significant ambiguity

Base your estimates on the user's expressed state AND behavior patterns (e.g., hesitation, avoidance, repetitive actions), not just their explicit words.

Output ONLY valid JSON with no additional text. Format:
{"scene_id": "...", "valence": 0.0, "arousal": 0.0, "information_completeness": 0.0, "task_complexity": "low"}"""


def get_api_key():
    """Read DeepSeek API key from the iKi SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    row = conn.execute(
        "SELECT api_key FROM providers WHERE type='deepseek' LIMIT 1"
    ).fetchone()
    conn.close()
    if not row or not row[0]:
        raise RuntimeError("No DeepSeek provider or empty API key found")
    return row[0]


def load_scenarios(path):
    """Load scenarios from a JSONL file."""
    scenarios = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                scenarios.append(json.loads(line))
    return scenarios


def build_scenario_text(scenario):
    """Build a concise scenario description for the labeling model."""
    parts = []

    # Narrative (describes the person's situation and emotional state)
    if "narrative" in scenario and scenario["narrative"]:
        parts.append(f"Situation: {scenario['narrative']}")

    # Task context
    tc = scenario.get("task_context", {})
    if tc:
        parts.append(f"Task goal: {tc.get('goal', 'N/A')}")
        constraints = tc.get("constraints", [])
        if constraints:
            parts.append(f"Constraints: {', '.join(constraints)}")

    # User's current message (most recent expression of state)
    parts.append(f"User's current message: {scenario.get('current_user_message', '')}")

    return "\n".join(parts)


def label_scenario(api_key, scenario):
    """Call DeepSeek API to label a single scenario."""
    scenario_text = build_scenario_text(scenario)
    scene_id = scenario.get("scene_id", "unknown")

    payload = {
        "model": LABELING_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Please label this scenario:\n\n{scenario_text}"},
        ],
        "temperature": 0.0,
        "max_tokens": 200,
        "response_format": {"type": "json_object"},
    }

    req = Request(
        DEEPSEEK_API,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    for attempt in range(3):
        try:
            with urlopen(req, timeout=30) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                content = result["choices"][0]["message"]["content"]
                label = json.loads(content)
                label["scene_id"] = scene_id
                return label
        except Exception as e:
            print(f"  Attempt {attempt+1}/3 failed for {scene_id}: {e}", file=sys.stderr)
            if attempt < 2:
                time.sleep(2 * (attempt + 1))
    return None


def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <conversations.jsonl> [output.json]", file=sys.stderr)
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else input_path.replace(".jsonl", "_labels.json")

    scenarios = load_scenarios(input_path)
    print(f"Loaded {len(scenarios)} scenarios from {input_path}", file=sys.stderr)

    api_key = get_api_key()
    print(f"Using model: {LABELING_MODEL}", file=sys.stderr)

    labels = []
    for i, scenario in enumerate(scenarios):
        scene_id = scenario.get("scene_id", f"scene_{i}")
        print(f"[{i+1}/{len(scenarios)}] Labeling {scene_id}...", file=sys.stderr)

        label = label_scenario(api_key, scenario)
        if label:
            labels.append(label)
            print(f"  v={label.get('valence')} a={label.get('arousal')} "
                  f"info={label.get('information_completeness')} "
                  f"complexity={label.get('task_complexity')}", file=sys.stderr)
        else:
            print(f"  FAILED", file=sys.stderr)
            labels.append({
                "scene_id": scene_id,
                "valence": None,
                "arousal": None,
                "information_completeness": None,
                "task_complexity": None,
                "_error": "labeling_failed",
            })

        if i < len(scenarios) - 1:
            time.sleep(REQUEST_DELAY)

    # Write output
    with open(output_path, "w") as f:
        json.dump(labels, f, indent=2, ensure_ascii=False)
    print(f"\nLabels written to {output_path}", file=sys.stderr)

    # Summary stats
    valid = [l for l in labels if l.get("valence") is not None]
    if valid:
        valences = [l["valence"] for l in valid]
        arousals = [l["arousal"] for l in valid]
        completions = [l["information_completeness"] for l in valid]
        print(f"\nSummary ({len(valid)}/{len(labels)} labeled):", file=sys.stderr)
        print(f"  valence: min={min(valences):.2f} max={max(valences):.2f} mean={sum(valences)/len(valences):.2f}", file=sys.stderr)
        print(f"  arousal: min={min(arousals):.2f} max={max(arousals):.2f} mean={sum(arousals)/len(arousals):.2f}", file=sys.stderr)
        print(f"  info_completeness: min={min(completions):.2f} max={max(completions):.2f} mean={sum(completions)/len(completions):.2f}", file=sys.stderr)
        complexities = [l["task_complexity"] for l in valid]
        for level in ("low", "medium", "high"):
            count = complexities.count(level)
            print(f"  task_complexity {level}: {count}", file=sys.stderr)


if __name__ == "__main__":
    main()
