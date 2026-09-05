# -*- coding: utf-8 -*-
"""从 Wikimedia Commons 抓取名山真实照片 v2
- 每山多个查询词；标题必须命中山名正则，杜绝"Mount Garnier"式张冠李戴
- SSL 偶发错误自动重试；直连失败走本机代理
- 增量模式：已有且非 force 的文件跳过
"""
import re
import sys
import time
import json
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "img"
API = "https://commons.wikimedia.org/w/api.php"
HEADERS = {"User-Agent": "pashanqu-photo-fetch/2.0 (github.com/Alidadei/pashanqu)"}
PROXY = "http://127.0.0.1:7890"

# id -> (标题必须命中, [查询词…])
M = {
    "taishan": (r"tai\s?shan|mount tai|泰山", ["Mount Tai", "泰山", "Taishan summit"]),
    "huashan": (r"hua\s?shan|mount hua|华山", ["Mount Hua", "Huashan", "华山"]),
    "huangshan": (r"huang\s?shan|yellow mountain|黄山", ["Huangshan", "黄山"]),
    "emeishan": (r"emei|峨眉", ["Mount Emei", "Emeishan", "峨眉山金顶"]),
    "wugongshan": (r"wugong\s?shan|wugong mountain|武功山", ["Wugongshan", "武功山", "Wugong Mountain Jiangxi"]),
    "xiangshan": (r"xiang\s?shan|fragrant hills|香山", ["Fragrant Hills", "Xiangshan Beijing", "香山红叶"]),
    "yuelushan": (r"yuelu|岳麓", ["Yuelu Mountain", "岳麓山", "Yuelushan"]),
    "baiyunshan": (r"baiyun\s?(shan|mountain)|白云山", ["Baiyun Mountain Guangzhou peak", "白云山广州", "Baiyunshan Guangzhou scenery"]),
    "qingchengshan": (r"qingcheng|青城山", ["Mount Qingcheng", "青城山", "Qingchengshan"]),
    "lushan": (r"lu\s?shan|mount lu|庐山", ["Lushan", "Mount Lu", "庐山"]),
    "tianmenshan": (r"tianmen|天门山", ["Tianmen Mountain", "天门山", "Tianmenshan Zhangjiajie"]),
    "siguniangshan": (r"siguniang|四姑娘", ["Mount Siguniang", "四姑娘山", "Siguniangshan"]),
    "hengshan_n": (r"heng\s?shan.*?(shanxi|datong|north)|mount heng \(shanxi\)|恒山", ["Mount Heng Shanxi", "恒山", "Hengshan Datong"]),
    "hengshan_s": (r"heng\s?shan.*(hunan|hengyang|nanyue|south)|mount heng \(hunan\)|南岳", ["Mount Heng Hunan", "南岳衡山", "Hengshan Hengyang"]),
    "songshan": (r"song\s?shan|mount song|嵩山", ["Mount Song", "Songshan", "嵩山"]),
    "changbaishan": (r"chang\s?bai|长白山", ["Changbai Mountain", "长白山天池", "Changbaishan Tianchi"]),
    "qianshan": (r"qian\s?shan|千山", ["Qianshan Anshan", "千山", "Qianshan Liaoning"]),
    "wutaishan": (r"wutai\s?shan|mount wutai|五台山", ["Mount Wutai", "五台山", "Wutaishan"]),
    "xiaowutaishan": (r"xiao\s?wutai|小五台", ["Xiaowutai", "小五台山", "Xiaowutai Shan"]),
    "lingshan": (r"dong\s?ling\s?shan|东灵山|beijing lingshan", ["Dongling Mountain Beijing", "东灵山", "Lingshan Beijing"]),
    "kongtongshan": (r"kong\s?tong|崆峒", ["Kongtong Mountain", "崆峒山", "Kongtongshan"]),
    "maijishan": (r"mai\s?ji|麦积山", ["Maijishan", "麦积山", "Maiji Mountain"]),
    "helanshan": (r"helan|贺兰山", ["Helan Mountains", "贺兰山", "Helan Shan"]),
    "wudangshan": (r"wudang|武当山", ["Wudang Mountains", "武当山", "Wudangshan"]),
    "shennongjia": (r"shen\s?nong|神农架", ["Shennongjia", "神农架", "Shennong Ding"]),
    "laojunshan": (r"lao\s?jun|老君山", ["Laojunshan Luanchuan", "老君山", "Laojun Mountain Luoyang"]),
    "yuntaishan": (r"yun\s?tai|云台山", ["Yuntai Mountain Jiaozuo", "云台山", "Yuntaishan Henan"]),
    "jigongshan": (r"ji\s?gong|鸡公山", ["Jigongshan", "鸡公山", "Jigong Mountain"]),
    "yandangshan": (r"yan\s?dang|雁荡山", ["Yandangshan", "雁荡山", "Yandang Mountain"]),
    "tianmushan": (r"tian\s?mu|天目山", ["Tianmu Mountain", "天目山", "Tianmushan"]),
    "moganshan": (r"moganshan|mo\s?gan\s?shan|莫干山", ["Moganshan", "莫干山", "Mogan Mountain Deqing"]),
    "laoshan": (r"lao\s?shan|崂山", ["Laoshan Qingdao", "崂山", "Mount Lao"]),
    "sanqingshan": (r"san\s?qing|三清山", ["Sanqingshan", "三清山", "Mount Sanqing"]),
    "jinggangshan": (r"jing\s?gang\s?shan|井冈山", ["Jinggangshan mountain", "井冈山杜鹃", "Jinggang Mountains scenery"]),
    "longhushan": (r"long\s?hu|龙虎山", ["Longhushan", "龙虎山", "Mount Longhu"]),
    "danxiashan": (r"dan\s?xia|丹霞山", ["Danxiashan", "丹霞山", "Mount Danxia"]),
    "maoershan": (r"mao\s?er|猫儿山", ["Maoershan Guangxi", "猫儿山", "Cat Mountain Guangxi"]),
    "wuzhishan": (r"wu\s?zhi|五指山", ["Wuzhishan Hainan", "五指山", "Wuzhi Mountain Hainan"]),
    "putuoshan": (r"putuo|普陀山", ["Mount Putuo", "普陀山", "Putuoshan"]),
    "fanjingshan": (r"fan\s?jing|梵净山", ["Fanjingshan", "梵净山", "Mount Fanjing"]),
    "jinfoshan": (r"jin\s?fo|金佛山", ["Jinfoshan", "金佛山", "Jinfo Mountain"]),
    "cangshan": (r"cang\s?shan|苍山|dali mountains", ["Cangshan Dali", "苍山", "Cangshan Mountain"]),
    "jizushan": (r"ji\s?zu|鸡足山", ["Jizushan", "鸡足山", "Jizu Mountain"]),
    "habaxueshan": (r"ha\s?ba|哈巴雪山", ["Haba Snow Mountain", "哈巴雪山", "Haba Xueshan"]),
    "gonggashan": (r"gong\s?ga|贡嘎", ["Minya Konka", "贡嘎山", "Gongga Shan"]),
}


