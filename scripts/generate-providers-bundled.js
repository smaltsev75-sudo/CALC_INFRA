/**
 * Stage VAT-2 Phase 2 — Bundled providers codegen.
 *
 * Source of truth — `data/providers/*-latest.json` (редактирует maintainer).
 * Runtime source — `js/data/providers-bundled.generated.js` (закоммичен, ESM).
 *
 * Запуск из CLI:
 *   npm run generate:providers
 *   или: node scripts/generate-providers-bundled.js
 *
 * Файл закоммичен в репозиторий — обычный запуск приложения НЕ требует
 * build-step. Sync-test `tests/unit/architecture/providers-bundled-sync.test.js`
 * фейлит CI, если кто-то правил JSON без regen.
 *
 * Свойства:
 *   - Идемпотентность: запуск дважды подряд → нулевой diff.
 *   - Deterministic order (sorted keys на всех уровнях объектов, sorted
 *     providers на верхнем уровне).
 *   - Без runtime-зависимостей (только node:fs / node:path / node:url).
 *   - Output не зависит от browser APIs (чистые JSON-данные внутри
 *     `Object.freeze(...)` ESM-экспорта).
 *
 * Generated module экспортирует:
 *   export const BUNDLED_PROVIDER_PRICES = Object.freeze({
 *     sbercloud: {...},
 *     vk: {...},
 *     yandex: {...}
 *   });
 *
 * Phase 2 НЕ меняет runtime behavior — никто пока не импортирует generated
 * module. Phase 4 переключит `providerOverlay.js` / `providerPriceResolver.js`
 * на этот источник.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PROVIDERS_DIR = join(REPO_ROOT, 'data', 'providers');
const OUTPUT_PATH = join(REPO_ROOT, 'js', 'data', 'providers-bundled.generated.js');

/** Имя файла должно соответствовать паттерну `<providerId>-latest.json`. */
const PROVIDER_FILE_RE = /^([a-z0-9_-]+)-latest\.json$/;

const HEADER = [
    '/**',
    ' * AUTO-GENERATED FILE. DO NOT EDIT BY HAND.',
    ' *',
    ' * Source of truth: data/providers/*-latest.json',
    ' * Regenerate via:  npm run generate:providers',
    ' *',
    ' * Stage VAT-2 Phase 2: bundled-provider runtime source. Sync-test',
    ' * `tests/unit/architecture/providers-bundled-sync.test.js` ловит',
    ' * рассинхронизацию JSON ↔ этого файла.',
    ' */',
    ''
].join('\n');

/**
 * Прочитать все `<providerId>-latest.json` из директории.
 *
 * @param {string} dir
 * @returns {Object<string, object>} — key = providerId (из имени файла),
 *                                     value = parsed JSON.
 */
export function readProvidersFromDir(dir) {
    const out = {};
    const entries = readdirSync(dir);
    for (const name of entries) {
        const m = PROVIDER_FILE_RE.exec(name);
        if (!m) continue;          /* drafts/, прочие файлы — пропускаем */
        const providerId = m[1];
        const raw = readFileSync(join(dir, name), 'utf8');
        out[providerId] = JSON.parse(raw);
    }
    return out;
}

/**
 * Pure: сериализует значение в deterministic JSON-строку с сортировкой
 * ключей на всех уровнях. Массивы не сортируются (порядок элементов
 * семантический — например, history events).
 *
 * @param {*} value
 * @param {number} [indent=4]
 * @returns {string}
 */
export function stableJsonStringify(value, indent = 4) {
    return JSON.stringify(value, (_key, val) => {
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            const sorted = {};
            for (const k of Object.keys(val).sort()) {
                sorted[k] = val[k];
            }
            return sorted;
        }
        return val;
    }, indent);
}

/**
 * Pure: строит тело ESM-модуля из map'ы `providersByProvider`.
 * Verifies провайдеры отсортированы (sorted keys на top-level).
 *
 * @param {Object<string, object>} providersByProvider
 * @returns {string}
 */
export function buildGeneratedModuleSource(providersByProvider) {
    /* Top-level: сортируем по providerId. */
    const sorted = {};
    for (const k of Object.keys(providersByProvider).sort()) {
        sorted[k] = providersByProvider[k];
    }
    const body = stableJsonStringify(sorted, 4);
    return `${HEADER}\nexport const BUNDLED_PROVIDER_PRICES = Object.freeze(${body});\n`;
}

/**
 * CLI entry point. Запускается, если файл вызван напрямую (`node ...`).
 * При import как библиотека (sync-test) — не запускается.
 */
function main() {
    const providers = readProvidersFromDir(PROVIDERS_DIR);
    const ids = Object.keys(providers);
    if (ids.length === 0) {
        console.error(`No <providerId>-latest.json files found in ${PROVIDERS_DIR}`);
        process.exit(1);
    }
    const source = buildGeneratedModuleSource(providers);
    writeFileSync(OUTPUT_PATH, source, 'utf8');
    console.log(`Wrote ${OUTPUT_PATH}`);
    console.log(`  providers: ${ids.sort().join(', ')}`);
    console.log(`  size:      ${source.length} chars`);
}

/* Detect direct CLI invocation. На Windows fs case-insensitive, normalize
 * via lowercase comparison — иначе `D:\...` vs `d:\...` могут не совпасть. */
const isMain = (() => {
    if (!process.argv[1]) return false;
    const scriptFs = fileURLToPath(import.meta.url).toLowerCase();
    const invokedFs = resolve(process.argv[1]).toLowerCase();
    return scriptFs === invokedFs;
})();

if (isMain) main();
