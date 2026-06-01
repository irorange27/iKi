#!/usr/bin/env python3
"""
Three-method emotion recognition comparison on V6 scenario data.
Methods: (1) Dictionary/lexicon (2) Traditional ML (SnowNLP) (3) LLM-based (V6 data)
"""

import json
import os
import time
from collections import Counter
from pathlib import Path

import jieba
from snownlp import SnowNLP

# ── Chinese Emotion Lexicon ──────────────────────────────────────────
# Curated from HowNet / NTUSD / DUTIR emotion ontology, focused on
# the emotion categories relevant to desktop work scenarios.

EMOTION_LEXICON = {
    "fear": {
        "words": [
            "担心", "害怕", "焦虑", "紧张", "不安", "慌", "恐惧",
            "怕", "忧虑", "忐忑", "担忧", "惶恐", "心惊", "吓",
            "不安心", "提心吊胆", "着急", "顾虑", "忧心", "忧",
            "不敢", "犹豫", "怕改错", "怕漏掉", "怕处理不好",
            "心里没底", "拿不准", "不敢动笔", "不敢肯定",
        ],
        "weight": 1.0,
    },
    "sadness": {
        "words": [
            "难过", "伤心", "失望", "沮丧", "低落", "郁闷", "悲伤",
            "灰心", "丧气", "泄气", "颓废", "心累", "累了",
            "算了", "没劲", "唉", "烦", "压抑", "无助", "无奈",
            "不想再看", "不想再弄", "不想再折腾", "干等也不是办法",
            "改得乱七八糟", "眼睛都看花了", "脑子有点乱",
        ],
        "weight": 0.9,
    },
    "anger": {
        "words": [
            "生气", "愤怒", "烦躁", "恼火", "火大", "气死", "暴躁",
            "受不了", "烦死了", "恼", "厌恶", "反感", "敷衍",
        ],
        "weight": 0.8,
    },
    "confusion": {
        "words": [
            "不懂", "不明白", "搞不清", "困惑", "迷茫", "不知道",
            "不确定", "拿不准", "摸不着", "一头雾水", "乱",
            "懵", "糊涂", "弄混", "对不上", "是不是我",
            "哪里出问题", "怎么回事", "搞不懂", "想不通",
        ],
        "weight": 0.7,
    },
    "joy": {
        "words": [
            "开心", "高兴", "满意", "放心", "踏实", "安心",
            "轻松", "愉快", "欣慰", "舒服", "好多了", "挺不错的",
        ],
        "weight": 0.5,
    },
}


def lexicon_analyze(text: str) -> dict:
    """Dictionary-based emotion analysis using jieba + custom lexicon."""
    words = set(jieba.lcut(text))
    scores = {}
    details = []

    for emotion, config in EMOTION_LEXICON.items():
        hit_words = [w for w in config["words"] if w in text]
        if hit_words:
            # Score based on number of hits * category weight
            score = min(len(hit_words) * config["weight"] * 0.35, 0.95)
            scores[emotion] = round(score, 3)
            details.extend(hit_words)

    if not scores:
        return {"label": None, "confidence": 0.0, "valence": 0.0, "arousal": 0.0, "hits": []}

    # Pick the emotion with highest score
    primary = max(scores, key=scores.get)
    confidence = scores[primary]

    # Map emotion to approximate valence/arousal
    va_map = {
        "fear": (-0.45, 0.55),
        "sadness": (-0.5, -0.2),
        "anger": (-0.4, 0.6),
        "confusion": (-0.1, 0.1),
        "joy": (0.5, 0.4),
    }
    valence, arousal = va_map.get(primary, (0.0, 0.0))

    return {
        "label": primary,
        "confidence": confidence,
        "valence": round(valence * confidence, 3),
        "arousal": round(arousal * confidence, 3),
        "hits": details,
    }


def snownlp_analyze(text: str) -> dict:
    """Traditional ML-based sentiment using SnowNLP (Naive Bayes on e-commerce reviews)."""
    s = SnowNLP(text)
    sentiment_score = s.sentiments  # 0-1, >0.5 = positive, <0.5 = negative

    # SnowNLP is trained on e-commerce reviews — many work-query texts score
    # <0.5 because they contain problem-description words, not because they
    # express personal distress. We use wider neutral band to reduce false positives.
    if sentiment_score > 0.65:
        return {"label": "joy", "confidence": sentiment_score, "valence": 0.4, "arousal": 0.3}
    elif sentiment_score < 0.2:
        return {"label": "sadness", "confidence": 1 - sentiment_score, "valence": -0.4, "arousal": -0.2}
    elif sentiment_score < 0.35:
        return {"label": "fear", "confidence": 0.55, "valence": -0.2, "arousal": 0.3}
    else:
        # 0.35-0.65: neutral band — task-oriented problem description, not personal emotion
        return {"label": None, "confidence": sentiment_score, "valence": 0.0, "arousal": 0.0}


