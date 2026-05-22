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
    summarizeProviderFreshness
} from '../../../scripts/provider-freshness-report.mjs';

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
        yandex: {
            version: '2026-Q3',
            timestamp: '2026-05-09T19:30:00.000Z',
            vatPolicy: { confidence: 'source-level' },
            prices: { cpu: {}, ram: {} }
        }
    }, { asOf: '2026-05-22' });

    assert.match(report, /^# Свежесть provider-прайсов/m);
    assert.match(report, /Дата отчёта: 2026-05-22/);
    assert.match(report, /\| yandex \| 2026-Q3 \| 09\.05\.2026 \| 0\.4 мес \| 2 \| source-level \| OK \|/);
    assert.match(report, /npm run generate:providers/);
    assert.match(report, /npm run prices:freshness:check/);
});

test('PROVIDER_FRESHNESS_REPORT.md синхронизирован с bundled provider prices', (t) => {
    if (!existsSync('PROVIDER_FRESHNESS_REPORT.md')) {
        t.skip('PROVIDER_FRESHNESS_REPORT.md — maintainer-only документ и отсутствует в clean checkout.');
        return;
    }

    assert.doesNotThrow(() => {
        execFileSync(process.execPath, ['scripts/provider-freshness-report.mjs', '--check'], {
            cwd: process.cwd(),
            stdio: 'pipe'
        });
    }, 'PROVIDER_FRESHNESS_REPORT.md устарел; обновите его командой `npm run prices:freshness`.');
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
