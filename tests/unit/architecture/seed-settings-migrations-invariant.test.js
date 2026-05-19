/**
 * Архитектурный инвариант: SEED_SETTINGS должен содержать все settings-ключи,
 * которые инициализируют миграции.
 *
 * Контекст (PATCH 2.19.1, audit #14 P1#1): до фикса SEED_SETTINGS не содержал
 * `resourceRatio` (его инициализирует миграция v2→v3). Поскольку
 * makeNewCalculation ставит schemaVersion=CURRENT_SCHEMA_VERSION (Stage 19),
 * миграции пропускаются, и поле в новом расчёте отсутствовало. Calculator
 * падал на fallback общего standSizeRatio, UI таблица показывала
 * DEFAULT_RESOURCE_RATIO — расхождение.
 *
 * Этот линтер сканирует тело каждого migration step и собирает имена
 * settings-ключей, которые туда добавляются (s.X = ... либо s.X || =).
 * Затем проверяет, что эти ключи присутствуют в SEED_SETTINGS.
 *
 * Whitelist: ключи, которые мигрируются ИЗ ответов / удаляются (delete s.X),
 * не должны быть в SEED_SETTINGS — для них есть отдельный список IGNORED.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

const migrationsSrc = readFileSync(join(REPO_ROOT, 'js', 'state', 'migrations.js'), 'utf8');

/* Ключи, которые миграция намеренно НЕ инициализирует постоянно
 * (либо удаляет, либо относится к calc.answers, либо к calc.dictionaries.*,
 * либо это технические intermediate-state ключи). */
const IGNORED_KEYS = new Set([
    'indexation',     // удаляется в v1→v2 (rename to kInflation)
    'currency',       // удаляется в v1→v2
    'tariff',         // на item, не на settings
    'phase_duration_months',  // в answers, не settings
    /* providerVersion, provider — устанавливаются миграцией v12→v13 на calc
     * (не settings) или контроллером createCalc. Проверка — наличие в
     * SEED_SETTINGS через `provider` уже есть. */
    'providerVersion',
    /* VAT-1 (PATCH 2.15.0): vatRateMode/vatEffectiveDate инициализируются
     * per-instance из текущей даты в makeNewCalculation. SEED_SETTINGS не
     * может содержать «сегодняшнюю дату» — это static-load time. Эти ключи
     * — динамические per-calc, не дефолт для всех. Защита от P1#1-класса
     * багов: createCalc сам устанавливает их явно, поэтому новый calc не
     * полагается на миграции для их получения. */
    'vatRateMode',
    'vatEffectiveDate'
]);

const { SEED_SETTINGS } = await import('../../../js/domain/seed.js');

