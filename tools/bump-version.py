#!/usr/bin/env python3
"""
Stamp every local script/stylesheet link in the app and portal pages with ?v=<version>,
so browsers load the new files right after a site update instead of an old cached copy.
Run it before publishing a change:  python3 tools/bump-version.py
"""
import re, sys, time, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
version = sys.argv[1] if len(sys.argv) > 1 else time.strftime("%Y%m%d%H%M")
pattern = re.compile(r'((?:src|href)=")((?!https?:|//)[^"?#]+\.(?:js|css))(?:\?v=[^"]*)?(")')
for page in ["app/index.html", "portal/index.html"]:
    path = root / page
    text = path.read_text(encoding="utf-8")
    new = pattern.sub(lambda m: m.group(1) + m.group(2) + "?v=" + version + m.group(3), text)
    path.write_text(new, encoding="utf-8")
    print(page, "->", version)
