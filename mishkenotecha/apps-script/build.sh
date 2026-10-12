#!/usr/bin/env bash
# Builds dist/Code.gs: one file to paste into the Apps Script editor.
# It contains js/core.js (the business rules, the same code the tests run)
# followed by src/Server.js.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$here/dist"
{
  echo "// ==== נוצר אוטומטית על ידי apps-script/build.sh - לא לערוך ידנית ===="
  echo
  cat "$here/../js/core.js"
  echo
  cat "$here/src/Server.js"
} > "$here/dist/Code.gs"
cp "$here/appsscript.json" "$here/dist/appsscript.json"
node --check "$here/dist/Code.gs" 2>/dev/null || node -e "new Function(require('fs').readFileSync('$here/dist/Code.gs','utf8'))"
echo "✔ dist/Code.gs נבנה"
