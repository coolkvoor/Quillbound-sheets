#!/bin/sh
# Assemble the publishable app in dist/
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/vendor
cp src/index.html src/app.js src/worker.js src/loader.js src/engine.js src/selftest.js src/content.js src/spells.js dist/
cp node_modules/pdf-lib/dist/pdf-lib.min.js dist/vendor/pdf-lib.min.js
# the publisher rejects raw U+FFFD characters; they only occur inside string literals, so escape them
node -e "const fs=require('fs');const f='dist/vendor/pdf-lib.min.js';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\uFFFD/g,'\\\\ufffd'))"
for f in dist/*.js; do node --check "$f"; done
ls -la dist dist/vendor | awk '{print $5, $9}'
