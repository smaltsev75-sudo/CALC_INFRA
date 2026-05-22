/**
 * Stage VAT-2 Phase 3 — Bundled provider JSON v2 shape acceptance.
 *
 * Проверяет, что все `data/providers/*-latest.json` соответствуют schema v2
 * после миграции `npm run migrate:providers` (или прямого запуска
 * `node scripts/migrate-providers-to-v2.js`):
 *   - schemaVersion = 2
 *   - top-level vatPolicy с правильным confidence per provider
 *   - каждый entry имеет pricePerUnitGross / pricePerUnitNet / vatRate
 *   - legacy pricePerUnit удалён
 *   - net + gross + vatRate согласованы (consistency check)
 *   - validateProviderPriceJson из Phase 1 принимает каждый JSON
 *   - нормализованный pricePerUnit == pricePerUnitNet
 *
 * Пункты 13 (sync-test) и 14 (double-VAT regression) — отдельные test files:
 *   tests/unit/architecture/providers-bundled-sync.test.js
 *   tests/integration/vat-double-regression.test.js
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLocalStorage } from '../../integration/storage-mock.js';
import {
    PROVIDER_PRICE_SCHEMA_VERSION,
    EPSILON_VAT_CONSISTENCY
} from '../../../js/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const PROVIDERS_DIR = join(REPO_ROOT, 'data', 'providers');

const PROVIDER_FILE_RE = /^([a-z0-9_-]+)-latest\.json$/;

const EXPECTED_CONFIDENCE = Object.freeze({
    sbercloud: 'verified',
    yandex: 'source-level',
    vk: 'assumed'
});

let svc;
let bundledProviders;

before(async () => {
    installLocalStorage();
    svc = await import('../../../js/services/providerPriceFetch.js');
    /* Загружаем все bundled JSONs один раз. */
    bundledProviders = {};
    for (const name of readdirSync(PROVIDERS_DIR).sort()) {
        const m = PROVIDER_FILE_RE.exec(name);
        if (!m) continue;
        const path = join(PROVIDERS_DIR, name);
        bundledProviders[m[1]] = JSON.parse(readFileSync(path, 'utf8'));
    }
});

describe('Phase 3.1: top-level schema v2', () => {
    it('каждый bundled JSON имеет schemaVersion = 2', () => {
        for (const [id, json] of Object.entries(bundledProviders)) {
            assert.equal(json.schemaVersion, PROVIDER_PRICE_SCHEMA_VERSION,
                `${id}: ожидалась schemaVersion=${PROVIDER_PRICE_SCHEMA_VERSION}, получено ${json.schemaVersion}`);
        }
    });

    it('каждый bundled JSON имеет top-level vatPolicy', () => {
        for (const [id, json] of Object.entries(bundledProviders)) {
            assert.equal(typeof json.vatPolicy, 'object',
                `${id}: top-level vatPolicy должен быть объектом`);
            assert.equal(json.vatPolicy.pricesIncludeVat, true,
                `${id}: vatPolicy.pricesIncludeVat должен быть true`);
            assert.equal(typeof json.vatPolicy.vatRateIncluded, 'number',
                `${id}: vatPolicy.vatRateIncluded должен быть числом`);
        }
    });
});

describe('Phase 3.2: confidence per provider', () => {
    for (const [providerId, expectedConfidence] of Object.entries(EXPECTED_CONFIDENCE)) {
        it(`${providerId}: confidence === '${expectedConfidence}'`, () => {
            const json = bundledProviders[providerId];
            assert.ok(json, `bundled JSON для ${providerId} не найден`);
            assert.equal(json.vatPolicy.confidence, expectedConfidence,
                `${providerId}: ожидался confidence='${expectedConfidence}', получено '${json.vatPolicy.confidence}'`);
        });
    }
});

describe('Phase 3.3: legacy pricePerUnit удалён из всех entries', () => {
    it('ни одна entry не содержит legacy pricePerUnit', () => {
        const offenders = [];
        for (const [providerId, json] of Object.entries(bundledProviders)) {
            for (const [entryId, entry] of Object.entries(json.prices)) {
                if ('pricePerUnit' in entry) {
                    offenders.push(`${providerId}.prices.${entryId}`);
                }
            }
        }
        assert.deepEqual(offenders, [],
            'Найдены entries с legacy pricePerUnit (должно быть удалено в v2):\n' +
            offenders.join('\n'));
    });
});

