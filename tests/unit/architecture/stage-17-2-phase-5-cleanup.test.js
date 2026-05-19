/**
 * Stage 17.2 Phase 5 — Service-layer deletion (bundled-fetch path).
 *
 * Защищает от регрессии после удаления orphan-export'ов в
 * `js/services/providerPriceFetch.js`:
 *   • providerLatestUrl
 *   • fetchProviderPriceJson
 *   • applyProviderPriceUpdate
 *   • rollbackProviderPriceUpdate (snapshot-based — paired с apply)
 *
 * Сохранены (live):
 *   • validateProviderPriceJson (используется providerController +
 *     priceImportMappingController + 3 тест-файла).
 *   • rollbackProviderPriceOverride (history-stack rollback,
 *     UI-кнопка «Откатить» в провайдер-блоке).
 *   • getPreviousProviderOverride (peek для UI).
 *
 * Удалены тесты:
 *   • tests/integration/provider-latest-end-to-end.test.js
 *   • tests/unit/services/provider-price-rollback.test.js
 * `provider-price-fetch.test.js` сохранён, переписан под validate-only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

/* ============================================================
 * 1. providerPriceFetch.js НЕ экспортирует bundled-fetch функции
 * ============================================================ */

describe('Phase 5 — providerPriceFetch.js: orphan exports удалены', () => {
    const src = stripJsComments(read('js/services/providerPriceFetch.js'));

    const REMOVED_EXPORTS = [
        'providerLatestUrl',
        'fetchProviderPriceJson',
        'applyProviderPriceUpdate',
        'rollbackProviderPriceUpdate'
    ];

    for (const name of REMOVED_EXPORTS) {
        it(`не экспортирует ${name}`, () => {
            assert.doesNotMatch(src, new RegExp(`export\\s+(?:async\\s+)?function\\s+${name}\\b`),
                `${name} удалён в Stage 17.2 Phase 5 — bundled-fetch path исчез вместе с UI кнопкой «Обновить с сервера».`);
        });
    }

    it('не содержит global fetch() (источник bundled-JSON убран)', () => {
        assert.doesNotMatch(src, /\bawait\s+fetch\s*\(/,
            'Сервис больше не делает HTTP-запросов; единственный путь обновления — file-picker через UI.');
    });
});

/* ============================================================
 * 2. providerPriceFetch.js СОДЕРЖИТ live-функции
 * ============================================================ */

describe('Phase 5 — providerPriceFetch.js: live exports сохранены', () => {
    const src = stripJsComments(read('js/services/providerPriceFetch.js'));

    it('экспортирует validateProviderPriceJson (используется controller + mapping)', () => {
        assert.match(src, /export\s+function\s+validateProviderPriceJson\b/);
    });

    it('экспортирует rollbackProviderPriceOverride (history-stack rollback)', () => {
        assert.match(src, /export\s+function\s+rollbackProviderPriceOverride\b/);
    });

    it('экспортирует getPreviousProviderOverride (peek для UI)', () => {
        assert.match(src, /export\s+function\s+getPreviousProviderOverride\b/);
    });
});

/* ============================================================
 * 3. Live callers удалённых функций отсутствуют в js/
 * ============================================================ */

describe('Phase 5 — нет live callers удалённых функций в js/', () => {
    const APP_FILES = [
        'js/app.js',
        'js/controllers/providerController.js',
        'js/controllers/priceImportMappingController.js',
        'js/controllers/calcController.js',
        'js/controllers/calcListController.js',
        'js/state/store.js',
        'js/state/persistence.js'
    ];

    const REMOVED = ['providerLatestUrl', 'fetchProviderPriceJson',
        'applyProviderPriceUpdate', 'rollbackProviderPriceUpdate'];

    for (const f of APP_FILES) {
        for (const name of REMOVED) {
            it(`${f} не содержит live ссылки на ${name}`, () => {
                const src = stripJsComments(read(f));
                assert.equal(src.includes(name), false,
                    `${f} ссылается на удалённую функцию ${name} (Phase 5).`);
            });
        }
    }
});

/* ============================================================
 * 4. Удалённые тест-файлы отсутствуют
 * ============================================================ */

describe('Phase 5 — obsolete test-файлы удалены', () => {
    const REMOVED_TESTS = [
        'tests/integration/provider-latest-end-to-end.test.js',
        'tests/unit/services/provider-price-rollback.test.js'
    ];

    for (const f of REMOVED_TESTS) {
        it(`файл удалён: ${f}`, () => {
            assert.equal(existsSync(join(ROOT, f)), false,
                `${f} тестировал удалённый bundled-fetch workflow — должен быть удалён.`);
        });
    }
});

/* ============================================================
 * 5. provider-price-fetch.test.js переписан под validate-only
 * ============================================================ */

describe('Phase 5 — provider-price-fetch.test.js (validate-only)', () => {
    const src = read('tests/unit/services/provider-price-fetch.test.js');

    it('файл существует (переписан, не удалён)', () => {
        assert.ok(src.length > 0);
    });

    it('тестирует validateProviderPriceJson', () => {
        assert.match(src, /validateProviderPriceJson/);
    });

    it('не тестирует fetchProviderPriceJson', () => {
        const stripped = stripJsComments(src);
        assert.doesNotMatch(stripped, /\bfetchProviderPriceJson\b/);
    });

    it('не тестирует applyProviderPriceUpdate / rollbackProviderPriceUpdate', () => {
        const stripped = stripJsComments(src);
        assert.doesNotMatch(stripped, /\bapplyProviderPriceUpdate\b/);
        assert.doesNotMatch(stripped, /\brollbackProviderPriceUpdate\b/);
    });

    it('не использует global.fetch mock (HTTP-моков больше нет)', () => {
        const stripped = stripJsComments(src);
        assert.doesNotMatch(stripped, /globalThis\.fetch\s*=/);
    });
});

/* ============================================================
 * 6. Live invariants — что НЕ удаляли (UserManual / MAINTAINER_GUIDE)
 * ============================================================ */

describe('Phase 5 — Live invariants', () => {
    it('data/providers/<id>-latest.json: 3 фикстуры остались (maintainer reference)', () => {
        for (const id of ['sbercloud', 'yandex', 'vk']) {
            assert.equal(existsSync(join(ROOT, `data/providers/${id}-latest.json`)), true,
                `data/providers/${id}-latest.json — maintainer-shipped reference price для ручного импорта.`);
        }
    });

    it('provider-price-fixtures.test.js остался (валидирует maintainer reference)', () => {
        assert.equal(existsSync(join(ROOT, 'tests/unit/services/provider-price-fixtures.test.js')), true);
    });

    it('Architecture.md описывает providerPriceFetch.js актуально (validate, не fetch+apply)', () => {
        const arch = read('Architecture.md');
        assert.doesNotMatch(arch, /providerPriceFetch\.js\s*#\s*fetch\s*\+\s*validate\s*\+\s*apply/,
            'Architecture.md не должна описывать providerPriceFetch как fetch+validate+apply (Phase 5 cleanup).');
        assert.match(arch, /providerPriceFetch\.js\s*#\s*validate/,
            'Architecture.md должна актуально описывать providerPriceFetch как validate-сервис.');
    });

    it('UserManual.md не упоминает «Обновить с сервера»', () => {
        const um = read('UserManual.md');
        assert.equal(um.includes('Обновить с сервера'), false);
    });
});
