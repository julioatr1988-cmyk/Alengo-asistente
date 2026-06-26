// Re-applies compatibility patches to @whiskeysockets/baileys after npm install.
// Fixes "SyntaxError: Unexpected token 'with'" in Electron 28 (Node 20).
const fs = require('fs')
const path = require('path')

const patches = [
  {
    file: path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Defaults/index.js'),
    from: `import defaultVersion from './baileys-version.json' with { type: 'json' };
const { version } = defaultVersion;`,
    to: `import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
const defaultVersion = _require('./baileys-version.json');
const { version } = defaultVersion;`,
  },
  {
    file: path.join(__dirname, '../node_modules/@whiskeysockets/baileys/lib/Utils/generics.js'),
    from: `import version from '../Defaults/baileys-version.json' with { type: 'json' };
const baileysVersion = version.version;`,
    to: `import { createRequire } from 'module';
const _require2 = createRequire(import.meta.url);
const version = _require2('../Defaults/baileys-version.json');
const baileysVersion = version.version;`,
  },
]

let applied = 0
for (const { file, from, to } of patches) {
  if (!fs.existsSync(file)) { console.log('[patch] skipped (not found):', file); continue }
  const content = fs.readFileSync(file, 'utf8')
  if (content.includes(to)) { console.log('[patch] already applied:', path.basename(file)); continue }
  if (!content.includes(from)) { console.log('[patch] pattern not found (baileys version changed?):', path.basename(file)); continue }
  fs.writeFileSync(file, content.replace(from, to), 'utf8')
  console.log('[patch] applied:', path.basename(file))
  applied++
}
if (applied > 0) console.log(`[patch] ${applied} patch(es) applied to baileys.`)
