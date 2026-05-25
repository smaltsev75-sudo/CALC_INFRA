#!/usr/bin/env node
// scripts/bump-version.mjs
//
// Bump-инструмент для синхронной правки версии в 2 местах:
//   1. js/utils/constants.js   export const APP_VERSION   → 'X.Y.Z'
//   2. package.json            "version"                  → "X.Y.Z"
//
// Калькулятор НЕ PWA (нет sw.js / manifest.json / cache-bust в index.html),
// поэтому 2 точки — это всё. Если в будущем добавится PWA или версия
// документа в UserManual.md как явная строка — добавить сюда target.
//
// Запуск:
//   node scripts/bump-version.mjs <version>
//   npm run bump -- <version>
//
// Примеры:
//   npm run bump -- 2.17.7
//   npm run bump -- 2.18.0
//   npm run bump -- 3.0.0
//
// Проверки до записи:
//   - формат X.Y.Z строгий (без префикса 'v', без суффикса '-beta');
//   - новая версия СТРОГО БОЛЬШЕ текущей в package.json (semver-compare),
//     чтобы случайно не откатиться назад;
//   - паттерн в каждом target обязан найтись (иначе fail).
//
// Идемпотентность: повторный вызов с той же версией → no-op, не падает.
//
// Тест tests/unit/architecture/app-version-sync.test.js потом проверит
// что constants.js и package.json синхронны.
// Не трогает docs/assistant/DECISIONS.md / docs/assistant/CLAUDE.md — записи добавляются вручную.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(__filename), '..');

const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function fail(msg) {
    console.error(`bump-version: ${msg}`);
    process.exit(1);
}

/** Сравнение SemVer: возвращает -1 / 0 / 1. */
function semverCompare(a, b) {
    const [a1, a2, a3] = a.split('.').map(Number);
    const [b1, b2, b3] = b.split('.').map(Number);
    if (a1 !== b1) return a1 < b1 ? -1 : 1;
    if (a2 !== b2) return a2 < b2 ? -1 : 1;
    if (a3 !== b3) return a3 < b3 ? -1 : 1;
    return 0;
}

const version = process.argv[2];
if (!version) fail('usage: bump-version.mjs <X.Y.Z>');
if (!SEMVER_RE.test(version)) fail(`invalid semver "${version}"; expected X.Y.Z (no prefix)`);

// Проверка что новая версия не ниже текущей.
const currentPkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
const cmp = semverCompare(version, currentPkg.version);
if (cmp < 0) fail(`refusing to downgrade ${currentPkg.version} → ${version}`);
if (cmp === 0) {
    console.log(`bump-version: version is already ${version}, nothing to do`);
    process.exit(0);
}

const targets = [
    {
        file: 'package.json',
        pattern: /("version"\s*:\s*")([^"]+)(")/,
        replacement: `$1${version}$3`
    },
    {
        file: 'js/utils/constants.js',
        pattern: /(export const APP_VERSION\s*=\s*')([^']+)(';)/,
        replacement: `$1${version}$3`
    }
];

const changes = [];
for (const t of targets) {
    const abs = path.join(repoRoot, t.file);
    const src = fs.readFileSync(abs, 'utf8');
    if (!src.match(t.pattern)) fail(`pattern not found in ${t.file}`);
    const updated = src.replace(t.pattern, t.replacement);
    if (updated === src) {
        changes.push({ file: t.file, status: 'no-change' });
        continue;
    }
    fs.writeFileSync(abs, updated, 'utf8');
    changes.push({ file: t.file, status: 'updated' });
}

console.log(`bump-version → ${currentPkg.version} → ${version}`);
for (const c of changes) console.log(`  ${c.status.padEnd(10)} ${c.file}`);
console.log('');
console.log('Next steps:');
console.log('  1. Add section to docs/assistant/DECISIONS.md');
console.log('  2. Update docs/assistant/CLAUDE.md release note');
console.log('  3. npm test');
console.log('  4. git commit + push');
console.log('  5. gh release create v' + version + ' --target HEAD --title ...');
