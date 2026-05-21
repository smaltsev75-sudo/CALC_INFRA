/**
 * Sanity-check report: прогон калькулятора на 3 типовых профилях.
 *
 * Режимы:
 *   node scripts/sanity-report.mjs          -> вывести Markdown в stdout
 *   node scripts/sanity-report.mjs --write  -> обновить SANITY_REPORT.md
 *   node scripts/sanity-report.mjs --check  -> проверить, что SANITY_REPORT.md свежий
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as seed from '../js/domain/seed.js';
import { calculate, clearCalculationCache } from '../js/domain/calculator.js';
import { getVatRateForDate } from '../js/domain/vatRateTable.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_PATH = resolve(__dirname, '..', 'SANITY_REPORT.md');

const REPORT_DATE = '2026-05-21';
const CALC_CREATED_AT = '2026-05-02T00:00:00Z';
const VAT_RATE_2026 = getVatRateForDate('2026-01-01');

const profiles = {
    'Startup MVP (5k registered, 500 DAU)': {
        users_total: 5000, registered_users_total: 5000, dau_target: 500, pcu_target: 50,
        peak_rps: 20, avg_rps: 5, microservices_count: 3, async_workers_count: 1,
        db_count: 1, db_replicas_count: 0, db_size_initial_gb: 20, db_growth_gb_month: 2,
        backup_retention_days: 14, file_storage_volume_tb: 0.1, file_storage_growth_tb_year: 0.1,
        email_per_month: 5000, sms_per_month: 500, push_per_month: 100000,
        avg_response_size_kb: 5, avg_request_size_kb: 2, ram_per_vcpu_ratio: 4, cache_size_gb: 4,
        sla_target: 99.5, georedundancy_required: false, pdn_152fz: false,
        pentest_external: true, pentest_internal: false, load_test_before_prod: true,
        pentest_per_year: 1, load_test_per_year: 1
    },
    'SMB B2B SaaS (50k registered, 10k DAU)': {
        users_total: 50000, registered_users_total: 50000, dau_target: 10000, pcu_target: 1000,
        peak_rps: 200, avg_rps: 50, microservices_count: 10, async_workers_count: 4,
        db_count: 3, db_replicas_count: 1, db_size_initial_gb: 100, db_growth_gb_month: 10,
        backup_retention_days: 30, file_storage_volume_tb: 1, file_storage_growth_tb_year: 1,
        email_per_month: 50000, sms_per_month: 5000, push_per_month: 1000000,
        avg_response_size_kb: 5, avg_request_size_kb: 2, ram_per_vcpu_ratio: 4, cache_size_gb: 16,
        sla_target: 99.9, georedundancy_required: false, pdn_152fz: true, encryption_at_rest: true,
        waf_required: true, pentest_external: true, pentest_internal: true, load_test_before_prod: true,
        pentest_per_year: 2, load_test_per_year: 2
    },
    'Enterprise (500k registered, 100k DAU)': {
        users_total: 500000, registered_users_total: 500000, dau_target: 100000, pcu_target: 10000,
        peak_rps: 1000, avg_rps: 200, microservices_count: 30, async_workers_count: 12,
        db_count: 5, db_replicas_count: 2, db_size_initial_gb: 1000, db_growth_gb_month: 100,
        backup_retention_days: 90, file_storage_volume_tb: 50, file_storage_growth_tb_year: 30,
        email_per_month: 1000000, sms_per_month: 100000, push_per_month: 50000000,
        avg_response_size_kb: 10, avg_request_size_kb: 4, ram_per_vcpu_ratio: 4, cache_size_gb: 128,
        sla_target: 99.95, georedundancy_required: true, pdn_152fz: true, encryption_at_rest: true,
        waf_required: true, fstec_certification_required: true, pentest_external: true, pentest_internal: true,
        load_test_before_prod: true, pentest_per_year: 4, load_test_per_year: 4
    }
};

const fmtRub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';
const fmtMln = n => (n / 1e6).toFixed(2) + ' млн ₽';

const lines = [];
const print = (line = '') => lines.push(String(line));

function buildCalc(answersOverrides) {
    const dict = seed.buildSeedDictionaries();
    const ans = seed.defaultAnswersFrom(dict.questions);
    Object.assign(ans, answersOverrides);
    return {
        version: '1.0',
        id: 'sanity',
        name: 'sanity',
        schemaVersion: 2,
        createdAt: CALC_CREATED_AT,
        updatedAt: CALC_CREATED_AT,
        settings: { ...seed.SEED_SETTINGS },
        answers: ans,
        dictionaries: dict
    };
}

print('# Sanity-check калькулятора инфраструктуры');
print(`Дата отчёта: ${REPORT_DATE}. Дата расчёта в профилях: ${CALC_CREATED_AT.slice(0, 10)}. Прайсы: Cloud.ru / GigaChat / ТЗ ИИ-агент Smart §14 / медианы рынка.\n`);

for (const [name, ans] of Object.entries(profiles)) {
    print('## ' + name);
    clearCalculationCache();
    const c = buildCalc(ans);
    const r = calculate(c);

    print(`\nИТОГО: **${fmtMln(r.totalMonthly)}/мес = ${fmtMln(r.totalAnnual)}/год**\n`);
    print('| Стенд | ₽/мес | % от итого |');
    print('|---|---:|---:|');
    for (const sid of ['DEV', 'IFT', 'PSI', 'PROD', 'LOAD']) {
        const v = r.stands[sid].totalMonthly;
        const pct = r.totalMonthly > 0 ? (v / r.totalMonthly * 100).toFixed(1) : '0';
        print(`| ${sid} | ${fmtRub(v)} | ${pct}% |`);
    }

    print('\n**Топ-5 ЭК по стоимости (PROD):**\n');
    const items = Object.entries(r.items)
        .map(([id, v]) => ({ id, name: c.dictionaries.items.find(i => i.id === id)?.name, prod: v.stands.PROD.costFinal || 0 }))
        .filter(x => x.prod > 0)
        .sort((a, b) => b.prod - a.prod)
        .slice(0, 5);
    print('| ЭК | ₽/мес (PROD) |');
    print('|---|---:|');
    for (const x of items) print(`| ${x.name} | ${fmtRub(x.prod)} |`);

    print('\n**По категориям (₽/мес, всего по всем стендам):**\n');
    print('| Категория | ₽/мес |');
    print('|---|---:|');
    for (const [cat, v] of Object.entries(r.byCategory)) {
        if (v > 0) print(`| ${cat} | ${fmtRub(v)} |`);
    }
    print('\n---\n');
}

print('## Чувствительность к риск-коэффициентам (SMB-профиль)\n');
print('Базовый сценарий — **«нейтральный»**: все коэффициенты = 0, НДС выключен.');
print('Каждый следующий сценарий добавляет ОДИН коэффициент к нейтральному, чтобы видеть его изолированный эффект.\n');
const smbAns = profiles['SMB B2B SaaS (50k registered, 10k DAU)'];

const NEUTRAL = {
    period: 'monthly',
    bufferTask: 0,
    bufferProject: 0,
    kInflation: 0,
    kSeasonal: 0,
    kScheduleShift: 0,
    kContingency: 0,
    vatEnabled: false,
    vatRate: 0,
    planningHorizonYears: 1,
    daysPerMonth: 30,
    phaseDurationMonths: 12,
    standSizeRatio: { ...seed.SEED_SETTINGS.standSizeRatio }
};

const scenarios = [
    { name: 'Нейтральный (база сравнения)', settings: { ...NEUTRAL } },
    { name: '+ Буферы (задача 30% × проект 15%) → ×1.495', settings: { ...NEUTRAL, bufferTask: 0.30, bufferProject: 0.15 } },
    { name: '+ Инфляция 10%/год × 1 год → ×1.10', settings: { ...NEUTRAL, kInflation: 0.10, planningHorizonYears: 1 } },
    { name: '+ Инфляция 10%/год × 3 года → ×1.331', settings: { ...NEUTRAL, kInflation: 0.10, planningHorizonYears: 3 } },
    { name: '+ Сезонный пик +20% (только NETWORK/TRAFFIC/SERVICE/AI_LLM)', settings: { ...NEUTRAL, kSeasonal: 0.20 } },
    { name: '+ Сдвиг сроков +15% (только LOAD и oneTime)', settings: { ...NEUTRAL, kScheduleShift: 0.15 } },
    { name: '+ Непредвиденные 5% (на все ЭК)', settings: { ...NEUTRAL, kContingency: 0.05 } },
    { name: '+ НДС 22% (на всё)', settings: { ...NEUTRAL, vatEnabled: true, vatRate: VAT_RATE_2026 } },
    { name: 'Полный набор по умолчанию (как в SEED_SETTINGS)', settings: { ...seed.SEED_SETTINGS } },
    {
        name: 'Стресс-сценарий: 3 года + сезон + сдвиг + НДС',
        settings: {
            ...seed.SEED_SETTINGS,
            kInflation: 0.10,
            planningHorizonYears: 3,
            kSeasonal: 0.20,
            kScheduleShift: 0.20
        }
    }
];

print('| # | Сценарий | ИТОГО/мес | Δ от нейтрального |');
print('|---:|---|---:|---:|');
let baseline = null;
for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    clearCalculationCache();
    const c = buildCalc(smbAns);
    c.settings = sc.settings;
    const r = calculate(c);
    if (baseline === null) baseline = r.totalMonthly;
    const ratio = baseline > 0 ? (r.totalMonthly / baseline) : 1;
    print(`| ${i + 1} | ${sc.name} | ${fmtRub(r.totalMonthly)} | ×${ratio.toFixed(3)} |`);
}

const output = lines.join('\n') + '\n';
const mode = process.argv[2] || '';

if (mode === '--write') {
    writeFileSync(REPORT_PATH, output, 'utf8');
    console.log(`SANITY_REPORT.md updated (${lines.length} lines)`);
} else if (mode === '--check') {
    const current = readFileSync(REPORT_PATH, 'utf8');
    if (current !== output) {
        console.error('SANITY_REPORT.md is stale. Run: npm run sanity');
        process.exit(1);
    }
} else if (mode) {
    console.error(`Unknown mode: ${mode}`);
    process.exit(1);
} else {
    process.stdout.write(output);
}
