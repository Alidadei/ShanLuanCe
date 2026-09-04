# -*- coding: utf-8 -*-
"""爬山趣 · 跑在 GitHub 上的每日推荐引擎 v2

架构借鉴 Friend-Circle-Lite（无后端，GitHub Actions 定时计算 → 提交静态 JSON → Pages 展示）。
零第三方依赖：数据源解析 js/data.js，天气来自 Open-Meteo 免费接口（无需密钥），
输出 api/recs.json 供前端拉取。任何外部依赖失败都自动降级，不阻塞生成。
"""
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_JS = ROOT / "js" / "data.js"
OUT = ROOT / "api" / "recs.json"
CN_TZ = timezone(timedelta(hours=8))  # 北京时间（runner 是 UTC，统一换算）

WEATHER_API = (
    "https://api.open-meteo.com/v1/forecast"
    "?latitude={lats}&longitude={lngs}"
    "&daily=weather_code,temperature_2m_min,precipitation_probability_max"
    "&timezone=Asia%2FShanghai&forecast_days=7"
)

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

# 标签的季节加成
TAG_SEASON = {
    "红叶": [9, 10, 11], "雾凇": [12, 1, 2], "日出": [4, 5, 6, 9, 10],
    "云海": [3, 4, 5, 9, 10, 11], "避暑": [6, 7, 8], "瀑布": [6, 7, 8],
    "星空": [7, 8, 9], "露营": [5, 6, 9, 10], "高山草甸": [5, 6, 9, 10],
    "温泉": [11, 12, 1, 2], "雪山": [5, 6, 9, 10], "夜爬": [5, 6, 7, 8, 9],
}

# 假期人流高地：假期前后慎选（拥挤预警），冷门山反向推荐错峰
CROWD_HOT = {"taishan", "huashan", "huangshan", "emeishan", "tianmenshan", "xiangshan", "wugongshan"}

# 近年法定假期（大致区间即可，用于人流启发式）
HOLIDAYS = [
    ("2026-10-01", "2026-10-08", "国庆长假"),
    ("2026-12-31", "2027-01-02", "元旦"),
    ("2027-02-05", "2027-02-12", "春节"),
    ("2027-04-03", "2027-04-05", "清明"),
    ("2027-05-01", "2027-05-05", "五一"),
    ("2027-06-12", "2027-06-14", "端午"),
    ("2027-09-24", "2027-09-27", "中秋"),
    ("2027-10-01", "2027-10-08", "国庆长假"),
]

# WMO 天气代码 → 中文
WMO = {
    0: "晴", 1: "大致晴", 2: "多云", 3: "阴",
    45: "雾", 48: "雾凇",
    51: "毛毛雨", 53: "毛毛雨", 55: "毛毛雨",
    61: "小雨", 63: "中雨", 65: "大雨",
    66: "冻雨", 67: "冻雨",
    71: "小雪", 73: "中雪", 75: "大雪", 77: "雪粒",
    80: "阵雨", 81: "阵雨", 82: "强阵雨",
    85: "阵雪", 86: "阵雪",
    95: "雷阵雨", 96: "雷阵雨伴冰雹", 99: "雷阵雨伴冰雹",
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
        dur = s("duration")
        days_m = re.search(r"(\d+)\s*天", dur)
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
                "days": int(days_m.group(1)) if days_m else 1,
                "tags": tags,
                "description": s("description"),
            })
        except AttributeError:
            print(f"[warn] 跳过无法解析的山峰块：{b[:60]}...", file=sys.stderr)
    if len(items) < 10:
        raise SystemExit(f"[error] 只解析出 {len(items)} 座山，data.js 结构可能已变化")
    return items


def parse_coords():
    text = DATA_JS.read_text(encoding="utf-8")
    block = text.split("const COORDS = {", 1)[1].split("};", 1)[0]
    coords = {}
    for m in re.finditer(r"([\w-]+): \[([\d.]+), ([\d.]+)\]", block):
        coords[m.group(1)] = (float(m.group(2)), float(m.group(3)))
    if len(coords) < 10:
        raise SystemExit("[error] COORDS 解析失败")
    return coords


def seed_rand(seed: str) -> float:
    """确定性伪随机（同一天/同一周结果稳定，便于缓存与测试）。"""
    h = 2166136261
    for ch in seed:
        h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return (h % 10000) / 10000


