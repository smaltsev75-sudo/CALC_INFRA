/**
 * Кроссплатформенный test-runner для node:test.
 * Рекурсивно находит все *.test.js в `tests/` и передаёт в `node:test`.
 *
 * Запуск: `node tests/run.js` или `npm test`.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = dirname(__filename);
const REPO_ROOT = dirname(ROOT);

function findTests(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) findTests(full, out);
        else if (st.isFile() && entry.endsWith('.test.js')) out.push(full);
    }
    return out;
}

function collectTarget(target) {
    const full = isAbsolute(target) ? target : resolve(REPO_ROOT, target);
    const st = statSync(full);
    if (st.isDirectory()) return findTests(full, []);
    if (st.isFile() && full.endsWith('.test.js')) return [full];
    throw new Error(`Target is not a *.test.js file or directory: ${target}`);
}

const args = process.argv.slice(2);
const listOnly = args.includes('--list');
const targets = args.filter(a => a !== '--list');
const roots = targets.length > 0 ? targets : [ROOT];
const files = Array.from(new Set(roots.flatMap(collectTarget))).sort();

if (files.length === 0) {
    console.error(`Тестовые файлы не найдены: ${roots.join(', ')}`);
    process.exit(1);
}

if (listOnly) {
    for (const file of files) console.log(relative(REPO_ROOT, file));
    process.exit(0);
}

const scope = targets.length > 0 ? ` (${targets.join(', ')})` : '';
console.log(`Найдено тестовых файлов: ${files.length}${scope}`);

/* concurrency: true — параллельный запуск по числу ядер CPU. node:test
 * создаёт отдельный child process для каждого тестового файла, поэтому
 * shared global state (globalThis.localStorage, синглтон store,
 * module-level кэш storage._probedOk) изолирован между файлами — race
 * conditions не возможны. На 1082 suites / 4536 tests parallel-режим
 * сокращает время прогона примерно в число ядер CPU раз (на 8-core
 * машине ~95 c → ~15-20 c). */
let failures = 0;
const stream = run({ files, concurrency: true });
stream.on('test:fail', () => { failures++; });
stream.compose(spec).pipe(process.stdout);
stream.once('end', () => {
    process.exit(failures === 0 ? 0 : 1);
});