def get(url, use_proxy=False, tries=3):
    last = None
    for i in range(tries):
        try:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}) if use_proxy else urllib.request.ProxyHandler({})
            )
            req = urllib.request.Request(url, headers=HEADERS)
            with opener.open(req, timeout=25) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 429:  # Commons 限流：长退避后重试
                print(f"    429 限流，等待 45s…")
                time.sleep(45)
                last = e
                continue
            raise
        except Exception as e:
            last = e
            if "SSL" in str(e) or "EOF" in str(e) or "timed out" in str(e) or "10054" in str(e):
                time.sleep(1.2 * (i + 1))
                continue
            raise
    raise last


def get_with_fallback(url):
    # commons 直连不可达时可用环境变量 FORCE_PROXY=1 跳过直连阶段
    import os
    if os.environ.get("FORCE_PROXY"):
        return get(url, use_proxy=True)
    try:
        return get(url)
    except Exception as e1:
        print(f"    直连失败（{e1.__class__.__name__}），走代理…")
        return get(url, use_proxy=True)


def strip_html(s):
    return re.sub(r"<[^>]+>", "", s or "").strip()


def search(pattern, query):
    q = urllib.parse.quote(query)
    url = (f"{API}?action=query&format=json&generator=search&gsrsearch={q}%20filetype:bitmap"
           f"&gsrnamespace=6&gsrlimit=14&prop=imageinfo"
           f"&iiprop=url|size|mime|extmetadata&iiurlwidth=800")
    data = json.loads(get_with_fallback(url))
    pages = (data.get("query") or {}).get("pages") or {}
    cands = []
    for p in sorted(pages.values(), key=lambda x: x.get("index", 99)):
        ii = (p.get("imageinfo") or [{}])[0]
        w, h = ii.get("width", 0), ii.get("height", 0)
        title = p.get("title", "")
        if ii.get("mime") != "image/jpeg" or w < 1000 or h < 500:
            continue
        if not (1.05 <= (w / h if h else 0) <= 2.6):
            continue
        if re.search(r"map|地图|diagram|logo|station|airport|ticket|游客中心|入口|gate|bird|dove|bridge|sedan|railway|train|painting|zhuhai|珠海", title, re.I):
            continue
        if not re.search(pattern, title, re.I):
            continue  # 标题必须命中山名
        meta = ii.get("extmetadata") or {}
        cands.append({
            "title": title,
            "thumb": ii.get("thumburl"),
            "artist": strip_html((meta.get("Artist") or {}).get("value", "")) or "未知作者",
            "license": strip_html((meta.get("LicenseShortName") or {}).get("value", "")) or "见文件页",
        })
    return cands