def first_sentence(desc: str, limit: int = 42) -> str:
    s = desc.split("。")[0]
    return s[:limit] + "…" if len(s) > limit else s


def next_saturday(today: date) -> date:
    return today + timedelta(days=(5 - today.weekday()) % 7)


def fetch_weather(coords, ids, target: date):
    """批量拉取 Open-Meteo 周末预报，返回 {id: text|None}。网络失败返回空表。"""
    today = date.today()
    idx = (target - today).days
    if not (0 <= idx <= 6):
        return {}
    lats = ",".join(str(coords[i][0]) for i in ids)
    lngs = ",".join(str(coords[i][1]) for i in ids)
    url = WEATHER_API.format(lats=lats, lngs=lngs)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "pashanqu-recs/2"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except Exception as e:  # 网络异常自动降级
        print(f"[warn] 天气拉取失败，降级为无天气模式：{e}", file=sys.stderr)
        return {}
    results = data if isinstance(data, list) else [data]
    out = {}
    for mid, r in zip(ids, results):
        out[mid] = None
        try:
            d = r["daily"]
            code = d["weather_code"][idx]
            prob = d["precipitation_probability_max"][idx]
            tmin = d["temperature_2m_min"][idx]
            # 任一字段缺测（null）即放弃该山天气信号，避免脏数据影响榜单
            if code is None or prob is None or tmin is None:
                continue
            w = WMO.get(code, "多云")
            elev = next((m["elevation"] for m in MOUNTAINS_CACHE if m["id"] == mid), 0)
            summit = round(tmin - elev * 6.5 / 1000)
            out[mid] = {
                "text": f"{w}，降水概率 {prob}%，山顶夜温约 {summit}°C",
                "short": w, "prob": prob, "summitTemp": summit,
            }
        except (KeyError, IndexError, TypeError):
            out[mid] = None
    return out


def holiday_context(today: date):
    """(假期名, 天数后开始) 或 None。"""
    for start, end, name in HOLIDAYS:
        s, e = date.fromisoformat(start), date.fromisoformat(end)
        if s <= today <= e:
            return name, 0
        if 0 < (s - today).days <= 3:
            return name, (s - today).days
    return None


MOUNTAINS_CACHE = []


def card(m, reason, score, weather=None, extra=None):
    c = {
        "id": m["id"], "name": m["name"], "emoji": m["emoji"],
        "province": m["province"], "elevation": m["elevation"],
        "difficulty": m["difficulty"], "difficultyLabel": DIFF_LABELS[m["difficulty"]],
        "scenery": m["scenery"], "reason": reason,
        "score": round(score, 2), "weather": weather["text"] if weather else None,
    }
    if extra:
        c.update(extra)
    return c


