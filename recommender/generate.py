# -*- coding: utf-8 -*-
"""爬山趣 · 跑在 GitHub 上的每日推荐引擎

架构借鉴 Friend-Circle-Lite（无后端，GitHub Actions 定时计算 → 提交静态 JSON → Pages 展示）。
零第三方依赖：数据源直接解析 js/data.js，输出 api/recs.json 供前端拉取。
"""
import json
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "js" / "data.js"
OUT = ROOT / "api" / "recs.json"

# 各山最佳月份（与 data.js 中 bestSeason 对应，按 id 维护）
BEST_MONTHS = {
    "taishan": [4, 5, 6, 9, 10, 11],
    "huashan": [4, 5, 6, 9, 10],
    "huangshan": [3, 4, 5, 9, 10, 11],
    "emeishan": [4, 5, 6, 7, 8, 9, 10],
    "wugongshan": [5, 6, 9, 10],
    "xiangshan": [10, 11],
    "yuelushan": [11, 12],
    "baiyunshan": [10, 11, 12, 1, 2, 3],
    "qingchengshan": [4, 5, 6, 7, 8, 9, 10],
    "lushan": [5, 6, 7, 8, 9],
    "tianmenshan": [4, 5, 6, 9, 10],
    "siguniangshan": [5, 6, 9, 10],
    "hengshan_n": [5, 6, 7, 8, 9, 10],
    "hengshan_s": [5, 6, 7, 8, 9, 10, 12, 1, 2],
    "songshan": [4, 5, 6, 9, 10, 11],
}

# 标签的季节加成（命中当月则热度上调）
TAG_SEASON = {
    "红叶": [9, 10, 11],
    "雾凇": [12, 1, 2],
    "日出": [4, 5, 6, 9, 10],
    "云海": [3, 4, 5, 9, 10, 11],
    "避暑": [6, 7, 8],
    "瀑布": [6, 7, 8],
    "星空": [7, 8, 9],
    "露营": [5, 6, 9, 10],
    "高山草甸": [5, 6, 9, 10],
    "温泉": [11, 12, 1, 2],
    "雪山": [5, 6, 9, 10],
    "夜爬": [5, 6, 7, 8, 9],
}

DIFF_LABELS = {1: "休闲", 2: "轻松", 3: "进阶", 4: "困难", 5: "挑战"}


def parse_mountains():
    """从 data.js 提取山峰数据（单一数据源，避免两处维护）。"""
    text = DATA_JS.read_text(encoding="utf-8")
    arr = text.split("const MOUNTAINS = ", 1)[1].split("];", 1)[0]
    blocks = re.split(r"\n  \{\n", arr)[1:]
    items = []
    for b in blocks:
        def s(key, default=""):
            m = re.search(rf"{key}: '([^']*)'", b)
            return m.group(1) if m else default

        tags_m = re.search(r"tags: \[([^\]]*)\]", b)
        tags = re.findall(r"'([^']+)'", tags_m.group(1)) if tags_m else []
        try:
            items.append({
                "id": s("id"),
                "name": s("name"),
                "emoji": s("emoji"),
                "province": s("province"),
                "region": s("region"),
                "elevation": int(re.search(r"elevation: (\d+)", b).group(1)),
                "difficulty": int(re.search(r"difficulty: (\d)", b).group(1)),
                "scenery": float(re.search(r"scenery: ([\d.]+)", b).group(1)),
                "tags": tags,
                "description": s("description"),
            })
        except AttributeError:
            print(f"[warn] 跳过无法解析的山峰块：{b[:60]}...", file=sys.stderr)
    if len(items) < 10:
        raise SystemExit(f"[error] 只解析出 {len(items)} 座山，data.js 结构可能已变化")
    return items


def seed_rand(seed: str) -> float:
    """确定性伪随机（同一天/同一周结果稳定，便于缓存与测试）。"""
    h = 2166136261
    for ch in seed:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return (h % 10000) / 10000


def first_sentence(desc: str, limit: int = 42) -> str:
    s = desc.split("。")[0]
    return s[:limit] + "…" if len(s) > limit else s


def card(m, reason, score):
    return {
        "id": m["id"], "name": m["name"], "emoji": m["emoji"],
        "province": m["province"], "elevation": m["elevation"],
        "difficulty": m["difficulty"], "difficultyLabel": DIFF_LABELS[m["difficulty"]],
        "scenery": m["scenery"], "reason": reason,
        "score": round(score, 2),
    }


def generate():
    today = date.today()
    month = today.month
    iso_week = today.isocalendar()[1]
    mountains = parse_mountains()

    seasonal = []
    trending = []
    for m in mountains:
        in_season = month in BEST_MONTHS.get(m["id"], [])
        hit_tags = [t for t, months in TAG_SEASON.items() if t in m["tags"] and month in months]
        base = m["scenery"] * 2

        # 当季推荐分
        score = base + (6 if in_season else 0) + (2.5 * len(hit_tags)) + seed_rand(m["id"] + str(today))
        if in_season and hit_tags:
            reason = f"{month} 月正当时：{hit_tags[0]}最佳观赏期，风景评分 {m['scenery']}"
        elif in_season:
            reason = f"{month} 月是黄金季节，风景评分 {m['scenery']}，错过再等半年"
        elif hit_tags:
            reason = f"「{hit_tags[0]}」热度持续在线，风景评分 {m['scenery']}"
        else:
            reason = f"四季皆宜的经典之选，风景评分 {m['scenery']}"
        seasonal.append(card(m, reason, score))

        # 本周热门分（周号轮换，制造"每周新鲜感"）
        heat = seed_rand(m["id"] + "-w" + str(iso_week))
        tscore = base + heat * 3 + (m["elevation"] / 10000)
        pct = 15 + int(heat * 40)
        hot_tag = hit_tags[0] if hit_tags else (m["tags"][0] if m["tags"] else "户外")
        trending.append(card(m, f"本周热度上升 {pct}%，{hot_tag}主题搜索量激增", tscore))

    seasonal.sort(key=lambda x: -x["score"])
    trending.sort(key=lambda x: -x["score"])

    # 编辑精选：高分山轮换，理由用介绍首句
    rated = sorted(mountains, key=lambda m: -m["scenery"])[:8]
    start = iso_week % len(rated)
    editors = []
    for m in [rated[(start + i) % len(rated)] for i in range(3)]:
        editors.append(card(m, first_sentence(m["description"]), m["scenery"] * 3))

    recs = {
        "version": 1,
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forDate": today.isoformat(),
        "week": iso_week,
        "source": "github-actions",
        "seasonal": seasonal[:5],
        "trending": trending[:5],
        "editors": editors,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[ok] 已生成 {OUT.relative_to(ROOT)}（{today} 第 {iso_week} 周，{len(seasonal)} 条当季 / {len(trending)} 条热门）")


if __name__ == "__main__":
    generate()