def load_llm_affect(base_dir: str) -> dict:
    """Extract LLM emotion analysis results from V6 daemon data."""
    results_path = os.path.join(base_dir, "daemon", "results.json")
    if not os.path.exists(results_path):
        return {}

    with open(results_path) as f:
        results = json.load(f)

    affect_data = {}
    for r in results:
        sid = r["id"]
        meta = json.loads(r.get("thread", {}).get("metadata", "{}"))
        affect = meta.get("affect", {}).get("state", {})
        if affect and affect.get("label"):
            affect_data[sid] = {
                "label": affect.get("label"),
                "confidence": affect.get("confidence"),
                "valence": affect.get("valence"),
                "arousal": affect.get("arousal"),
            }
        else:
            affect_data[sid] = {
                "label": None,
                "confidence": 0.0,
                "valence": 0.0,
                "arousal": 0.0,
            }
    return affect_data


def load_user_messages(base_dir: str) -> dict:
    """Load user messages (current + history) for each scene."""
    conv_path = os.path.join(base_dir, "inputs", "conversations.jsonl")
    if not os.path.exists(conv_path):
        return {}

    with open(conv_path) as f:
        convs = [json.loads(line) for line in f if line.strip()]

    messages = {}
    for c in convs:
        sid = c["scene_id"]
        # Collect all user messages from history + current
        user_msgs = []
        for h in c.get("history", []):
            if h["role"] == "user":
                user_msgs.append(h["text"])
        user_msgs.append(c["current_user_message"])
        messages[sid] = {
            "all_user_text": " ".join(user_msgs),
            "current_message": c["current_user_message"],
            "narrative": c.get("narrative", ""),
        }
    return messages


def classify_emotion(label: str | None) -> str:
    """Normalize emotion label to broad category."""
    if label is None:
        return "neutral"
    return label