describe('SEED_SETTINGS ↔ migrations.js — invariant симметрии', () => {
    it('каждый settings-ключ, который инициализируют миграции, есть в SEED_SETTINGS', () => {
        /* Ищем паттерны:
         *   if (s.KEY === undefined) s.KEY = ...
         *   if (!s.KEY) s.KEY = ...
         *   s.KEY = { ... } (присваивание без guard)
         *
         * Не ловим:
         *   s.standSizeRatio.PROD = 1.00 (nested)
         *   s.standSizeRatio[stand] (subscript)
         */
        const pattern = /\bs\.([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*[^=]/g;
        const found = new Set();
        let m;
        while ((m = pattern.exec(migrationsSrc)) !== null) {
            const key = m[1];
            if (IGNORED_KEYS.has(key)) continue;
            found.add(key);
        }

        const missing = [];
        for (const key of found) {
            if (!(key in SEED_SETTINGS)) {
                missing.push(key);
            }
        }
        assert.deepEqual(
            missing,
            [],
            `SEED_SETTINGS не содержит ключи, инициализируемые миграциями: ${missing.join(', ')}. ` +
            `Это значит новый расчёт с schemaVersion=LATEST пропустит миграцию И не получит поле — ` +
            `см. audit #14 P1#1 для resourceRatio.`
        );
    });

    it('resourceRatio явно проверен в SEED_SETTINGS (защита от регрессии P1#1)', () => {
        assert.ok(
            'resourceRatio' in SEED_SETTINGS,
            'SEED_SETTINGS.resourceRatio обязан присутствовать после PATCH 2.19.1 (audit #14 P1#1)'
        );
    });

    it('aiStandFactor явно проверен в SEED_SETTINGS', () => {
        assert.ok(
            'aiStandFactor' in SEED_SETTINGS,
            'SEED_SETTINGS.aiStandFactor обязан присутствовать (миграция v8→v9)'
        );
    });

    it('standSizeRatio явно проверен в SEED_SETTINGS', () => {
        assert.ok(
            'standSizeRatio' in SEED_SETTINGS,
            'SEED_SETTINGS.standSizeRatio обязан присутствовать (миграция v1→v2)'
        );
    });
});

describe('migration v11→v12 — двусторонний clamp (защита от P1#2)', () => {
    it('migration v11→v12 содержит min-check (а не только max)', () => {
        const v11to12 = migrationsSrc.match(/from:\s*11,\s*to:\s*12[\s\S]*?run\(calc\)\s*\{([\s\S]*?)\n\s{4}\}/);
        assert.ok(v11to12, 'migration v11→v12 должна существовать');
        const body = v11to12[1];
        /* После audit #14 P1#2 в теле должен быть min-check. */
        assert.ok(
            /range\.min|< range\.min|< min/.test(body),
            'migration v11→v12 должна clamp\'ить значения ниже min (audit #14 P1#2)'
        );
        assert.ok(
            /range\.max|> range\.max|> max/.test(body),
            'migration v11→v12 должна clamp\'ить значения выше max (исходный clamp)'
        );
    });
});

describe('normalizeStandRatios — invariant интеграции (защита от audit-15 P1+P1/P2)', () => {
    it('prepareLoadedCalc вызывает normalizeStandRatios', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'services', 'loadedCalc.js'), 'utf8');
        assert.ok(
            /normalizeStandRatios/.test(src),
            'prepareLoadedCalc обязан вызывать normalizeStandRatios (audit-15 P1+P1/P2)'
        );
    });

    it('validateBundle вызывает normalizeStandRatios перед validateCalculation', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'services', 'bundleExport.js'), 'utf8');
        const idxNormalize = src.indexOf('normalizeStandRatios(migrated)');
        const idxValidate = src.indexOf('validateCalculation(migrated, calcErrors');
        assert.ok(idxNormalize !== -1, 'validateBundle обязан вызывать normalizeStandRatios');
        assert.ok(idxValidate !== -1, 'validateBundle обязан вызывать validateCalculation');
        assert.ok(idxNormalize < idxValidate,
            'normalizeStandRatios должен быть ДО validateCalculation (audit-15 P1)');
    });

    it('refreshCalcList card-display нормализует (audit-15 §5.bis уровень 2)', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'calcListController.js'), 'utf8');
        // refreshCalcList — body должен содержать normalizeStandRatios(migrated).
        const m = src.match(/export function refreshCalcList\(\)[\s\S]*?(?=\nexport |\nfunction )/);
        assert.ok(m, 'refreshCalcList должна быть определена');
        assert.ok(
            /normalizeStandRatios\(migrated\)/.test(m[0]),
            'refreshCalcList card-display обязан вызывать normalizeStandRatios'
        );
    });

    it('duplicateCalc через prepareLoadedCalc (audit-15 §5.bis уровень 3)', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'calcListController.js'), 'utf8');
        const m = src.match(/export function duplicateCalc[\s\S]*?(?=\nexport |\nfunction )/);
        assert.ok(m, 'duplicateCalc должна быть определена');
        assert.ok(
            /prepareLoadedCalc/.test(m[0]),
            'duplicateCalc обязан использовать prepareLoadedCalc для нормализации source'
        );
    });
});

describe('CRUD validateAnswersConsistency — invariant (защита от audit-15 P2)', () => {
    it('saveQuestion вызывает validateAnswersConsistency ПЕРЕД commitActiveCalc', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'questionController.js'), 'utf8');
        const m = src.match(/export function saveQuestion\(q\)[\s\S]*?(?=\nexport |\nfunction )/);
        assert.ok(m, 'saveQuestion должна быть');
        const idxValidate = m[0].indexOf('validateAnswersConsistency(newCalc');
        const idxCommit = m[0].indexOf('commitActiveCalc(newCalc)');
        assert.ok(idxValidate !== -1, 'saveQuestion обязана вызывать validateAnswersConsistency');
        assert.ok(idxCommit !== -1, 'saveQuestion обязана вызывать commitActiveCalc');
        assert.ok(idxValidate < idxCommit,
            'validateAnswersConsistency ДО commitActiveCalc (audit-15 P2)');
    });

    it('importQuestions вызывает validateAnswersConsistency', () => {
        const srcQ = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'questionController.js'), 'utf8');
        assert.ok(/importQuestions[\s\S]*?validateAnswersConsistency\(newCalc/.test(srcQ),
            'importQuestions обязана вызывать validateAnswersConsistency');
    });

    it('validateAnswersConsistency экспортируется из validation.js', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        assert.ok(/export function validateAnswersConsistency/.test(src),
            'validateAnswersConsistency обязан быть экспортирован');
    });
});

