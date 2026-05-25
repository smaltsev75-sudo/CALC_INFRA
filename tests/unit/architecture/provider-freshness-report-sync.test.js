/**
 * PROVIDER_FRESHNESS_REPORT.md is a checked maintainer artifact.
 *
 * If bundled provider prices, timestamps, VAT assumptions or thresholds change,
 * update the report in the same patch via `npm run prices:freshness`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    buildProviderFreshnessReport,
    CORE_PROVIDER_SKU_IDS,
    summarizeProviderConfidence,
    summarizeProviderFreshness,
    summarizeProviderQuality
} from '../../../scripts/provider-freshness-report.mjs';

const REPORT_PATH = join('docs', 'assistant', 'PROVIDER_FRESHNESS_REPORT.md');

test('provider freshness summary marks fresh, stale, stub and assumed VAT states', () => {
    const providers = {
        fresh: {
            version: '2026-Q3',
            timestamp: '2026-05-01T00:00:00.000Z',
            vatPolicy: { confidence: 'verified' },
            prices: { cpu: { pricePerUnitNet: 1 } }
        },
        legacy: {
            version: '2025-Q1-stub',
            timestamp: '2025-01-01T00:00:00.000Z',
            vatPolicy: { confidence: 'assumed' },
            prices: {}
        }
    };

    const rows = summarizeProviderFreshness(providers, { asOf: '2026-05-22' });
    const fresh = rows.find(row => row.providerId === 'fresh');
    const legacy = rows.find(row => row.providerId === 'legacy');

    assert.equal(fresh.status, 'OK');
    assert.match(legacy.status, /STALE/);
    assert.match(legacy.status, /STUB/);
    assert.match(legacy.status, /ASSUMED_VAT/);
});

test('provider freshness report contains deterministic maintainer flow', () => {
    const report = buildProviderFreshnessReport({
        demo: {
            version: '2026-Q3',
            timestamp: '2026-05-09T19:30:00.000Z',
            vatPolicy: { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'source-level' },
            prices: { cpu: {}, ram: {} }
        }
    }, { asOf: '2026-05-22' });

    assert.match(report, /^# Свежесть provider-прайсов/m);
    assert.match(report, /Дата отчёта: 2026-05-22/);
    assert.match(report, /\| demo \| 2026-Q3 \| 09\.05\.2026 \| 0\.4 мес \| 2 \| source-level \| OK \|/);
    assert.match(report, /## Quality gates/);
    assert.match(report, /\| demo \| 0\/8 \| gross→net OK \| 2 \| 2 \| MISSING_CORE \+ BAD_PRICE \+ MISSING_SOURCE \|/);
    assert.match(report, /## Confidence summary/);
    assert.match(report, /\| 1 \| 1 \| 0 \| 0 \| 0 \| demo \|/);
    assert.match(report, /MISSING_CORE.*ручного override по отсутствующим SKU/);
    assert.match(report, /npm run generate:providers/);
    assert.match(report, /npm run prices:freshness:check/);
});

test('provider confidence summary counts trusted, assumed, unknown and stub providers', () => {
    const validCorePrices = Object.fromEntries(CORE_PROVIDER_SKU_IDS.map(id => [id, {
        pricePerUnitGross: 122,
        pricePerUnitNet: 100,
        vendor: 'Vendor',
        priceSource: 'vendor/source'
    }]));
    const rows = summarizeProviderConfidence({
        verified: {
            version: '2026-Q3',
            timestamp: '2026-05-01T00:00:00.000Z',
            vatPolicy: { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'verified' },
            prices: validCorePrices
        },
        assumedStub: {
            version: '2026-Q3-stub',
            timestamp: '2026-05-01T00:00:00.000Z',
            vatPolicy: { pricesIncludeVat: true, vatRateIncluded: 0.22, confidence: 'assumed' },
            prices: validCorePrices
        },
        unknown: {
            version: '2026-Q3',
            timestamp: '2026-05-01T00:00:00.000Z',
            vatPolicy: { pricesIncludeVat: true, vatRateIncluded: 0.22 },
            prices: validCorePrices
        }
    }, { asOf: '2026-05-22' });

    assert.equal(rows.totalProviders, 3);
    assert.deepEqual(rows.trustedVatProviderIds, ['verified']);
    assert.deepEqual(rows.assumedVatProviderIds, ['assumedStub']);
    assert.deepEqual(rows.unknownVatProviderIds, ['unknown']);
    assert.deepEqual(rows.stubProviderIds, ['assumedStub']);
    assert.deepEqual(rows.attentionProviderIds, ['assumedStub', 'unknown']);
});

test('provider quality summary separates core coverage, VAT policy, prices and sources', () => {
    const validCorePrices = Object.fromEntries(CORE_PROVIDER_SKU_IDS.map(id => [id, {
        pricePerUnitGross: 122,
        pricePerUnitNet: 100,
        vendor: 'Vendor',
        priceSource: 'vendor/source'
    }]));
    const rows = summarizeProviderQuality({
        good: {
            vatPolicy: { pricesIncludeVat: true, vatRateIncluded: 0.22 },
            prices: validCorePrices
        },
        bad: {
            vatPolicy: { confidence: 'assumed' },
            prices: {
                'cpu-vcpu-shared': { pricePerUnitGross: 0, pricePerUnitNet: 1, vendor: '', priceSource: '' }
            }
        }
    });

    const good = rows.find(row => row.providerId === 'good');
    const bad = rows.find(row => row.providerId === 'bad');

    assert.equal(good.status, 'OK');
    assert.equal(good.coreCoverage, '8/8');
    assert.equal(bad.coreCoverage, '1/8');
    assert.deepEqual(bad.missingCoreIds, CORE_PROVIDER_SKU_IDS.filter(id => id !== 'cpu-vcpu-shared'));
    assert.match(bad.status, /MISSING_CORE/);
    assert.match(bad.status, /BAD_VAT_POLICY/);
    assert.match(bad.status, /BAD_PRICE/);
    assert.match(bad.status, /MISSING_SOURCE/);
});

test('PROVIDER_FRESHNESS_REPORT.md синхронизирован с bundled provider prices', (t) => {
    if (!existsSync(REPORT_PATH)) {
        t.skip(`${REPORT_PATH} — maintainer-only документ и отсутствует в clean checkout.`);
        return;
    }

    assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['scripts/provider-freshness-report.mjs', '--check'], {
            cwd: process.cwd(),
            stdio: 'pipe'
        });
    }, `${REPORT_PATH} устарел; обновите его командой \`npm run prices:freshness\`.`);
});

test('provider freshness --check мягко пропускает отсутствующий maintainer-only отчёт', () => {
    const dir = mkdtempSync(join(tmpdir(), 'provider-freshness-'));
    const missingReportPath = join(dir, 'PROVIDER_FRESHNESS_REPORT.md');
    try {
        assert.doesNotThrow(() => {
            execFileSync(process.execPath, ['scripts/provider-freshness-report.mjs', '--check'], {
                cwd: process.cwd(),
                env: { ...process.env, PROVIDER_FRESHNESS_REPORT_PATH: missingReportPath },
                stdio: 'pipe'
            });
        }, 'prices:freshness:check не должен падать в clean checkout без maintainer-only отчёта.');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
