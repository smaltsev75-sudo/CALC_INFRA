/**
 * Provider freshness report for bundled cloud prices.
 *
 * Modes:
 *   node scripts/provider-freshness-report.mjs          -> print Markdown
 *   node scripts/provider-freshness-report.mjs --write  -> update PROVIDER_FRESHNESS_REPORT.md
 *   node scripts/provider-freshness-report.mjs --check  -> check the tracked report
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUNDLED_PROVIDER_PRICES } from '../js/data/providers-bundled.generated.js';
import { STALE_BUNDLE_THRESHOLD_MONTHS } from '../js/utils/constants.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT_DATE = '2026-05-22';
const REPORT_PATH = process.env.PROVIDER_FRESHNESS_REPORT_PATH
    ? resolve(process.env.PROVIDER_FRESHNESS_REPORT_PATH)
    : resolve(__dirname, '..', 'PROVIDER_FRESHNESS_REPORT.md');

function parseArgs(argv) {
    const result = {
        mode: '',
        asOf: process.env.PROVIDER_FRESHNESS_DATE || DEFAULT_REPORT_DATE
    };

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--write' || arg === '--check') {
            if (result.mode) throw new Error(`Only one mode is allowed; got ${result.mode} and ${arg}`);
            result.mode = arg;
        } else if (arg === '--as-of') {
            result.asOf = argv[++i] || '';
        } else if (arg.startsWith('--as-of=')) {
            result.asOf = arg.slice('--as-of='.length);
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }
    return result;
}

function parseIsoDate(value, label) {
    const time = Date.parse(value);
    if (!Number.isFinite(time)) throw new Error(`${label} is not a valid date: ${value}`);
    return new Date(time);
}

function daysBetween(from, to) {
    return (to.getTime() - from.getTime()) / 86_400_000;
}

function ageMonths(timestamp, asOf) {
    const collectedAt = parseIsoDate(timestamp, 'provider timestamp');
    const reportDate = parseIsoDate(`${asOf}T00:00:00.000Z`, 'report date');
    return Math.max(0, daysBetween(collectedAt, reportDate) / 30.4375);
}

function formatDate(value) {
    const date = parseIsoDate(value, 'date');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const yyyy = date.getUTCFullYear();
    return `${dd}.${mm}.${yyyy}`;
}

function formatAge(value) {
    if (value < 0.05) return '<0.1 мес';
    return `${value.toFixed(1)} мес`;
}

function classifyProvider(provider, asOf) {
    const version = provider.version || '';
    const timestamp = provider.timestamp || '';
    const confidence = provider.vatPolicy?.confidence || 'unknown';
    const flags = [];
    let age = Number.NaN;

    if (!timestamp) {
        flags.push('NO_TIMESTAMP');
    } else {
        age = ageMonths(timestamp, asOf);
        if (age > STALE_BUNDLE_THRESHOLD_MONTHS) flags.push('STALE');
    }
    if (/stub/i.test(version)) flags.push('STUB');
    if (confidence === 'assumed') flags.push('ASSUMED_VAT');
    if (confidence === 'unknown') flags.push('UNKNOWN_VAT');

    return {
        flags,
        ageMonths: age,
        status: flags.length === 0 ? 'OK' : flags.join(' + ')
    };
}

export function summarizeProviderFreshness(providers = BUNDLED_PROVIDER_PRICES, {
    asOf = DEFAULT_REPORT_DATE
} = {}) {
    parseIsoDate(`${asOf}T00:00:00.000Z`, 'report date');

    return Object.entries(providers)
        .sort(([a], [b]) => a.localeCompare(b, 'en'))
        .map(([providerId, provider]) => {
            const freshness = classifyProvider(provider, asOf);
            return {
                providerId,
                version: provider.version || '',
                timestamp: provider.timestamp || '',
                collectedDate: provider.timestamp ? formatDate(provider.timestamp) : '—',
                pricesCount: Object.keys(provider.prices || {}).length,
                vatConfidence: provider.vatPolicy?.confidence || 'unknown',
                ageMonths: freshness.ageMonths,
                ageText: Number.isFinite(freshness.ageMonths) ? formatAge(freshness.ageMonths) : '—',
                status: freshness.status
            };
        });
}

export function buildProviderFreshnessReport(providers = BUNDLED_PROVIDER_PRICES, {
    asOf = DEFAULT_REPORT_DATE
} = {}) {
    const rows = summarizeProviderFreshness(providers, { asOf });
    const attention = rows.filter(row => row.status !== 'OK');
    const lines = [];
    const print = (line = '') => lines.push(String(line));

    print('# Свежесть provider-прайсов');
    print('');
    print(`Дата отчёта: ${asOf}. Порог устаревания bundle: ${STALE_BUNDLE_THRESHOLD_MONTHS} мес.`);
    print('Источник: `data/providers/*-latest.json` → `npm run generate:providers` → `js/data/providers-bundled.generated.js`.');
    print('');
    print('| Провайдер | Версия | Дата сбора | Возраст | Позиций | VAT confidence | Статус |');
    print('|---|---|---:|---:|---:|---|---|');
    for (const row of rows) {
        print(`| ${row.providerId} | ${row.version || '—'} | ${row.collectedDate} | ${row.ageText} | ${row.pricesCount} | ${row.vatConfidence} | ${row.status} |`);
    }
    print('');
    print('## Интерпретация');
    print('');
    if (attention.length === 0) {
        print('Все bundled-прайсы находятся в пределах порога свежести, без stub/assumed-флагов.');
    } else {
        print(`Требуют внимания: ${attention.map(row => `${row.providerId} (${row.status})`).join(', ')}.`);
        print('`STALE` означает возраст старше порога, `STUB` — реалистичный stub вместо проверенного прайса, `ASSUMED_VAT` — НДС-политика принята по допущению.');
    }
    print('');
    print('## Maintainer flow');
    print('');
    print('1. Обновить `data/providers/<provider>-latest.json`: цены, `version`, `timestamp`, `priceSource`, VAT-поля.');
    print('2. Выполнить `npm run generate:providers` и `npm run prices:freshness`.');
    print('3. Проверить `npm run prices:freshness:check`, `npm run sanity:check`, `npm test`.');

    return lines.join('\n') + '\n';
}

const isCli = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
    try {
        const { mode, asOf } = parseArgs(process.argv.slice(2));
        const output = buildProviderFreshnessReport(BUNDLED_PROVIDER_PRICES, { asOf });

        if (mode === '--write') {
            writeFileSync(REPORT_PATH, output, 'utf8');
            console.log(`PROVIDER_FRESHNESS_REPORT.md updated (${output.split('\n').length - 1} lines)`);
        } else if (mode === '--check') {
            if (!existsSync(REPORT_PATH)) {
                console.warn('PROVIDER_FRESHNESS_REPORT.md отсутствует; проверка пропущена для урезанного архива.');
                process.exit(0);
            }
            const current = readFileSync(REPORT_PATH, 'utf8');
            if (current !== output) {
                console.error('PROVIDER_FRESHNESS_REPORT.md is stale. Run: npm run prices:freshness');
                process.exit(1);
            }
        } else {
            process.stdout.write(output);
        }
    } catch (err) {
        console.error(err.message);
        process.exit(1);
    }
}
