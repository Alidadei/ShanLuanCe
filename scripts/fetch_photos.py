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
        except Exception as e:
            last = e
            if "SSL" in str(e) or "EOF" in str(e) or "timed out" in str(e):
                time.sleep(1.2 * (i + 1))
                continue
            raise
    raise last


def get_with_fallback(url):
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
        if re.search(r"map|地图|diagram|logo|station|airport|ticket|游客中心|入口|gate", title, re.I):
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
            m = re.match(r"- \*\*(.+?)\*\*（`([\w-]+)\.jpg`）：\[(.+?)\]\((.+?)\)，作者：(.+)，许可：(.+)$", line)
            if m:
                credits[m.group(2)] = m.groups()

    ok, fail = 0, []
    for mid, (pattern, queries) in M.items():
        out = IMG / f"{mid}.jpg"
        if out.exists() and out.stat().st_size > 20000 and not force and mid in credits:
            ok += 1
            print(f"[{mid}] 已有，跳过")
            continue
        chosen = None
        for q in queries:
            print(f"[{mid}] 搜索：{q}")
            try:
                cands = search(pattern, q)
            except Exception as e:
                print(f"    检索失败：{e}")
                continue
            if cands:
                chosen = cands[0]
                break
        if not chosen:
            fail.append(mid)
            print("    ✗ 无合格候选")
            continue
        try:
            img = get_with_fallback(chosen["thumb"])
            if not img.startswith(b"\xff\xd8"):
                raise ValueError("非 JPEG")
        except Exception as e:
            print(f"    下载失败：{e}")
            fail.append(mid)
            continue
        out.write_bytes(img)
        ok += 1
        credits[mid] = (cn_names.get(mid, mid), mid, chosen["title"],
                        f"https://commons.wikimedia.org/wiki/{urllib.parse.quote(chosen['title'])}",
                        chosen["artist"], chosen["license"])
        print(f"    ✓ {chosen['title']}（{len(img)//1024}KB，{chosen['license']}，by {chosen['artist'][:28]}）")

    lines = ["# 图片版权信息", "",
             "以下照片来自 Wikimedia Commons（自由许可），按山名列出作者与协议：", ""]
    for mid in M:
        if mid in credits:
            cn, _mid, title, page, artist, lic = credits[mid]
            lines.append(f"- **{cn}**（`{mid}.jpg`）：[{title}]({page})，作者：{artist}，许可：{lic}")
    credits_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"\n[done] 成功 {ok}/15，失败：{fail or '无'}")


if __name__ == "__main__":
    main(force="--force" in sys.argv)