describe('Audit #17 invariants — root↔scenarios mirror в CRUD', () => {
    it('deleteQuestion очищает scenarios[*].answers', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'questionController.js'), 'utf8');
        const m = src.match(/export function deleteQuestion[\s\S]*?(?=\nexport |\nfunction )/);
        assert.ok(m, 'deleteQuestion должна быть');
        assert.ok(
            /calc\.scenarios[\s\S]*?delete scAnswers\[qid\]|calc\.scenarios[\s\S]*?\.map\(sc =>/.test(m[0]),
            'deleteQuestion обязан итерировать scenarios[*] (audit-17 P1)'
        );
    });

    it('saveQuestion добавляет default во все scenarios для нового вопроса', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'questionController.js'), 'utf8');
        const m = src.match(/export function saveQuestion[\s\S]*?(?=\nexport |\nfunction )/);
        assert.ok(m, 'saveQuestion должна быть');
        assert.ok(
            /calc\.scenarios[\s\S]*?defaultAnswerFor\(q\)/.test(m[0]),
            'saveQuestion обязан зеркалить default в scenarios (audit-17 P2.a)'
        );
    });

    it('importQuestions добавляет default во все scenarios для новых вопросов', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'controllers', 'questionController.js'), 'utf8');
        const m = src.match(/export async function importQuestions[\s\S]*?(?=\nexport |\nfunction \w|$)/);
        assert.ok(m, 'importQuestions должна быть');
        assert.ok(
            /calc\.scenarios[\s\S]*?defaultAnswerFor/.test(m[0]),
            'importQuestions обязан зеркалить default в scenarios (audit-17 P2.a)'
        );
    });

    it('app.js различает reason="validation" в bundle.errors UI', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'app.js'), 'utf8');
        assert.ok(/reasons\.validation/.test(src),
            'app.js bundle export UI должен явно группировать по reason=validation (audit-17 P3)');
    });
});

describe('Audit #16 invariants — scenarios + bundle validate + NaN-options', () => {
    it('validateAnswersConsistency покрывает scenarios[*].answers', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        const m = src.match(/export function validateAnswersConsistency[\s\S]*?\n\}/);
        assert.ok(m, 'validateAnswersConsistency должна быть');
        assert.ok(
            /isArray\(calc\.scenarios\)/.test(m[0]) && /scenarios\[\$\{i\}\]\.answers/.test(m[0]),
            'validateAnswersConsistency обязан проходить scenarios[*] (audit-16 P1)'
        );
    });

    it('buildStateBundle вызывает validateCalculation и не включает invalid в calculations', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'services', 'bundleExport.js'), 'utf8');
        const m = src.match(/export function buildStateBundle[\s\S]*?\n\}/);
        assert.ok(m, 'buildStateBundle должна быть');
        assert.ok(/validateCalculation\(calc, validateErrors/.test(m[0]),
            'buildStateBundle обязан вызывать validateCalculation (audit-16 P2)');
        assert.ok(/reason:\s*'validation'/.test(m[0]),
            'buildStateBundle обязан добавлять reason=validation в errors[]');
        // Проверяем, что после validation push в errors стоит continue (НЕ push в calcs).
        const validateBlock = m[0].match(/validateCalculation[\s\S]*?continue;/);
        assert.ok(validateBlock, 'после validateCalculation errors должен быть continue (skip calc)');
    });

    it('Number.isFinite для option.value (audit-16 P3)', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        assert.ok(
            /typeof o\.value === 'number' && !Number\.isFinite\(o\.value\)/.test(src),
            'validateQuestion обязан Number.isFinite для option.value (audit-16 P3)'
        );
    });
});

describe('NaN reject в validation (audit-15 P3)', () => {
    it('validateQuestion отвергает NaN/Infinity для number-default', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        // Должна быть проверка !Number.isFinite(dv) в default-валидации.
        assert.ok(
            /!Number\.isFinite\(dv\)/.test(src),
            'validateQuestion обязан использовать Number.isFinite для default (audit-15 P3)'
        );
    });

    it('_validateAnswersAgainstQuestions отвергает NaN/Infinity для answer', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        assert.ok(
            /!Number\.isFinite\(value\)/.test(src),
            '_validateAnswersAgainstQuestions обязан использовать Number.isFinite для answer (audit-15 P3)'
        );
    });
});

describe('validateQuestion — coherence-checks (защита от P2#3/P2#4)', () => {
    /* Эти тесты тоже в integration external-audit-12, но invariant защищает
     * саму конструкцию валидатора через source-grep. */
    it('validation.js содержит coherence-check min<=max для number', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        assert.ok(
            /q\.min\s*>\s*q\.max|min.*должен.*быть.*≤.*max/.test(src),
            'validateQuestion обязан проверять min <= max (audit #14 P2#3)'
        );
    });

    it('validation.js содержит check step > 0', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        assert.ok(
            /q\.step\s*<=?\s*0|step.*должен.*быть.*>\s*0/.test(src),
            'validateQuestion обязан проверять step > 0 (audit #14 P2#3)'
        );
    });

    it('validation.js содержит check option.value скаляр (string | number)', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'domain', 'validation.js'), 'utf8');
        assert.ok(
            /typeof o\.value !== 'string' && typeof o\.value !== 'number'/.test(src),
            'validateQuestion обязан проверять тип option.value (audit #14 P2#4)'
        );
    });
});
