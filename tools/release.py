"""Bump barbLib's version everywhere it appears.

    python tools/release.py            # 1.0.0 -> 1.0.1 (patch)
    python tools/release.py minor      # 1.0.1 -> 1.1.0
    python tools/release.py major      # 1.1.0 -> 2.0.0
    python tools/release.py 1.4.2      # explicit

Then commit and push: GitHub Pages publishes it, and every installed copy
(browser, Windows app, Android app) shows "Update ready" within minutes.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION_JS = ROOT / 'js' / 'version.js'
VERSION_JSON = ROOT / 'version.json'
SW = ROOT / 'sw.js'

current = re.search(r"VERSION = '([\d.]+)'", VERSION_JS.read_text(encoding='utf8')).group(1)
major, minor, patch = map(int, current.split('.'))
arg = sys.argv[1] if len(sys.argv) > 1 else 'patch'
if arg == 'major':
    new = f'{major + 1}.0.0'
elif arg == 'minor':
    new = f'{major}.{minor + 1}.0'
elif arg == 'patch':
    new = f'{major}.{minor}.{patch + 1}'
elif re.fullmatch(r'\d+\.\d+\.\d+', arg):
    new = arg
else:
    sys.exit(f'Unknown version argument: {arg}')

VERSION_JS.write_text(re.sub(r"VERSION = '[\d.]+'", f"VERSION = '{new}'", VERSION_JS.read_text(encoding='utf8')), encoding='utf8')
VERSION_JSON.write_text(json.dumps({'version': new}) + '\n', encoding='utf8')
SW.write_text(re.sub(r"const CACHE = '[^']+'", f"const CACHE = 'barblib-{new}'", SW.read_text(encoding='utf8')), encoding='utf8')

sys.path.insert(0, str(ROOT / 'tools'))
import precache  # noqa: E402  (refresh the offline file list)
files = precache.build()
print(f'barbLib {current} -> {new}  ({len(files)} files cached for offline use)')