def generate():
    global MOUNTAINS_CACHE
    now_cn = datetime.now(CN_TZ)
    today = now_cn.date()
    month = today.month
    iso_week = today.isocalendar()[1]
    weekday = today.weekday()  # 0=周一 … 4=周五
    weekend = next_saturday(today)

    mountains = parse_mountains()
    MOUNTAINS_CACHE = mountains
    coords = parse_coords()
    holiday = holiday_context(today)
    weather = fetch_weather(coords, [m["id"] for m in mountains], weekend)
    holiday_note = f"{holiday[0]}临近" if holiday and holiday[1] else (f"{holiday[0]}进行中" if holiday else None)

    seasonal, trending, weekend_picks = [], [], []
    for m in mountains:
        w = weather.get(m["id"])
        in_season = month in BEST_MONTHS.get(m["id"], [])
        hit_tags = [t for t, months in TAG_SEASON.items() if t in m["tags"] and month in months]
        base = m["scenery"] * 2

        # ---- 天气信号 ----
        w_score, w_reason = 0, None
        if w:
            if w["prob"] <= 30:
                w_score = 6
                w_reason = f"周末{w['short']}，降水概率仅 {w['prob']}%，山顶夜温约 {w['summitTemp']}°C"
            elif w["prob"] <= 60:
                w_score = 1
            else:
                w_score = -7
                w_reason = f"周末{w['short']}（降水 {w['prob']}%），建议改期或备好雨具"

        # ---- 假期人流信号 ----
        c_score, c_reason = 0, None
        if holiday:
            if m["id"] in CROWD_HOT:
                c_score = -5
                c_reason = f"{holiday_note}，人从众预警，建议错峰"
            else:
                c_score = 3
                c_reason = f"{holiday_note}，它是不错的错峰选择"

        # ---- 周末场景信号（周五~周六生成的榜单，优先两天线）----
        wk_score, wk_reason = 0, None
        if weekday >= 4 and m["days"] >= 2:
            wk_score = 5
            wk_reason = f"周末两天刚好走完（建议 {m['days']} 天行程）"

        # ---- 当季 ----
        s_score = base + (6 if in_season else 0) + (2.5 * len(hit_tags)) + seed_rand(m["id"] + str(today))
        if w_score > 0 and w_reason:
            s_score += w_score
            s_reason = f"{w_reason.split('，')[0]}，{hit_tags[0]}正当时" if hit_tags and in_season else w_reason
        elif c_reason:
            s_score += c_score
            s_reason = c_reason
        elif in_season and hit_tags:
            s_reason = f"{month} 月正当时：{hit_tags[0]}最佳观赏期，风景评分 {m['scenery']}"
        elif in_season:
            s_reason = f"{month} 月是黄金季节，风景评分 {m['scenery']}，错过再等半年"
        elif w_reason and w_score < 0:
            s_reason = w_reason
        elif hit_tags:
            s_reason = f"「{hit_tags[0]}」热度持续在线，风景评分 {m['scenery']}"
        else:
            s_reason = f"四季皆宜的经典之选，风景评分 {m['scenery']}"
        seasonal.append(card(m, s_reason, s_score, w))

        # ---- 本周热门（周号轮换 + 天气加成）----
        heat = seed_rand(m["id"] + "-w" + str(iso_week))
        t_score = base + heat * 3 + (m["elevation"] / 10000) + max(0, w_score)
        pct = 15 + int(heat * 40)
        hot_tag = hit_tags[0] if hit_tags else (m["tags"][0] if m["tags"] else "户外")
        t_reason = f"本周热度上升 {pct}%，{hot_tag}主题搜索量激增"
        if w and w["prob"] <= 30:
            t_reason += f"；周末{w['short']}，正适合出发"
        trending.append(card(m, t_reason, t_score, w))

        # ---- 周末就出发（两天线偏好 + 好天优先）----
        wp_score = base + wk_score + w_score * 1.5 + (2 if m["days"] == 1 and weekday >= 4 else 0)
        if wk_reason:
            wp_reason = wk_reason
        elif w and w["prob"] <= 30:
            wp_reason = f"周末{w['text']}，说走就走"
        elif w and w["prob"] > 60:
            wp_reason = f"周末{w['short']}，除非真爱否则再等一周"
        else:
            wp_reason = f"{'半日' if m['days'] == 1 else '两日'}可完成的周末方案，风景评分 {m['scenery']}"
        weekend_picks.append(card(m, wp_reason, wp_score, w))

    seasonal.sort(key=lambda x: -x["score"])
    trending.sort(key=lambda x: -x["score"])
    weekend_picks.sort(key=lambda x: -x["score"])

    # 编辑精选：高分山轮换，理由用介绍首句
    rated = sorted(mountains, key=lambda m: -m["scenery"])[:8]
    start = iso_week % len(rated)
    editors = []
    for m in [rated[(start + i) % len(rated)] for i in range(3)]:
        editors.append(card(m, first_sentence(m["description"]), m["scenery"] * 3))

    recs = {
        "version": 2,
        "generatedAt": now_cn.strftime("%Y-%m-%dT%H:%M:%S+08:00"),
        "forDate": today.isoformat(),
        "week": iso_week,
        "weekendOf": weekend.isoformat(),
        "holiday": holiday_note,
        "weatherEnabled": bool(weather),
        "source": "github-actions",
        "seasonal": seasonal[:5],
        "trending": trending[:5],
        "weekend": weekend_picks[:4],
        "editors": editors,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(recs, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"[ok] 已生成 {OUT.relative_to(ROOT)}（{today} 第 {iso_week} 周，"
        f"周末={weekend}，天气={'开' if weather else '关'}，假期={holiday_note or '无'}，"
        f"{len(seasonal)} 当季 / {len(trending)} 热门 / {len(weekend_picks)} 周末）"
    )


if __name__ == "__main__":
    generate()
