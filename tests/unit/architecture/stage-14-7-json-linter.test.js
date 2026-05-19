/**
 * Stage 14.7 (PATCH 2.7.5) — Linter for `data/providers/*.json` bundle files.
 *
 * Существующий `validateProviderPriceJson` ([providerPriceFetch.js:50](js/services/providerPriceFetch.js#L50))
 * проверяет схему/типы/обязательные поля, НО не проверяет, что ключи в
 * `prices.<id>` соответствуют реально существующим ЭК в [seed.js:2679](js/domain/seed.js#L2679)
 * (`SEED_ITEMS`). Опечатка в id (`cpu-vcpu-shared-typo`) пройдёт validate
 * без ошибок и просто будет проигнорирована при applyOverrideToItems.
 *
 * Этот линтер закрывает пробел двумя слоями:
 *   (a) каждый bundled JSON проходит validateProviderPriceJson;
 *   (b) каждый ключ prices.<id> в bundled JSON ⊆ SEED_ITEMS.id.
 *
 * Plus 3 edge-case теста на validate (поведение «отвергнуть, не применить»):
 *   - пустой prices → reason='empty-prices';
 *   - prices.<id>.pricePerUnit отсутствует → reason='invalid-price';
 *   - неизвестное поле верхнего уровня → reason='unknown-fields'.
 *
 * Линтер запускается на каждом npm test и автоматически охватывает новые
 * файлы в data/providers/ (без ручного добавления в массив).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let SEED_ITEMS;
let validateProviderPriceJson;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const PROVIDERS_DIR = path.join(ROOT, 'data', 'providers');

/* Внешний аудит #18 (PATCH 2.19.5, P1, выбор 1A): graceful skip когда
 * data/providers/ отсутствует (maintainer-only fixture). */
const SKIP_REASON = !fs.existsSync(PROVIDERS_DIR)
    ? 'maintainer-only: data/providers/ отсутствует в clean clone'
    : false;

function listProviderJsons() {
    /* Берём только production bundle'ы `<id>-latest.json` — maintainer-shipped
       reference prices, которые пользователь может вручную загрузить через
       «Импорт прайса JSON» в Опроснике. Поддиректории (`drafts/`, `archive/`,
       тестовые fixtures) НЕ трогаем — они могут содержать work-in-progress
       JSON с другими providerId / structurой. */
    if (SKIP_REASON) return [];
    return fs.readdirSync(PROVIDERS_DIR, { withFileTypes: true })
        .filter(e => e.isFile() && /-latest\.json$/.test(e.name))
        .map(e => ({
            file: e.name,
            providerId: e.name.replace(/-latest\.json$/, ''),
            content: JSON.parse(fs.readFileSync(path.join(PROVIDERS_DIR, e.name), 'utf8'))
        }));
}

before(async () => {
    ({ SEED_ITEMS } = await import('../../../js/domain/seed.js'));
    ({ validateProviderPriceJson } = await import('../../../js/services/providerPriceFetch.js'));
});

describe('Stage 14.7 / bundled JSON: structural validate', { skip: SKIP_REASON }, () => {
    const bundles = listProviderJsons();

    it('папка data/providers/ содержит хотя бы один bundle (sanity)', () => {
        assert.ok(bundles.length >= 1, 'нет JSON-файлов в data/providers/');
    });

    for (const { file, providerId, content } of bundles) {
        it(`${file} проходит validateProviderPriceJson(providerId="${providerId}")`, () => {
            const result = validateProviderPriceJson(content, providerId);
            assert.equal(result.ok, true,
                `${file} не прошёл validate: reason=${result.reason}, message=${result.message}`);
        });
    }
});

describe('Stage 14.7 / bundled JSON: prices.<id> ⊆ SEED_ITEMS', { skip: SKIP_REASON }, () => {
    const bundles = listProviderJsons();

    for (const { file, content } of bundles) {
        it(`${file}: все ключи prices.<id> существуют как item.id в seed.js`, () => {
            const seedIds = new Set(SEED_ITEMS.map(it => it.id));
            const priceIds = Object.keys(content.prices || {});
            const orphans = priceIds.filter(id => !seedIds.has(id));
            assert.deepEqual(orphans, [],
                `Найдены id в ${file}, которых нет в SEED_ITEMS: ${orphans.join(', ')}. ` +
                'Опечатка или ЭК был удалён/переименован — bundle нужно обновить.');
        });
    }
});

describe('Stage 14.7 / validateProviderPriceJson — edge cases (reject path)', () => {
    const validBase = Object.freeze({
        schemaVersion: 1,
        providerId: 'sbercloud',
        version: '2026-Q4-edge',
        timestamp: '2026-05-09T12:00:00.000Z',
        source: 'edge-test',
        prices: {
            'cpu-vcpu-shared': { pricePerUnit: 100, vendor: 'sber', priceSource: 'sber/edge' }
        }
    });

    it('пустой prices → reason="empty-prices", JSON не применяется', () => {
        const json = { ...validBase, prices: {} };
        const result = validateProviderPriceJson(json, 'sbercloud');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'empty-prices');
    });

    it('отсутствие pricePerUnit → reason="invalid-price"', () => {
        const json = {
            ...validBase,
            prices: {
                'cpu-vcpu-shared': { vendor: 'sber', priceSource: 'sber/edge' }
            }
        };
        const result = validateProviderPriceJson(json, 'sbercloud');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid-price');
    });

    it('pricePerUnit ≤ 0 → reason="invalid-price" (защита от bug-fixture с нулём)', () => {
        const json = {
            ...validBase,
            prices: {
                'cpu-vcpu-shared': { pricePerUnit: 0, vendor: 'sber', priceSource: 'sber/edge' }
            }
        };
        const result = validateProviderPriceJson(json, 'sbercloud');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'invalid-price');
    });

    it('неизвестное поле верхнего уровня → reason="unknown-fields"', () => {
        const json = { ...validBase, extraField: 'oops' };
        const result = validateProviderPriceJson(json, 'sbercloud');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'unknown-fields');
    });

    it('mismatched providerId → reason="provider-mismatch" (bundle для sber, ожидается yandex)', () => {
        const json = { ...validBase, providerId: 'sbercloud' };
        const result = validateProviderPriceJson(json, 'yandex');
        assert.equal(result.ok, false);
        assert.equal(result.reason, 'provider-mismatch');
    });
});
