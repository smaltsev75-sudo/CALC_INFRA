/**
 * Stage VAT-2 Phase 2: bundled providers sync linter.
 *
 * Архитектурный инвариант: содержимое `js/data/providers-bundled.generated.js`
 * ВСЕГДА должно соответствовать актуальной свёртке `data/providers/*-latest.json`.
 *
 * Без этого теста maintainer мог бы отредактировать `sbercloud-latest.json`,
 * закоммитить, и приложение бы продолжало работать на устаревшем generated
 * module до следующего ручного запуска `npm run generate:providers`. Тест
 * фейлит CI при любом расхождении.
 *
 * Логика in-memory регенерации переиспользует функции из самого генератора
 * ([scripts/generate-providers-bundled.js](scripts/generate-providers-bundled.js))
 * — никакой дубликации сериализации.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    readProvidersFromDir,
    buildGeneratedModuleSource
} from '../../../scripts/generate-providers-bundled.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PROVIDERS_DIR = join(REPO_ROOT, 'data', 'providers');
const OUTPUT_PATH = join(REPO_ROOT, 'js', 'data', 'providers-bundled.generated.js');

/* Нормализация CRLF→LF: git на Windows может конвертировать line endings
 * при checkout (autocrlf=true). Файл может быть закоммичен с LF, но прочитан
 * с CRLF. Сравнение тогда фейлит на пустых местах. Нормализуем оба. */
function normalizeLineEndings(s) {
    return s.replace(/\r\n/g, '\n');
}

describe('Stage VAT-2 Phase 2: bundled providers sync', () => {
    it('generated.js синхронен с data/providers/*-latest.json', () => {
        const providers = readProvidersFromDir(PROVIDERS_DIR);
        const expectedSource = buildGeneratedModuleSource(providers);
        const actualSource = readFileSync(OUTPUT_PATH, 'utf8');
        assert.equal(
            normalizeLineEndings(actualSource),
            normalizeLineEndings(expectedSource),
            'js/data/providers-bundled.generated.js рассинхронизирован с ' +
            'data/providers/*-latest.json. Запустите:\n\n' +
            '    npm run generate:providers\n\n' +
            'И закоммитьте обновлённый generated.js вместе с правкой JSON.'
        );
    });

    it('generated.js содержит всех bundled провайдеров (sbercloud / vk / yandex)', () => {
        const src = readFileSync(OUTPUT_PATH, 'utf8');
        for (const id of ['sbercloud', 'vk', 'yandex']) {
            assert.match(src, new RegExp(`"${id}"\\s*:`),
                `generated module должен содержать провайдера "${id}"`);
        }
    });

    it('generated.js — pure ES module без runtime fetch / DOM / globals', () => {
        const src = readFileSync(OUTPUT_PATH, 'utf8');
        /* Generated module — чистые данные. Никаких сетевых вызовов, никаких
         * browser APIs. Защита от случайной правки руками вопреки header'у. */
        const forbidden = [
            /\bfetch\s*\(/,
            /\bXMLHttpRequest\b/,
            /\bwindow\b/,
            /\bdocument\b/,
            /\blocalStorage\b/,
            /\bnavigator\b/,
            /\beval\s*\(/,
            /\bnew\s+Function\s*\(/,
            /\bsetTimeout\s*\(/
        ];
        for (const re of forbidden) {
            assert.doesNotMatch(src, re,
                `generated module не должен использовать ${re.source}`);
        }
    });

    it('generated.js помечен заголовком "AUTO-GENERATED"', () => {
        const src = readFileSync(OUTPUT_PATH, 'utf8');
        assert.match(src, /AUTO-GENERATED FILE\. DO NOT EDIT BY HAND\./);
        assert.match(src, /npm run generate:providers/);
    });

    it('идемпотентность: повторная регенерация → нулевой diff', () => {
        const providers1 = readProvidersFromDir(PROVIDERS_DIR);
        const src1 = buildGeneratedModuleSource(providers1);
        const providers2 = readProvidersFromDir(PROVIDERS_DIR);
        const src2 = buildGeneratedModuleSource(providers2);
        assert.equal(src1, src2,
            'Генератор не детерминирован — повторный запуск даёт разный output.');
    });

    it('экспортирует Object.freeze({ ... }) — не голый литерал', () => {
        const src = readFileSync(OUTPUT_PATH, 'utf8');
        assert.match(src,
            /export\s+const\s+BUNDLED_PROVIDER_PRICES\s*=\s*Object\.freeze\s*\(/);
    });
});
