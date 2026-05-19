/**
 * Кроссплатформенный test-runner для node:test.
 * Рекурсивно находит все *.test.js в `tests/` и передаёт в `node:test`.
 *
 * Запуск: `node tests/run.js` или `npm test`.
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(__filename, '..');

function findTests(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) findTests(full, out);
        else if (st.isFile() && entry.endsWith('.test.js')) out.push(full);
    }
    return out;
}

const files = findTests(ROOT);
console.log(`Найдено тестовых файлов: ${files.length}`);

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
