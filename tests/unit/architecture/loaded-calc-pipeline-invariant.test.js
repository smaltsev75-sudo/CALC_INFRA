/**
 * Архитектурный инвариант: все 4 load-path для calc'а используют единый
 * pipeline через `prepareLoadedCalc` либо явно зовут `applyVatResolver`
 * + sanitize. Защита от регрессии Внешнего аудита #9 (2026-05-19): один
 * из 4 путей выпадал из симметрии (migrate+enrich без vat/sanitize),
 * пользователь после F5 / import / bundle-apply получал stale ставку
 * или stale deprecated id.
 *
 * Forcing function (§5.quat глобального CLAUDE.md): после contract-fix
 * по аудиту обязателен архитектурный invariant-тест, который ловит
 * регрессию через grep исходника. Без него родственный путь снова
 * расходится при следующем рефакторинге.
 *
 * 4 load-path:
 *   1. openCalc                — calcListController.js
 *   2. initFromStorage         — calcListController.js (boot-path активного calc'а)
 *   3. importCalcFromFile      — calcListController.js
 *   4. applyStateBundle        — services/bundleExport.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const calcListSrc = stripJsComments(
    readFileSync(resolve(__dirname, '../../../js/controllers/calcListController.js'), 'utf8')
);
const bundleSrc = stripJsComments(
    readFileSync(resolve(__dirname, '../../../js/services/bundleExport.js'), 'utf8')
);
const loadedCalcSrc = stripJsComments(
    readFileSync(resolve(__dirname, '../../../js/services/loadedCalc.js'), 'utf8')
);
const validationSrc = stripJsComments(
    readFileSync(resolve(__dirname, '../../../js/domain/validation.js'), 'utf8')
);
const deprecatedSrc = stripJsComments(
    readFileSync(resolve(__dirname, '../../../js/domain/deprecatedQuestions.js'), 'utf8')
);
const persistenceSrc = stripJsComments(
    readFileSync(resolve(__dirname, '../../../js/state/persistence.js'), 'utf8')
);

/* ----- helpers ----- */

