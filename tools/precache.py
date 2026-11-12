"""Writes precache.json: every file barbLib needs to work offline.

Run automatically by tools/release.py; run it by hand after adding files.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = {'.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.png', '.pfb', '.ttf', '.wasm', '.icc'}
SKIP_DIRS = {'samples', 'packages', 'tests', 'tools', 'docs', '.git', 'cmaps'}
SKIP_FILES = {'version.json', 'precache.json', 'package.json', 'sw.js'}


def build():
    files = ['./']
    for p in sorted(ROOT.rglob('*')):
        rel = p.relative_to(ROOT)
        if not p.is_file() or set(rel.parts[:-1]) & SKIP_DIRS or p.name in SKIP_FILES or p.suffix not in EXT:
            continue
        files.append(rel.as_posix())
    (ROOT / 'precache.json').write_text(json.dumps(files, indent=1) + '\n', encoding='utf8')
    return files


if __name__ == '__main__':
    files = build()
    size = sum((ROOT / f).stat().st_size for f in files if f != './')
    print(f'{len(files)} files, {size / 1e6:.1f} MB')