def main():
    base = Path(
        "/Users/nina/Developer/MyRepo/iki/research/affect-thesis-v3/runs-v6-hardblock"
    )

    # ── Load data ──
    conditions = ["emotion-no_affect", "emotion-tone_only", "emotion-explicit_policy"]
    all_messages = {}
    llm_data = {}

    for cond in conditions:
        cond_path = base / cond
        msgs = load_user_messages(str(cond_path))
        if msgs:
            all_messages = msgs  # same inputs across conditions
        llm_data[cond] = load_llm_affect(str(cond_path))

    scene_ids = sorted(all_messages.keys())
    print(f"Loaded {len(scene_ids)} scenes with user messages\n")

    # ── Run all three methods ──
    print("=" * 80)
    print("PER-SCENE COMPARISON (first 15 scenes shown)")
    print("=" * 80)
    print(
        f"{'Scene':<10} {'Message (truncated)':<45} {'Lexicon':<12} {'SnowNLP':<12} {'LLM':<12}"
    )
    print("-" * 80)

    lexicon_results = {}
    snownlp_results = {}

    for sid in scene_ids:
        text = all_messages[sid]["current_message"]
        msg_short = text[:42] + "..." if len(text) > 42 else text

        lex = lexicon_analyze(text)
        sn = snownlp_analyze(text)
        llm = llm_data.get("emotion-explicit_policy", {}).get(sid, {})

        lexicon_results[sid] = lex
        snownlp_results[sid] = sn

        print(
            f"{sid:<10} {msg_short:<45} "
            f"{str(lex['label']):<12} "
            f"{str(sn['label']):<12} "
            f"{str(llm.get('label', '-')):<12}"
        )

    # ── Aggregate statistics ──
    print("\n" + "=" * 80)
    print("AGGREGATE COMPARISON")
    print("=" * 80)

    for method_name, results in [
        ("Lexicon (Dictionary)", lexicon_results),
        ("SnowNLP (Traditional ML)", snownlp_results),
        ("LLM (explicit_policy)", llm_data.get("emotion-explicit_policy", {})),
        ("LLM (tone_only)", llm_data.get("emotion-tone_only", {})),
    ]:
        labels = [classify_emotion(r.get("label")) for r in results.values()]
        counter = Counter(labels)
        total = len(labels)
        emotional = sum(1 for l in labels if l != "neutral")
        print(f"\n  {method_name}:")
        print(f"    Emotional rate: {emotional}/{total} ({emotional/total*100:.1f}%)")
        for label, count in counter.most_common():
            print(f"    {label}: {count} ({count/total*100:.1f}%)")

    # ── Agreement matrix ──
    print("\n" + "=" * 80)
    print("METHOD AGREEMENT (on detection of ANY emotion)")
    print("=" * 80)

    methods_for_agreement = {
        "Lexicon": [classify_emotion(lexicon_results[s]["label"]) for s in scene_ids],
        "SnowNLP": [classify_emotion(snownlp_results[s]["label"]) for s in scene_ids],
        "LLM": [
            classify_emotion(
                llm_data.get("emotion-explicit_policy", {}).get(s, {}).get("label")
            )
            for s in scene_ids
        ],
    }

    names = list(methods_for_agreement.keys())
    for i, n1 in enumerate(names):
        for j, n2 in enumerate(names):
            if j <= i:
                continue
            r1 = methods_for_agreement[n1]
            r2 = methods_for_agreement[n2]
            agree = sum(1 for a, b in zip(r1, r2) if a == b)
            print(f"  {n1} vs {n2}: {agree}/{len(r1)} ({agree/len(r1)*100:.1f}%)")

    # ── Speed comparison ──
    print("\n" + "=" * 80)
    print("SPEED COMPARISON (average over 30 scenes)")
    print("=" * 80)

    sample_texts = [all_messages[s]["current_message"] for s in scene_ids]

    # Lexicon speed
    t0 = time.perf_counter()
    for t in sample_texts:
        lexicon_analyze(t)
    lex_time = (time.perf_counter() - t0) / len(sample_texts) * 1000

    # SnowNLP speed
    t0 = time.perf_counter()
    for t in sample_texts:
        snownlp_analyze(t)
    sn_time = (time.perf_counter() - t0) / len(sample_texts) * 1000

    print(f"  Lexicon (Dictionary):  {lex_time:.2f} ms per message")
    print(f"  SnowNLP (Traditional ML): {sn_time:.2f} ms per message")
    print(f"  LLM (DeepSeek API):    ~1500-5000 ms per message (measured in V6 runs)")

    # ── Key disagreement examples ──
    print("\n" + "=" * 80)
    print("KEY DISAGREEMENT EXAMPLES (Lexicon vs LLM)")
    print("=" * 80)

    disagreements = []
    for sid in scene_ids:
        lex_label = classify_emotion(lexicon_results[sid]["label"])
        llm_label = classify_emotion(
            llm_data.get("emotion-explicit_policy", {}).get(sid, {}).get("label")
        )
        if lex_label != llm_label:
            disagreements.append(
                (sid, lex_label, llm_label, all_messages[sid]["current_message"])
            )

    for sid, lex_l, llm_l, msg in disagreements[:10]:
        print(f"\n  {sid}: Lexicon={lex_l}, LLM={llm_l}")
        print(f"  Message: {msg[:120]}")

    # ── Output JSON for thesis tables ──
    output = {
        "per_scene": {},
        "aggregate": {
            "lexicon": dict(Counter(classify_emotion(lexicon_results[s]["label"]) for s in scene_ids)),
            "snownlp": dict(Counter(classify_emotion(snownlp_results[s]["label"]) for s in scene_ids)),
            "llm_explicit": dict(Counter(
                classify_emotion(llm_data.get("emotion-explicit_policy", {}).get(s, {}).get("label"))
                for s in scene_ids
            )),
        },
        "speed_ms": {"lexicon": round(lex_time, 2), "snownlp": round(sn_time, 2), "llm": "1500-5000"},
    }
    for sid in scene_ids:
        output["per_scene"][sid] = {
            "message": all_messages[sid]["current_message"][:100],
            "lexicon": lexicon_results[sid],
            "snownlp": snownlp_results[sid],
            "llm": llm_data.get("emotion-explicit_policy", {}).get(sid, {}),
        }

    out_path = base / "emotion-method-comparison.json"
    with open(out_path, "w") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"\nFull results written to {out_path}")


if __name__ == "__main__":
    main()
