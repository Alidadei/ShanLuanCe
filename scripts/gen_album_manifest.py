# -*- coding: utf-8 -*-
"""扫描 img/ 目录，生成 js/photos.js 相册清单（PHOTO_ALBUMS）。"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
albums = {}
files = sorted((ROOT / "img").glob("*.jpg"),
               key=lambda f: (0 if "-" not in f.stem else 1, f.stem))  # 主图优先
for f in files:
    mid = f.stem.rsplit("-", 1)[0]
    albums.setdefault(mid, []).append(f"img/{f.name}")

js = ("/* 相册清单：由 scripts/gen_album_manifest.py 自动生成 */\n"
      "'use strict';\n\n"
      "const PHOTO_ALBUMS = " + json.dumps(albums, ensure_ascii=False, indent=2) + ";\n")
(ROOT / "js" / "photos.js").write_text(js, encoding="utf-8")
total = sum(len(v) for v in albums.values())
print(f"[ok] js/photos.js 已生成：{len(albums)} 座山，{total} 张照片")
