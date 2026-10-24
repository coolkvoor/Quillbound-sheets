#!/bin/sh
# Assemble the publishable app in dist/
set -e
cd "$(dirname "$0")/.."
rm -rf dist && mkdir -p dist/vendor
cp src/index.html src/features.js src/ui-core.js src/ui-dialog.js src/ui-pages.js src/ui-classes.js src/ui-pictures.js src/ui-spells.js src/ui-content.js src/ui-import.js src/ui-backup.js src/ui-suggest.js src/app.js src/worker.js src/loader.js src/engine.js src/content.js src/spells.js src/appearance.js src/writer.js src/classes.js src/abilities.js dist/
cp node_modules/pdf-lib/dist/pdf-lib.min.js dist/vendor/pdf-lib.min.js
# the publisher rejects raw U+FFFD characters; they only occur inside string literals, so escape them
node -e "const fs=require('fs');const f='dist/vendor/pdf-lib.min.js';fs.writeFileSync(f,fs.readFileSync(f,'utf8').replace(/\uFFFD/g,'\\\\ufffd'))"
for f in dist/*.js; do node --check "$f"; done
ls -la dist dist/vendor | awk '{print $5, $9}'