function functionBody(src, name) {
    /* Извлекает тело функции через парсинг балансированных {}.
     * Особенность: arguments-список тоже содержит {} (`opts = {}`),
     * поэтому сначала находим ) аргументов на верхнем уровне, потом
     * первый { ПОСЛЕ него — это body. */
    const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`);
    const m = re.exec(src);
    if (!m) return null;
    /* Найти соответствующую закрывающую ) для arguments. */
    let i = src.indexOf('(', m.index);
    if (i < 0) return null;
    let parenDepth = 0;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '(') parenDepth++;
        else if (c === ')') {
            parenDepth--;
            if (parenDepth === 0) { i++; break; }
        }
    }
    /* Найти первую { после arguments — это body. */
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return null;
    let depth = 0;
    const start = i;
    for (; i < src.length; i++) {
        const c = src[i];
        if (c === '{') depth++;
        else if (c === '}') {
            depth--;
            if (depth === 0) return src.slice(start + 1, i);
        }
    }
    return null;
}

/* ============================================================ */

describe('Loaded-calc pipeline symmetry: prepareLoadedCalc — единый helper для 3 load-path', () => {
    it('prepareLoadedCalc экспортируется из services/loadedCalc.js', () => {
        assert.match(loadedCalcSrc, /export\s+function\s+prepareLoadedCalc\s*\(/,
            'prepareLoadedCalc должен быть exported из services/loadedCalc.js ' +
            '(PATCH 2.18.5 audit #12: перенесён из controllers в services чтобы ' +
            'bundleExport мог использовать без cross-layer violation).');
    });

    it('prepareLoadedCalc вызывает migrate + enrich + applyVatResolver + enrichChanged-check', () => {
        const body = functionBody(loadedCalcSrc, 'prepareLoadedCalc');
        assert.ok(body, 'prepareLoadedCalc должна существовать');
        assert.match(body, /migrateCalculation\s*\(/,
            'prepareLoadedCalc должна звать migrateCalculation');
        assert.match(body, /enrichLegacyDictionaryWithAgentSeed\s*\(/,
            'prepareLoadedCalc должна звать enrichLegacyDictionaryWithAgentSeed (P1#2 audit #12)');
        assert.match(body, /applyVatResolver\s*\(/,
            'prepareLoadedCalc должна звать applyVatResolver (P1#1 audit #11)');
        assert.match(body, /hasDeprecatedQuestions\s*\(/,
            'prepareLoadedCalc должна звать hasDeprecatedQuestions для needsPersist (P2#4 audit #11)');
        assert.match(body, /enrichChanged/,
            'needsPersist должен учитывать enrichChanged (P2#3 audit #12): иначе ' +
            'legacy без agent-вопросов имеет enrich в-памяти, но storage остаётся stale.');
    });

    it('calcListController.js re-export prepareLoadedCalc из services', () => {
        assert.match(calcListSrc, /import\s*\{\s*prepareLoadedCalc\s*\}\s*from\s*['"][^'"]*services\/loadedCalc[^'"]*['"]/,
            'calcListController импортирует helper из services/loadedCalc.js');
    });

    it('openCalc использует prepareLoadedCalc', () => {
        const body = functionBody(calcListSrc, 'openCalc');
        assert.ok(body, 'openCalc должна существовать');
        assert.match(body, /prepareLoadedCalc\s*\(/,
            'openCalc должна вызывать prepareLoadedCalc (а не дублировать pipeline вручную).');
        /* Запрет на inline-pipeline: если openCalc снова сам зовёт migrate+enrich+
         * applyVatResolver — pipeline разойдётся при следующем рефакторинге. */
        assert.doesNotMatch(body, /migrateCalculation\s*\(/,
            'openCalc НЕ должна звать migrateCalculation напрямую — pipeline в prepareLoadedCalc.');
    });

    it('initFromStorage использует prepareLoadedCalc для активного calc\'а', () => {
        const body = functionBody(calcListSrc, 'initFromStorage');
        assert.ok(body, 'initFromStorage должна существовать');
        assert.match(body, /prepareLoadedCalc\s*\(/,
            'initFromStorage должна вызывать prepareLoadedCalc для активного calc\'а (P1#1, P2#4).');
        assert.doesNotMatch(body, /migrateCalculation\s*\(/,
            'initFromStorage НЕ должна звать migrateCalculation напрямую.');
    });

    it('importCalcFromFile использует prepareLoadedCalc', () => {
        const body = functionBody(calcListSrc, 'importCalcFromFile');
        assert.ok(body, 'importCalcFromFile должна существовать');
        assert.match(body, /prepareLoadedCalc\s*\(/,
            'importCalcFromFile должна вызывать prepareLoadedCalc после parse/validate (P1#1-родственный).');
        assert.doesNotMatch(body, /migrateCalculation\s*\(\s*data\s*\)/,
            'importCalcFromFile НЕ должна звать migrateCalculation(data) напрямую.');
    });

    it('applyStateBundle calc-loop проходит через prepareLoadedCalc (полный pipeline)', () => {
        const body = functionBody(bundleSrc, 'applyStateBundle');
        assert.ok(body, 'applyStateBundle должна существовать');
        assert.match(body, /prepareLoadedCalc\s*\(/,
            'applyStateBundle calc-loop должен использовать prepareLoadedCalc — ' +
            'единый pipeline (migrate + enrich + applyVatResolver). Audit #12 P1#2: ' +
            'inline migrate+applyVatResolver забывал enrichLegacyDictionaryWithAgentSeed.');
        assert.match(body, /sanitizeDefaultDictionary\s*\(/,
            'applyStateBundle сохраняет defaultDictionary через sanitizeDefaultDictionary ' +
            '(audit #12 P2#4): bundle с stale dict не уносит deprecated id в storage.');
    });
});

describe('Default dictionary sanitize symmetry', () => {
    it('sanitizeDefaultDictionary экспортируется из deprecatedQuestions.js', () => {
        assert.match(deprecatedSrc, /export\s+function\s+sanitizeDefaultDictionary\s*\(/,
            'sanitizeDefaultDictionary должен быть в одном модуле с sanitizeDeprecatedQuestions.');
    });

    it('makeNewCalculation очищает stored defaultDictionary', () => {
        const body = functionBody(calcListSrc, 'makeNewCalculation');
        assert.ok(body, 'makeNewCalculation должна существовать');
        assert.match(body, /sanitizeDefaultDictionary\s*\(/,
            'makeNewCalculation должна звать sanitizeDefaultDictionary над stored dict (P1#2). ' +
            'Без sanitize stale deprecated вопрос попадает в новый calc через defaultAnswersFrom.');
    });

    it('buildStateBundle calc-loop через prepareLoadedCalc (полный pipeline), dict через sanitizeDefaultDictionary', () => {
        const body = functionBody(bundleSrc, 'buildStateBundle');
        assert.ok(body, 'buildStateBundle должна существовать');
        assert.match(body, /prepareLoadedCalc\s*\(/,
            'buildStateBundle должен прогонять каждый calc через prepareLoadedCalc (audit #12 P1#1). ' +
            'Прежний sanitize-без-migrate ломал legacy миграцию 3→4 (dau_target → share).');
        assert.match(body, /sanitizeDefaultDictionary\s*\(/,
            'buildStateBundle должен звать sanitizeDefaultDictionary для defaultDictionary.');
    });
});

describe('Audit #13 invariants (PATCH 2.18.6)', () => {
    it('prepareLoadedCalc отвергает не-object stored (string/number/array/boolean)', () => {
        const body = functionBody(loadedCalcSrc, 'prepareLoadedCalc');
        assert.ok(body);
        /* Должна быть явная проверка `typeof !== 'object'` ИЛИ `Array.isArray` */
        assert.match(body, /Array\.isArray\s*\(\s*stored\s*\)/,
            'prepareLoadedCalc должен явно отвергать Array (typeof Array === "object" пропустил бы)');
        assert.match(body, /TypeError|error\s*[:=]\s*new/i,
            'prepareLoadedCalc должен возвращать error для not-object вместо silent calc=stored');
    });

    it('enrichChanged ловит refresh формул через snapshot/JSON.stringify', () => {
        const body = functionBody(loadedCalcSrc, 'prepareLoadedCalc');
        assert.ok(body);
        /* Раньше был length-check (afterQ !== beforeQ), сейчас — snapshot
         * через JSON.stringify dictionaries. Length-based — недостаточно
         * для refresh qtyFormulas у уже существующих items. */
        assert.match(body, /JSON\.stringify\s*\(\s*calc\.dictionaries/,
            'enrichChanged должен сравнивать snapshot dictionaries, не только length ' +
            '(audit #13 P2#4): иначе refresh формул у существующих items не персистится.');
    });

    it('buildStateBundle возвращает errors[] для потерянных calc-ов', () => {
        const body = functionBody(bundleSrc, 'buildStateBundle');
        assert.ok(body);
        assert.match(body, /errors\s*[:=,]/,
            'buildStateBundle должен собирать errors[] (audit #13 P1#2): silent .filter скрывал потерянные calc-и');
    });

    it('applyStateBundle rollback убирает dict если backup.defaultDict=null', () => {
        const body = functionBody(bundleSrc, 'applyStateBundle');
        assert.ok(body);
        assert.match(body, /removeKey\s*\(\s*STORAGE_KEYS\.DEFAULT_DICTIONARY/,
            'rollback должен removeKey DEFAULT_DICTIONARY когда backup.defaultDict=null ' +
            '(audit #13 P3#7): иначе imported {items:[], questions:[]} остаётся в storage.');
    });

    it('validateQuestion проверяет defaultValue/defaultIfUnknown по типу вопроса', () => {
        const body = functionBody(validationSrc, 'validateQuestion');
        assert.ok(body);
        assert.match(body, /defaultValue|defaultIfUnknown/,
            'validateQuestion должен валидировать defaultValue/defaultIfUnknown (audit #13 P2#5)');
    });

    it('loadCalcPrepared экспортируется из calcListController для UI/CSV consumers', () => {
        assert.match(calcListSrc, /export\s+function\s+loadCalcPrepared\s*\(/,
            'loadCalcPrepared должен быть exported (audit #13 P1#1): ' +
            'comparison UI и CSV-экспорт обязаны идти через него, не через raw persist.loadCalc.');
    });
});

describe('Persistence write-side sanitize', () => {
    it('saveDefaultDictionary применяет sanitizeDefaultDictionary ПЕРЕД writeJson', () => {
        const body = functionBody(persistenceSrc, 'saveDefaultDictionary');
        assert.ok(body, 'saveDefaultDictionary должна существовать');
        assert.match(body, /sanitizeDefaultDictionary\s*\(/,
            'saveDefaultDictionary должен sanitize ПЕРЕД writeJson (audit #12 P2#4). ' +
            'Это единственный write-call для defaultDictionary → закрывает все ' +
            'call-sites (itemController, questionController, applyStateBundle, calcListController).');
    });
});

describe('Scenario shape validation', () => {
    it('validateScenario экспортируется из validation.js', () => {
        assert.match(validationSrc, /export\s+function\s+validateScenario\s*\(/,
            'validateScenario должен быть exported (для reuse + тестирования отдельно).');
    });

    it('validateScenario проверяет id, label, answers, wizard, answersMeta', () => {
        const body = functionBody(validationSrc, 'validateScenario');
        assert.ok(body, 'validateScenario должна существовать');
        assert.match(body, /sc\.id/, 'должна проверять sc.id');
        assert.match(body, /sc\.label/, 'должна проверять sc.label');
        assert.match(body, /sc\.answers/, 'должна проверять sc.answers');
        assert.match(body, /sc\.wizard/, 'должна проверять sc.wizard');
        assert.match(body, /sc\.answersMeta/, 'должна проверять sc.answersMeta');
    });

    it('validateCalculation использует validateScenario + проверяет activeScenarioId', () => {
        const body = functionBody(validationSrc, 'validateCalculation');
        assert.ok(body, 'validateCalculation должна существовать');
        assert.match(body, /validateScenario\s*\(/,
            'validateCalculation должна звать validateScenario для каждого scenarios[i].');
        assert.match(body, /activeScenarioId/,
            'validateCalculation должна проверять activeScenarioId.');
    });
});