describe('Phase 3.4: каждая entry имеет gross / net / vatRate', () => {
    it('pricePerUnitGross — number > 0', () => {
        const offenders = [];
        for (const [providerId, json] of Object.entries(bundledProviders)) {
            for (const [entryId, entry] of Object.entries(json.prices)) {
                if (typeof entry.pricePerUnitGross !== 'number' || entry.pricePerUnitGross <= 0) {
                    offenders.push(`${providerId}.prices.${entryId}`);
                }
            }
        }
        assert.deepEqual(offenders, []);
    });

    it('pricePerUnitNet — number > 0', () => {
        const offenders = [];
        for (const [providerId, json] of Object.entries(bundledProviders)) {
            for (const [entryId, entry] of Object.entries(json.prices)) {
                if (typeof entry.pricePerUnitNet !== 'number' || entry.pricePerUnitNet <= 0) {
                    offenders.push(`${providerId}.prices.${entryId}`);
                }
            }
        }
        assert.deepEqual(offenders, []);
    });

    it('vatRate — number в [0, 1]', () => {
        const offenders = [];
        for (const [providerId, json] of Object.entries(bundledProviders)) {
            for (const [entryId, entry] of Object.entries(json.prices)) {
                if (typeof entry.vatRate !== 'number'
                    || entry.vatRate < 0 || entry.vatRate > 1) {
                    offenders.push(`${providerId}.prices.${entryId}`);
                }
            }
        }
        assert.deepEqual(offenders, []);
    });
});

describe('Phase 3.5: consistency check net/gross/vatRate', () => {
    it('abs(gross - net * (1 + vatRate)) <= EPSILON_VAT_CONSISTENCY для каждой entry', () => {
        const offenders = [];
        for (const [providerId, json] of Object.entries(bundledProviders)) {
            for (const [entryId, entry] of Object.entries(json.prices)) {
                const expected = entry.pricePerUnitNet * (1 + entry.vatRate);
                const diff = Math.abs(entry.pricePerUnitGross - expected);
                if (diff > EPSILON_VAT_CONSISTENCY) {
                    offenders.push(
                        `${providerId}.prices.${entryId}: ` +
                        `gross=${entry.pricePerUnitGross}, net=${entry.pricePerUnitNet}, ` +
                        `vatRate=${entry.vatRate}, diff=${diff.toFixed(6)} > ${EPSILON_VAT_CONSISTENCY}`
                    );
                }
            }
        }
        assert.deepEqual(offenders, [],
            'Найдены entries с inconsistent net/gross/vatRate:\n' + offenders.join('\n'));
    });
});

describe('Phase 3.6: validateProviderPriceJson принимает все bundled JSONs', () => {
    for (const providerId of Object.keys(EXPECTED_CONFIDENCE)) {
        it(`${providerId}: validator returns ok=true`, () => {
            const json = bundledProviders[providerId];
            const r = svc.validateProviderPriceJson(json, providerId);
            assert.equal(r.ok, true,
                `${providerId}: validator вернул ${JSON.stringify(r)}`);
        });
    }
});

describe('Phase 3.7: validator нормализует pricePerUnit = pricePerUnitNet', () => {
    for (const providerId of Object.keys(EXPECTED_CONFIDENCE)) {
        it(`${providerId}: каждый normalized entry имеет pricePerUnit === pricePerUnitNet`, () => {
            const json = bundledProviders[providerId];
            const r = svc.validateProviderPriceJson(json, providerId);
            assert.equal(r.ok, true);
            const offenders = [];
            for (const [entryId, entry] of Object.entries(r.data.prices)) {
                if (entry.pricePerUnit !== entry.pricePerUnitNet) {
                    offenders.push(
                        `${entryId}: pricePerUnit=${entry.pricePerUnit}, ` +
                        `pricePerUnitNet=${entry.pricePerUnitNet}`
                    );
                }
                if (entry.vatNormalized !== true) {
                    offenders.push(`${entryId}: vatNormalized !== true`);
                }
            }
            assert.deepEqual(offenders, [],
                `${providerId}: validator не нормализовал прайсы:\n` + offenders.join('\n'));
        });
    }
});

describe('Phase 3.8: sanity counts', () => {
    it('минимум 3 провайдера, минимум 10 entries у каждого', () => {
        const ids = Object.keys(bundledProviders);
        assert.ok(ids.length >= 3, `ожидалось >= 3 провайдеров, найдено ${ids.length}`);
        for (const id of ids) {
            const count = Object.keys(bundledProviders[id].prices).length;
            assert.ok(count >= 10, `${id}: ожидалось >= 10 entries, найдено ${count}`);
        }
    });
});
