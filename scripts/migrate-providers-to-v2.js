/**
 * Stage VAT-2 Phase 3 — One-shot migration `data/providers/*-latest.json`
 * из schema v1 в v2.
 *
 * Запуск:
 *   node scripts/migrate-providers-to-v2.js
 *
 * Idempotent: уже-v2 файлы пропускает. Безопасно перезапускать после
 * добавления нового v1-файла в data/providers/.
 *
 * Алгоритм для каждой entry:
 *   pricePerUnitGross = old pricePerUnit
 *   pricePerUnitNet   = roundKopek(gross / (1 + vatRate))
 *   vatRate           = ставка из VAT_RATE_HISTORY на дату json.timestamp
 *                       (источник правды — VAT-1 справочник, не магический литерал)
 *   pricePerUnit      → удалить
 *
 * Top-level:
 *   schemaVersion = 2
 *   vatPolicy     = { pricesIncludeVat: true, vatRateIncluded: <rate>,
 *                     confidence: <per provider> }
 *
 * Confidence по providers (зафиксировано в Stage VAT-2 plan, решение Q5):
 *   sbercloud → verified     (Cloud.ru договорные приложения 2026-03-16)
 *   yandex    → source-level (публичные тарифы yandex.cloud/pricing)
 *   vk        → assumed      (realistic-stub, не верифицирован)
 *
 * Order top-level keys в output: schemaVersion → providerId → version →
 * timestamp → source → vatPolicy → prices. Order keys внутри entry:
 * pricePerUnitGross → pricePerUnitNet → vatRate → остальные meta.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVatRateForDate } from '../js/domain/vatRateTable.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PROVIDERS_DIR = join(REPO_ROOT, 'data', 'providers');

const PROVIDER_FILE_RE = /^([a-z0-9_-]+)-latest\.json$/;

const PROVIDER_CONFIDENCE = Object.freeze({
    sbercloud: 'verified',
    yandex: 'source-level',
    vk: 'assumed'
});

/** Округление до копейки — единая точность money в проекте.
 *  Та же логика, что в `_roundKopek` в providerPriceFetch.js. */
function roundKopek(value) {
    return Number(value.toFixed(2));
}

/** Извлечь VAT-ставку для bundled JSON из его timestamp.
 *  Source of truth — VAT_RATE_HISTORY (Stage VAT-1), а не литерал. */
function detectVatRate(json) {
    const ts = json.timestamp || '';
    const isoDate = ts.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
        throw new Error(`Невалидный timestamp в ${json.providerId}: ${json.timestamp}`);
    }
    return getVatRateForDate(isoDate);
}

function convertEntry(entry, vatRate) {
    if (typeof entry.pricePerUnit !== 'number') {
        throw new Error(`entry без pricePerUnit: ${JSON.stringify(entry).slice(0, 80)}`);
    }
    const gross = entry.pricePerUnit;
    const net = roundKopek(gross / (1 + vatRate));
    /* Build с явным ordering: новые VAT-поля впереди, meta далее. */
    const out = {
        pricePerUnitGross: gross,
        pricePerUnitNet: net,
        vatRate
    };
    for (const [k, v] of Object.entries(entry)) {
        if (k === 'pricePerUnit') continue;
        if (k === 'pricePerUnitGross' || k === 'pricePerUnitNet' || k === 'vatRate') continue;
        out[k] = v;
    }
    return out;
}

function convertProvider(json, providerId) {
    const confidence = PROVIDER_CONFIDENCE[providerId];
    if (!confidence) {
        throw new Error(`Unknown provider id "${providerId}" — добавьте в PROVIDER_CONFIDENCE.`);
    }
    const vatRate = detectVatRate(json);

    const newPrices = {};
    for (const [id, entry] of Object.entries(json.prices)) {
        try {
            newPrices[id] = convertEntry(entry, vatRate);
        } catch (e) {
            throw new Error(`${providerId}.prices.${id}: ${e.message}`);
        }
    }

    /* Top-level — фиксированный order. */
    return {
        schemaVersion: 2,
        providerId: json.providerId,
        version: json.version,
        timestamp: json.timestamp,
        source: json.source,
        vatPolicy: {
            pricesIncludeVat: true,
            vatRateIncluded: vatRate,
            confidence
        },
        prices: newPrices
    };
}

function main() {
    const entries = readdirSync(PROVIDERS_DIR);
    const stats = { converted: 0, skipped: 0, entriesTotal: 0 };
    for (const name of entries.sort()) {
        const m = PROVIDER_FILE_RE.exec(name);
        if (!m) continue;
        const providerId = m[1];
        const path = join(PROVIDERS_DIR, name);
        const raw = readFileSync(path, 'utf8');
        const json = JSON.parse(raw);
        if (json.schemaVersion === 2) {
            console.log(`SKIP ${name}: already v2`);
            stats.skipped += 1;
            continue;
        }
        if (json.schemaVersion !== 1) {
            throw new Error(`${name}: unexpected schemaVersion=${json.schemaVersion}`);
        }
        const converted = convertProvider(json, providerId);
        const text = JSON.stringify(converted, null, 4) + '\n';
        writeFileSync(path, text, 'utf8');
        const count = Object.keys(converted.prices).length;
        stats.converted += 1;
        stats.entriesTotal += count;
        console.log(`✓ ${name}: ${count} entries → v2 (confidence: ${PROVIDER_CONFIDENCE[providerId]})`);
    }
    console.log('');
    console.log(`Файлов конвертировано: ${stats.converted}`);
    console.log(`Файлов пропущено (уже v2): ${stats.skipped}`);
    console.log(`Entries обработано: ${stats.entriesTotal}`);
    if (stats.converted > 0) {
        console.log('');
        console.log('Следующий шаг: npm run generate:providers');
    }
}

main();