def main(force=False):
    IMG.mkdir(exist_ok=True)
    data_js = (ROOT / "js" / "data.js").read_text(encoding="utf-8")
    cn_names = dict(re.findall(r"id: '([\w-]+)',\s*\n\s*name: '([^']+)'", data_js))

    credits_path = IMG / "CREDITS.md"
    credits = {}
    if credits_path.exists():
        for line in credits_path.read_text(encoding="utf-8").splitlines():
            m = re.match(r"- \*\*(.+?)\*\*（`([\w-]+\.jpg)`）：\[(.+?)\]\((.+?)\)，作者：(.+)，许可：(.+)$", line)
            if m:
                credits[m.group(2)] = m.groups()

    EXTRA = 3  # 每山补充照片数（相册）
    ok, fail = 0, []
    for mid, (pattern, queries) in M.items():
        main_out = IMG / f"{mid}.jpg"
        need_main = force or not (main_out.exists() and main_out.stat().st_size > 20000)
        missing_extra = [i for i in range(2, 2 + EXTRA)
                         if force or not (IMG / f"{mid}-{i}.jpg").exists()]
        if not need_main and not missing_extra and mid in credits:
            ok += 1
            print(f"[{mid}] 已齐全，跳过")
            continue

        # 汇总所有查询词的候选（标题过滤 + 去重）
        seen_titles = set()
        pool = []
        for q in queries:
            print(f"[{mid}] 搜索：{q}")
            time.sleep(2.5)  # 防限流
            try:
                cands = search(pattern, q)
            except Exception as e:
                print(f"    检索失败：{e}")
                continue
            for c in cands:
                if c["title"] not in seen_titles:
                    seen_titles.add(c["title"])
                    pool.append(c)

        # 主图
        if need_main:
            if not pool:
                fail.append(mid)
                print("    ✗ 无合格候选")
                continue
            c = pool[0]
            try:
                img = get_with_fallback(c["thumb"])
                if not img.startswith(b"\xff\xd8"):
                    raise ValueError("非 JPEG")
            except Exception as e:
                print(f"    下载失败：{e}")
                fail.append(mid)
                continue
            main_out.write_bytes(img)
            credits[mid] = (cn_names.get(mid, mid), f"{mid}.jpg", c["title"],
                            f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(c['title'])}",
                            c["artist"], c["license"])
            print(f"    ✓ 主图 {c['title']}（{len(img)//1024}KB）")
        elif mid not in credits:
            credits[mid] = (cn_names.get(mid, mid), f"{mid}.jpg", "（历史下载）",
                            "", "未知作者", "见 Commons")

        # 补充相册图（跳过主图已用标题）
        used = {credits[mid][2] for mid2 in [mid] if mid in credits} if mid in credits else set()
        idx = 2
        for c in pool[1 if not need_main else 1:]:
            if idx > 1 + EXTRA:
                break
            if c["title"] in used:
                continue
            out = IMG / f"{mid}-{idx}.jpg"
            try:
                img = get_with_fallback(c["thumb"])
                if not img.startswith(b"\xff\xd8"):
                    raise ValueError("非 JPEG")
            except Exception as e:
                print(f"    补充图下载失败：{e}")
                continue
            out.write_bytes(img)
            used.add(c["title"])
            credits[f"{mid}-{idx}"] = (f"{cn_names.get(mid, mid)}·相册{idx - 1}", f"{mid}-{idx}.jpg", c["title"],
                                       f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(c['title'])}",
                                       c["artist"], c["license"])
            print(f"    ✓ 相册{idx - 1} {c['title']}（{len(img)//1024}KB）")
            idx += 1
        ok += 1

    lines = ["# 图片版权信息", "",
             "以下照片来自 Wikimedia Commons（自由许可），按山名列出作者与协议：", ""]
    for mid in list(M.keys()) + [f"{m}-{i}" for m in M for i in range(2, 2 + EXTRA)]:
        if mid in credits:
            cn, fname, title, page, artist, lic = credits[mid]
            if page:
                lines.append(f"- **{cn}**（`{fname}`）：[{title}]({page})，作者：{artist}，许可：{lic}")
    credits_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[done] 处理完成 {ok}/15，失败：{fail or '无'}")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
