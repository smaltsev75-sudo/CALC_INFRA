/**
 * Архитектурный invariant — forcing function против регрессий по аудитам #1–#5
 * 2026-05-18 (PATCH 2.17.3 → 2.17.4 → 2.17.5 → 2.17.6 → 2.17.9).
 *
 * Проверяет инварианты:
 *
 *  (1) **Atomic rollback обоих ключей в _atomicCalcAndListWrite**.
 *      Ядро ДОЛЖНО снимать backup calc.<id> ДО первой записи и откатывать
 *      его (saveCalc(backup) или removeCalc(id)) при сбое второго ключа.
 *      Прецедент: внешний аудит #4 P1-1 — раньше откатывался только список,
 *      calc.<id> оставался orphan/dirty.
 *
 *  (2) **CRUD-функции с UI-modal-closer не должны иметь best-effort marker
 *      для commitActiveCalc**. UI закрывает модалку при `result.ok === true`,
 *      поэтому при quota пользователь увидит «успех» с потерянной правкой.
 *      Прецедент: внешний аудит #4 P1-2 — saveItem/saveQuestion возвращали
 *      ok:true при сбое commitActiveCalc.
 *
 *  (3) **_rollbackCalc / saveCalcList(backup) проверяют return**.
 *      persist.save* возвращают boolean (НЕ throws) при quota. try/catch
 *      ловит только throw — false-return пропадает silent.
 *      Прецедент: внешний аудит #5 P1-1.
 *
 *  (4) **void-CRUD (deleteItem/deleteQuestion/applyPriceUpdates) возвращают
 *      {ok, reason}**. UI показывает «удалено» через showUndoableSnackbar
 *      при persist-fail — data-resurrection на F5.
 *      Прецедент: внешний аудит #5 P2-1.
 *
 *  (5) **providerController.restoreProviderOverrideFromHistory имеет
 *      clearProviderOverride в else-ветке**. Если backupCurrent отсутствовал,
 *      target остаётся записан → partial mutation.
 *      Прецедент: внешний аудит #5 P3-1.
 *
 *  (6) **guidedCompletionController.rollbackGuidedCompletion вызывает
 *      commitActiveCalc явно**. Без этого rollback живёт только в store,
 *      F5 = правки мастера вернутся из storage.
 *      Прецедент: внешний аудит #5 P2-2.
 *
 *  (7) **costOptimizationPlannerController.rollbackOptimizationApply при
 *      commit-fail НЕ обнуляет lastApplySnapshot**. Иначе пользователь
 *      теряет возможность retry, F5 возвращает apply.
 *      Прецедент: внешний аудит #5 P3-2.
 *
 * Если новый код нарушит — тест упадёт и автор обязан либо проверить return,
 * либо обосновать почему UI-fix-loop безопасен (документирует решение).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('atomic-rollback invariant: calc.<id> + calc.list (audit #4 P1-1)', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/services/calcPersistence.js'), 'utf8');

    it('_atomicCalcAndListWrite снимает backup calc.<id> ДО первой записи', () => {
        /* Backup-снапшот через persist.loadCalc(calc.id) обязан выполняться
         * раньше любого persist.saveCalc(calc). */
        const loadCalcIdx = src.indexOf('persist.loadCalc(calc.id)');
        const saveCalcIdx = src.indexOf('persist.saveCalc(calc)');
        assert.ok(loadCalcIdx > 0,
            'persist.loadCalc(calc.id) должен быть в calcPersistence.js (backup ДО записи)');
        assert.ok(saveCalcIdx > 0, 'persist.saveCalc(calc) должен присутствовать');
        assert.ok(loadCalcIdx < saveCalcIdx,
            'backup calc.<id> через loadCalc должен сниматься ДО первой saveCalc — ' +
            'иначе при сбое list-write нечего восстановить');
    });

    it('_atomicCalcAndListWrite откатывает calc.<id> при сбое второго ключа', () => {
        /* Проверяем наличие rollback-механизма: либо backupCalcSnapshot
         * восстанавливается через saveCalc, либо новый calc удаляется через
         * removeCalc(calc.id). Без хотя бы одного — calc.<id> остаётся orphan
         * (для commitNewCalc) или dirty-rename (для commitActiveCalc). */
        const hasBackupRestore = /saveCalc\(\s*backupCalcSnapshot\s*\)/.test(src);
        const hasOrphanCleanup = /removeCalc\(\s*calc\.id\s*\)/.test(src);
        assert.ok(hasBackupRestore && hasOrphanCleanup,
            '_atomicCalcAndListWrite ДОЛЖЕН содержать ОБА варианта rollback:\n' +
            `  - saveCalc(backupCalcSnapshot) — для commitActiveCalc (rename): ${hasBackupRestore}\n` +
            `  - removeCalc(calc.id)         — для commitNewCalc (create): ${hasOrphanCleanup}\n` +
            'Иначе при сбое list-write calc.<id> остаётся в storage с гнилыми данными.');
    });

    it('_atomicCalcAndListWrite имеет helper _rollbackCalc', () => {
        /* Структурный invariant: rollback логика вынесена в helper, чтобы
         * вызываться из двух мест (listBuilder throw + saveCalcList fail). */
        assert.match(src, /_rollbackCalc\s*=/,
            'rollback логика должна быть выделена в helper _rollbackCalc, ' +
            'чтобы вызываться из обеих error-branches (listBuilder throw + saveCalcList fail)');
        /* Helper должен вызываться минимум в двух местах. */
        const callMatches = src.match(/_rollbackCalc\(\)/g) || [];
        assert.ok(callMatches.length >= 2,
            `_rollbackCalc() должен вызываться минимум 2 раза (listBuilder throw + saveCalcList fail), ` +
            `найдено ${callMatches.length}`);
    });
});

describe('audit #5 P1-1: _rollbackCalc проверяет return persist.save*/removeCalc/saveCalcList', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/services/calcPersistence.js'), 'utf8');

    it('_rollbackCalc возвращает boolean (не void) — caller обязан реагировать', () => {
        /* Структурное требование: helper должен иметь хотя бы один return
         * statement, чтобы вызывающий мог проверить успех. Старая версия
         * глотала false через try/catch без return. */
        const helperMatch = src.match(/_rollbackCalc\s*=\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\n    \};/);
        assert.ok(helperMatch, '_rollbackCalc должен быть arrow-function-helper в _atomicCalcAndListWrite');
        const body = helperMatch[1];
        assert.match(body, /\breturn\b/,
            '_rollbackCalc обязан возвращать boolean — иначе caller не отличит ' +
            'успех rollback от silent-false (квота на rollback).');
    });

    it('saveCalcList(backupList) проверяется через boolean-return', () => {
        /* Раньше: try { persist.saveCalcList(backupList); } catch — false
         * проходил мимо. Теперь либо отдельный helper _rollbackList,
         * либо явная проверка `=== true`. */
        const hasRollbackListHelper = /_rollbackList\s*=/.test(src);
        const hasExplicitCheck = /saveCalcList\s*\(\s*backupList\s*\)\s*===\s*true/.test(src);
        assert.ok(hasRollbackListHelper || hasExplicitCheck,
            'rollback list должен проверять return (либо через helper _rollbackList с return, ' +
            'либо через явное ===true) — иначе при сбое rollback мы говорим saved=ok с partial state.');
    });

    it('при двойном сбое (save + rollback) persistStatus содержит сигнал "перезагрузите страницу"', () => {
        /* User-visible сообщение должно отличаться от обычной QUOTA_ERROR_MSG —
         * partial state требует ручного reconciliation. */
        assert.match(src, /(перезагрузите страницу|partial state|расходятся)/i,
            'При двойном сбое persistStatus должен явно сигнализировать пользователю ' +
            '«состояние памяти ≠ хранилищу, перезагрузите». ' +
            'Иначе пользователь не знает, что нужно действовать руками.');
    });
});

describe('audit #5 P2: void-CRUD должны возвращать {ok, reason}', () => {
    const FILES = [
        { path: 'js/controllers/itemController.js', fnName: 'deleteItem', label: 'itemController.deleteItem' },
        { path: 'js/controllers/questionController.js', fnName: 'deleteQuestion', label: 'questionController.deleteQuestion' },
        { path: 'js/controllers/itemController.js', fnName: 'applyPriceUpdates', label: 'itemController.applyPriceUpdates' }
    ];

    for (const f of FILES) {
        it(`${f.label} возвращает {ok,reason} вместо void`, () => {
            const src = readFileSync(join(REPO_ROOT, f.path), 'utf8');
            const fnPattern = new RegExp(`function\\s+${f.fnName}\\s*\\([^)]*\\)\\s*\\{`);
            const fnStart = src.search(fnPattern);
            assert.ok(fnStart >= 0, `${f.label}: функция должна существовать`);
            const tail = src.slice(fnStart);
            const nextFnIdx = tail.search(/\n(export\s+)?(async\s+)?function\s+/);
            const body = nextFnIdx > 0 ? tail.slice(0, nextFnIdx) : tail;
            /* Должен быть `return { ok:` либо `return { ok :`. */
            assert.match(body, /return\s*\{\s*ok\s*:/,
                `${f.label} обязан возвращать {ok, reason?} объект. ` +
                'Иначе caller (UI) не знает о persist-сбое и показывает «удалено» с UNDO ' +
                '(data-resurrection на F5).');
            /* Должен быть `if (!commitActiveCalc(...))` либо явная проверка
             * через переменную `const persisted = commitActiveCalc(...);
             * if (!persisted)` — оба варианта валидны. */
            const hasInlineCheck = /if\s*\(\s*!\s*commitActiveCalc\s*\(/.test(body);
            const hasVarCheck =
                /commitActiveCalc\s*\(/.test(body) &&
                /if\s*\(\s*!\s*persisted\b/.test(body);
            assert.ok(hasInlineCheck || hasVarCheck,
                `${f.label} должен проверять return commitActiveCalc и возвращать ` +
                '{ok:false,reason:persist} при провале.');
        });
    }
});

describe('audit #5 P3-1: providerController.restoreProviderOverrideFromHistory имеет clearProviderOverride', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/providerController.js'), 'utf8');

    it('clearProviderOverride импортирован', () => {
        assert.match(src, /import\s*\{[^}]*\bclearProviderOverride\b/,
            'providerController должен импортировать clearProviderOverride для отката, ' +
            'когда current до операции отсутствовал.');
    });

    it('rollback ветка имеет clearProviderOverride при backupCurrent=null', () => {
        /* Должна быть либо тернарка backupCurrent ? saveProviderOverride(...) : clearProviderOverride(...),
         * либо if/else с тем же контрактом. */
        const hasTernary = /backupCurrent\s*\?\s*saveProviderOverride[\s\S]{0,200}clearProviderOverride/.test(src);
        const hasIfElse = /if\s*\(\s*backupCurrent\s*\)[\s\S]{0,400}else[\s\S]{0,200}clearProviderOverride/.test(src);
        assert.ok(hasTernary || hasIfElse,
            'restoreProviderOverrideFromHistory ДОЛЖЕН вызывать clearProviderOverride ' +
            'в ветке backupCurrent=null — иначе при сбое history-trim target остаётся ' +
            'записан как новый current (partial mutation).');
    });
});

describe('audit #5 P2-2: guidedCompletionController.rollbackGuidedCompletion вызывает commitActiveCalc', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/guidedCompletionController.js'), 'utf8');

    it('commitActiveCalc импортирован', () => {
        assert.match(src, /import\s*\{[^}]*\bcommitActiveCalc\b/,
            'guidedCompletionController должен импортировать commitActiveCalc — ' +
            'rollback мастера должен явно persist'+`'`+'ить, не полагаться на subscriber autosave.');
    });

    it('rollbackGuidedCompletion вызывает commitActiveCalc с проверкой return', () => {
        const fnMatch = src.match(/export\s+function\s+rollbackGuidedCompletion\s*\(\s*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch, 'rollbackGuidedCompletion должна существовать');
        const body = fnMatch[1];
        assert.match(body, /commitActiveCalc\s*\(/,
            'rollbackGuidedCompletion должен вызвать commitActiveCalc явно — ' +
            'без этого rollback живёт только в памяти, F5 = правки мастера возвращаются из storage.');
        /* Проверка return: либо `if (!commitActiveCalc(...))`, либо
         * `=== true` сравнение. */
        const hasReturnCheck =
            /if\s*\(\s*!\s*commitActiveCalc\s*\(/.test(body) ||
            /commitActiveCalc\s*\([^)]*\)\s*===\s*true/.test(body);
        assert.ok(hasReturnCheck,
            'rollbackGuidedCompletion должен проверять return commitActiveCalc — ' +
            'иначе persist-fail замалчивается.');
    });
});

describe('audit #6 P2-1: deleteItem/deleteQuestion — inverse pattern (commit ДО store)', () => {
    const FILES = [
        { path: 'js/controllers/itemController.js', fnName: 'deleteItem', label: 'itemController.deleteItem' },
        { path: 'js/controllers/questionController.js', fnName: 'deleteQuestion', label: 'questionController.deleteQuestion' }
    ];

    for (const f of FILES) {
        it(`${f.label}: commitActiveCalc(newCalc) вызывается ДО store.setActiveCalc/updateActiveCalc`, () => {
            const src = readFileSync(join(REPO_ROOT, f.path), 'utf8');
            const fnPattern = new RegExp(`export\\s+function\\s+${f.fnName}\\s*\\([^)]*\\)\\s*\\{`);
            const fnStart = src.search(fnPattern);
            assert.ok(fnStart >= 0);
            const tail = src.slice(fnStart);
            const nextFnIdx = tail.search(/\n(export\s+)?(async\s+)?function\s+/);
            const body = nextFnIdx > 0 ? tail.slice(0, nextFnIdx) : tail;

            /* Должен быть `commitActiveCalc(newCalc)` или `commitActiveCalc(some_local_var)` —
             * НЕ `commitActiveCalc(store.getState().activeCalc)` (это old broken pattern).
             * Структурное требование: новый calc-объект строится локально и
             * пробуется через commit ПЕРЕД любой мутацией store. */
            const hasInverseCommit = /commitActiveCalc\s*\(\s*newCalc\s*\)/.test(body);
            assert.ok(hasInverseCommit,
                `${f.label} должен использовать inverse pattern: построить newCalc локально, ` +
                'commitActiveCalc(newCalc) проверить → при ok вызвать store.setActiveCalc(newCalc). ' +
                'Без inverse pattern при persist-fail элемент исчезает в UI до F5 (data-resurrection-в-обратную-сторону).');

            /* store.updateActiveCalc до commitActiveCalc — запрещён в этих функциях. */
            const updateIdx = body.indexOf('store.updateActiveCalc');
            const commitIdx = body.indexOf('commitActiveCalc');
            if (updateIdx >= 0) {
                assert.ok(updateIdx > commitIdx,
                    `${f.label}: store.updateActiveCalc до commitActiveCalc — антипаттерн. ` +
                    'При persist-fail UI уже изменён.');
            }
        });
    }
});

describe('audit #6 P2-2: renameCalc возвращает {ok, reason} + commit-first-then-store', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/calcListController.js'), 'utf8');

    it('renameCalc возвращает {ok, reason?} вместо void', () => {
        const fnMatch = src.match(/export\s+function\s+renameCalc\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch);
        const body = fnMatch[1];
        assert.match(body, /return\s*\{\s*ok\s*:/,
            'renameCalc должен возвращать {ok, reason?} — иначе caller не знает о persist-fail.');
    });

    it('renameCalc проверяет commitCalcRename и НЕ мутирует store при fail', () => {
        const fnMatch = src.match(/export\s+function\s+renameCalc\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        const body = fnMatch[1];
        const commitIdx = body.indexOf('commitCalcRename');
        const setActiveIdx = body.indexOf('store.setActiveCalc');
        assert.ok(commitIdx > 0 && setActiveIdx > 0);
        assert.ok(commitIdx < setActiveIdx,
            'commitCalcRename должен вызываться ДО store.setActiveCalc. Иначе при persist-fail ' +
            'activeCalc становится с новым именем, в storage — старое.');
        assert.match(body, /if\s*\(\s*!\s*commitCalcRename\s*\(/,
            'renameCalc должен иметь explicit-проверку commitCalcRename и возврат {ok:false} при fail.');
    });
});

describe('audit #6 P3-1: deleteCalc возвращает {ok, reason}', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/calcListController.js'), 'utf8');

    it('deleteCalc возвращает {ok:false, reason:"persist"} при saveCalcList fail', () => {
        const fnMatch = src.match(/export\s+function\s+deleteCalc\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch);
        const body = fnMatch[1];
        assert.match(body, /return\s*\{\s*ok\s*:\s*false[\s\S]{0,100}reason\s*:\s*['"]persist['"]/,
            'deleteCalc должен возвращать {ok:false, reason:"persist"} при saveCalcList fail. ' +
            'Иначе caller (app.js) показывает undo-snackbar для несуществующего удаления.');
        assert.match(body, /return\s*\{\s*ok\s*:\s*true/,
            'deleteCalc должен возвращать {ok:true} на happy-path.');
    });
});

describe('audit #6 P3-2: _enterUpdate дифференцирует lock.reason persist vs locked', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/providerController.js'), 'utf8');

    it('_enterUpdate проверяет lock.reason и пробрасывает persist отдельно', () => {
        const fnMatch = src.match(/function\s+_enterUpdate\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch);
        const body = fnMatch[1];
        assert.match(body, /lock\.reason\s*===\s*['"]persist['"]/,
            '_enterUpdate должен дифференцировать lock.reason === "persist". ' +
            'Раньше любой lock.ok=false маскировался под locked-by-other-tab, ' +
            'хотя при quota проблема в storage, а не в другой вкладке.');
    });
});

describe('audit #7 P1: saveItem/saveQuestion/applyPriceUpdates/import* inverse pattern (commit ДО store)', () => {
    const TARGETS = [
        { path: 'js/controllers/itemController.js', fnName: 'saveItem', label: 'itemController.saveItem' },
        { path: 'js/controllers/questionController.js', fnName: 'saveQuestion', label: 'questionController.saveQuestion' },
        { path: 'js/controllers/itemController.js', fnName: 'applyPriceUpdates', label: 'itemController.applyPriceUpdates' }
    ];

    for (const t of TARGETS) {
        it(`${t.label}: commitActiveCalc(newCalc) ДО store.setActiveCalc(newCalc); store.updateActiveCalc запрещён`, () => {
            const src = readFileSync(join(REPO_ROOT, t.path), 'utf8');
            const fnPattern = new RegExp(`function\\s+${t.fnName}\\s*\\([^)]*\\)\\s*\\{`);
            const fnStart = src.search(fnPattern);
            assert.ok(fnStart >= 0, `${t.label}: функция должна существовать`);
            const tail = src.slice(fnStart);
            const nextFnIdx = tail.search(/\n(export\s+)?(async\s+)?function\s+/);
            const body = nextFnIdx > 0 ? tail.slice(0, nextFnIdx) : tail;

            /* commitActiveCalc должен получать локальный newCalc, не store.getState(). */
            const hasInverseCommit = /commitActiveCalc\s*\(\s*newCalc\s*\)/.test(body);
            assert.ok(hasInverseCommit,
                `${t.label}: inverse pattern — commitActiveCalc(newCalc) обязателен. ` +
                'Старый pattern (store.updateActiveCalc → commitActiveCalc(getState)) при ' +
                'persist-fail оставляет store с не-persisted данными, UI рапортует «сохранено».');

            /* store.updateActiveCalc — запрещён в этих функциях. */
            assert.doesNotMatch(body, /store\.updateActiveCalc\s*\(/,
                `${t.label}: store.updateActiveCalc — запрещён (только inverse pattern через ` +
                'commitActiveCalc(newCalc) + store.setActiveCalc(newCalc)).');
        });
    }
});

describe('audit #7 P1: applyOverrideToActiveCalc/applyOverrideToAllCalcsForProvider inverse pattern', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/providerController.js'), 'utf8');

    it('applyOverrideToActiveCalc: commitActiveCalc(newCalc) ДО store.setActiveCalc', () => {
        /* Извлекаем body конкретно ЭТОЙ функции через balanced { } parser,
         * иначе non-greedy regex захватывает все функции до конца файла. */
        const fnStart = src.indexOf('export function applyOverrideToActiveCalc');
        assert.ok(fnStart >= 0);
        const braceStart = src.indexOf('{', fnStart);
        let depth = 1;
        let i = braceStart + 1;
        while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        const body = src.slice(braceStart, i);
        assert.match(body, /commitActiveCalc\s*\(\s*newCalc\s*\)/,
            'applyOverrideToActiveCalc должен использовать inverse pattern (commitActiveCalc(newCalc)).');
        assert.doesNotMatch(body, /store\.updateActiveCalc\s*\(/,
            'applyOverrideToActiveCalc НЕ должен вызывать store.updateActiveCalc — ' +
            'только commitActiveCalc(newCalc) → store.setActiveCalc(newCalc).');
    });

    it('applyOverrideToAllCalcsForProvider active-ветка: commitActiveCalc(updated) ДО store.setActiveCalc', () => {
        /* Эта функция — длинная, попадаем в active-ветку через if (activeCalc && activeCalc.id === meta.id). */
        const branchMatch = src.match(/if\s*\(\s*activeCalc\s*&&\s*activeCalc\.id\s*===\s*meta\.id\s*\)\s*\{([\s\S]*?)\}\s*else\b/);
        assert.ok(branchMatch, 'Активная ветка должна существовать в applyOverrideToAllCalcsForProvider');
        const branchBody = branchMatch[1];
        assert.match(branchBody, /commitActiveCalc\s*\(\s*updated\s*\)/,
            'applyOverrideToAllCalcsForProvider active-ветка: commitActiveCalc(updated) обязателен (inverse).');
        assert.doesNotMatch(branchBody, /store\.updateActiveCalc\s*\(/,
            'Active-ветка НЕ должна вызывать store.updateActiveCalc — только setActiveCalc(updated) после ok.');
    });
});

describe('audit #7 P2: openCalc/initFromStorage проверяют commitMigratedCalc', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/calcListController.js'), 'utf8');

    it('openCalc: при commit-fail возвращает null + setPersistStatus error', () => {
        const fnMatch = src.match(/export\s+function\s+openCalc\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch);
        const body = fnMatch[1];
        assert.match(body, /if\s*\(\s*!\s*commitMigratedCalc\s*\(/,
            'openCalc должен проверять commitMigratedCalc return.');
        /* В ветке fail должен быть return null. */
        const failBranch = body.match(/if\s*\(\s*!\s*commitMigratedCalc\s*\([\s\S]*?\)\s*\{([\s\S]*?)\n\s+\}/);
        assert.ok(failBranch, 'Должна быть ветка с проверкой commitMigratedCalc fail');
        assert.match(failBranch[1], /return\s+null/,
            'openCalc при commit-fail должен возвращать null — не открывать calc.');
    });

    it('initFromStorage: при commit-fail миграции активного calc — НЕ ставит активным', () => {
        /* Структурное требование: в initFromStorage commitMigratedCalc должен
         * быть в if (!commitMigratedCalc(...)) с явной обработкой. */
        const initFnMatch = src.match(/export\s+function\s+initFromStorage\s*\([\s\S]*?\n\}/);
        assert.ok(initFnMatch);
        const body = initFnMatch[0];
        assert.match(body, /if\s*\(\s*!\s*commitMigratedCalc\s*\(/,
            'initFromStorage должен проверять commitMigratedCalc return.');
    });
});

describe('audit #7 P3: priceImportMapping пробрасывает refreshErrors', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/priceImportMappingController.js'), 'utf8');

    it('summary включает refreshErrors и partial-флаг', () => {
        assert.match(src, /refreshErrors/,
            'summary должен содержать refreshErrors из calcsResult.errors.');
        assert.match(src, /partial\s*:\s*refreshErrors\.length\s*>\s*0/,
            'summary должен содержать partial-флаг (refreshErrors.length > 0).');
    });
});

describe('audit #5 P3-2: costOptimizationPlannerController.rollbackOptimizationApply сохраняет snapshot при persist-fail', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/costOptimizationPlannerController.js'), 'utf8');

    it('rollbackOptimizationApply имеет ветку с persistOk=false которая НЕ обнуляет lastApplySnapshot', () => {
        const fnMatch = src.match(/export\s+function\s+rollbackOptimizationApply\s*\([\s\S]*?\n\}/);
        assert.ok(fnMatch, 'rollbackOptimizationApply должна существовать');
        const body = fnMatch[0];

        /* Должна быть проверка persist через commitActiveCalc. */
        assert.match(body, /commitActiveCalc\s*\([^)]*\)\s*===\s*true|if\s*\(\s*!\s*commitActiveCalc\s*\(/,
            'rollbackOptimizationApply должен проверять return commitActiveCalc.');

        /* Должна быть ветка-возврат с reason:'persist' при сбое. */
        assert.match(body, /reason\s*:\s*['"]persist['"]/,
            'rollbackOptimizationApply должен возвращать {ok:false,reason:persist} ' +
            'при commit-fail — UI покажет error-snackbar.');

        /* Главная защита: ветка persist-fail НЕ должна содержать
         * `lastApplySnapshot: null`. Иначе пользователь теряет snapshot и retry. */
        const persistFailBranchMatch = body.match(/if\s*\(\s*!\s*persistOk\s*\)\s*\{([\s\S]*?)\n\s{4}\}/);
        if (persistFailBranchMatch) {
            const branchBody = persistFailBranchMatch[1];
            assert.doesNotMatch(branchBody, /lastApplySnapshot\s*:\s*null/,
                'Ветка persist-fail НЕ должна обнулять lastApplySnapshot — ' +
                'пользователь должен иметь возможность retry. Snapshot обнуляется ' +
                'только в success-ветке.');
        } else {
            assert.fail('Не найдена ветка if(!persistOk) — структура rollback изменилась, ' +
                'обновите invariant-тест.');
        }
    });
});

describe('CRUD ok-contract: saveItem/saveQuestion не должны замалчивать commit-fail (audit #4 P1-2)', () => {
    const FILES = [
        {
            path: 'js/controllers/itemController.js',
            fnName: 'saveItem',
            label: 'itemController.saveItem'
        },
        {
            path: 'js/controllers/questionController.js',
            fnName: 'saveQuestion',
            label: 'questionController.saveQuestion'
        }
    ];

    for (const f of FILES) {
        it(`${f.label} проверяет return commitActiveCalc и возвращает {ok:false} при quota`, () => {
            const src = readFileSync(join(REPO_ROOT, f.path), 'utf8');

            /* Найти тело функции. */
            const fnPattern = new RegExp(
                `export\\s+function\\s+${f.fnName}\\s*\\([^)]*\\)\\s*\\{`
            );
            const fnStart = src.search(fnPattern);
            assert.ok(fnStart >= 0, `${f.label}: функция должна существовать как named export`);

            /* Взять примерно тело функции — до следующего export function ИЛИ
             * до конца файла. Этого достаточно для проверки наличия паттернов. */
            const tail = src.slice(fnStart);
            const nextExportIdx = tail.search(/\nexport\s+function\s+/);
            const body = nextExportIdx > 0 ? tail.slice(0, nextExportIdx) : tail;

            /* Должен быть `if (!commitActiveCalc(...))` (или эквивалент). */
            assert.match(body, /if\s*\(\s*!\s*commitActiveCalc\s*\(/,
                `${f.label} должен проверять return commitActiveCalc через if(!...) — ` +
                'иначе при сбое сохранения функция вернёт ok:true и UI закроет модалку с потерянной правкой');

            /* НЕ должно быть best-effort маркера для commitActiveCalc.
             * Best-effort допустим только когда сбой save = UI-rollback на F5
             * (deleteItem, applyPriceUpdates, importItems.onAccepted) —
             * но НЕ для saveItem/saveQuestion с UI-modal-closer. */
            const lines = body.split('\n');
            let inBestEffortBlock = false;
            for (let i = 0; i < lines.length; i++) {
                const l = lines[i];
                if (/best-effort/i.test(l)) {
                    /* Найден best-effort marker. Проверим, относится ли к
                     * commitActiveCalc в окне ±3 строки. */
                    const window = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 4)).join('\n');
                    if (/commitActiveCalc\s*\(/.test(window)) {
                        assert.fail(
                            `${f.label}: best-effort marker рядом с commitActiveCalc запрещён. ` +
                            'Эта функция возвращает в UI ok-status; модалка закроется как при ' +
                            'успехе, и пользователь не узнает, что правка не сохранилась.\n' +
                            `Контекст:\n${window}`
                        );
                    }
                }
            }
        });
    }
});

/* ============================================================
 * Аудит #8 (2026-05-18) — 5 новых инвариантов.
 *
 *   (8.1) storage.getReadStorage не должен возвращать memory fallback по
 *         `_probedOk === false`-флагу — иначе при quota реальные данные
 *         в localStorage становятся «невидимыми».
 *
 *   (8.2) duplicateItem/duplicateQuestion обязаны возвращать {ok, id?, reason?},
 *         не голый id. Caller должен проверять ok, иначе при saveItem fail
 *         caller лживо рапортует success.
 *
 *   (8.3) priceImportMappingController.applyPriceImport summary должен
 *         содержать refreshReason/refreshMessage и `partial=true` также
 *         при `calcsResult.ok === false` (full refresh-failure до loop'а).
 *
 *   (8.4) itemController.importItemPrices в anomaly-ветке формирует свой
 *         message — НЕ доверяет `r.message || ...` (это generic «Цены не
 *         применены», лжёт что safe не сохранены).
 *
 *   (8.5) Undo деления вопроса в app.js восстанавливает backupAnswer
 *         через inverse pattern (commit ПЕРВЫМ, store ВТОРЫМ); запрещён
 *         store.updateActiveCalc.
 * ============================================================ */

describe('audit #8 P1-1: storage.getReadStorage не доверяет _probedOk=false (write-flag)', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/services/storage.js'), 'utf8');

    /* Извлекаем тело getReadStorage через balanced { }. */
    function extractFnBody(name) {
        const idx = src.indexOf(`function ${name}(`);
        if (idx < 0) return null;
        const braceStart = src.indexOf('{', idx);
        let depth = 1;
        let i = braceStart + 1;
        while (i < src.length && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
        }
        return src.slice(braceStart, i);
    }

    it('getReadStorage НЕ имеет early-return по _probedOk===false', () => {
        const body = extractFnBody('getReadStorage');
        assert.ok(body, 'getReadStorage должна существовать');
        /* Прежний код имел `if (_probedOk === false) return _memoryStorage();`
         * — это и есть баг: write-probe fail (квота) лишал чтение реального
         * localStorage. Запрещаем такой return целиком. */
        assert.doesNotMatch(body, /if\s*\(\s*_probedOk\s*===\s*false\s*\)\s*return\s+_memoryStorage\s*\(/,
            'getReadStorage НЕ должна возвращать memory fallback по _probedOk===false. ' +
            'Этот флаг ставится в getStorage() при write-probe fail (quota ИЛИ private). ' +
            'При квоте read через localStorage.getItem работает; ранний return лишал бы ' +
            'пользователя видимости его реальных данных.');
    });

    it('getReadStorage пробует localStorage.getItem и catch'+'\'ит ошибку', () => {
        const body = extractFnBody('getReadStorage');
        assert.ok(body, 'getReadStorage должна существовать');
        assert.match(body, /localStorage\.getItem\s*\(/,
            'getReadStorage должна пробовать localStorage.getItem (даёт null при квоте).');
        assert.match(body, /catch[\s\S]*_memoryStorage\s*\(/,
            'catch должен вернуть memory fallback (Safari Private где getItem бросает).');
    });
});

describe('audit #8 P1-2: duplicateItem/duplicateQuestion возвращают {ok, id?, reason?}', () => {
    const TARGETS = [
        { path: 'js/controllers/itemController.js', fnName: 'duplicateItem' },
        { path: 'js/controllers/questionController.js', fnName: 'duplicateQuestion' }
    ];
    for (const t of TARGETS) {
        it(`${t.fnName}: контракт {ok, id?, reason?, message?}`, () => {
            const src = readFileSync(join(REPO_ROOT, t.path), 'utf8');
            const idx = src.indexOf(`export function ${t.fnName}`);
            assert.ok(idx >= 0, `${t.fnName}: функция должна существовать`);
            const braceStart = src.indexOf('{', idx);
            let depth = 1, i = braceStart + 1;
            while (i < src.length && depth > 0) {
                if (src[i] === '{') depth++;
                else if (src[i] === '}') depth--;
                i++;
            }
            const body = src.slice(braceStart, i);

            /* Должна быть проверка return от saveItem/saveQuestion. */
            assert.match(body, /(saveItem|saveQuestion)\s*\(\s*copy\s*\)/,
                `${t.fnName}: должен вызывать save*(copy)`);
            assert.match(body, /r\.ok\s*===\s*false|!\s*r/,
                `${t.fnName}: должен проверять r.ok === false (либо !r). ` +
                'Раньше игнорировал результат и возвращал copy.id при quota.');

            /* Контракт ok:true + id; ok:false + reason. */
            assert.match(body, /ok\s*:\s*true[\s\S]*id\s*:\s*copy\.id/,
                `${t.fnName}: success-ветка должна возвращать {ok:true, id: copy.id}.`);
            assert.match(body, /ok\s*:\s*false[\s\S]*reason\s*:\s*['"]persist['"]/,
                `${t.fnName}: persist-fail ветка должна возвращать {ok:false, reason:'persist'}.`);

            /* НЕ должен возвращать голый id или просто copy.id (без обёртки). */
            assert.doesNotMatch(body, /return\s+copy\.id\s*;/,
                `${t.fnName}: запрещён прямой return copy.id — caller не отличит ok от fail.`);
        });
    }
});

describe('audit #8 P2-1: priceImportMapping.applyPriceImport проброс refreshReason при ok:false', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/priceImportMappingController.js'), 'utf8');

    it('summary содержит refreshReason/refreshMessage и partial учитывает !refreshOk', () => {
        /* refreshOk-вычисление обязано существовать. */
        assert.match(src, /refreshOk\s*=\s*calcsResult\s*\?\s*calcsResult\.ok\s*!==\s*false\s*:\s*true/,
            'applyPriceImport должна вычислять refreshOk из calcsResult.ok. ' +
            'Раньше: только refreshErrors[]; full-failure ({ok:false, reason:locked-by-other-tab}) проходил тихо.');

        /* refreshReason / refreshMessage в summary. */
        assert.match(src, /refreshReason\s*:[^,\n]*calcsResult/,
            'summary должен содержать refreshReason (для UI snackbar message).');
        assert.match(src, /refreshMessage\s*:[^,\n]*calcsResult/,
            'summary должен содержать refreshMessage.');

        /* partial учитывает !refreshOk. */
        assert.match(src, /partial\s*:\s*refreshErrors\.length\s*>\s*0\s*\|\|\s*!refreshOk/,
            'partial должен быть true при refreshErrors.length > 0 ИЛИ !refreshOk. ' +
            'Иначе UI рапортует success при full refresh-failure.');
    });
});

describe('audit #8 P2-2: importItemPrices anomaly-ветка формирует свой message', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/controllers/itemController.js'), 'utf8');

    it('anomaly-блок НЕ доверяет r.message || ... (generic message лжёт)', () => {
        /* Находим anomaly-ветку через якорь «// Аномалии — только после явного» —
         * это начало секции в коде, до неё идёт safe-ветка. Берём оттуда до
         * следующего блока (return-statement в конце функции). */
        const anchorIdx = src.indexOf('// Аномалии — только после явного');
        assert.ok(anchorIdx >= 0, 'Якорный комментарий anomaly-блока должен существовать');
        /* Берём примерно до return-объекта функции (return { ok:true, updatesCount:... }).
         * Внешний аудит #18 (PATCH 2.19.5, P2, выбор 2A): regex-fix только.
         * Раньше indexOf искал точный '\n    return {\n        ok: true' — на
         * Windows clean clone с CRLF (autocrlf) подстрока не находилась →
         * тест падал в clean clone. Регулярка \r?\n устойчива к обоим line-endings. */
        const tail = src.slice(anchorIdx);
        const endMatch = tail.match(/\r?\n {4}return \{\r?\n {8}ok: true/);
        const endIdx = endMatch ? endMatch.index : -1;
        assert.ok(endIdx > 0, 'Конец anomaly-блока через return success должен существовать');
        const blockBody = tail.slice(0, endIdx);

        /* Конкретный message должен упоминать «Безопасные ... уже сохранены». */
        assert.match(blockBody, /Безопасные\s+изменения|Безопасные\s+цены/i,
            'anomaly persist-fail message должен явно упоминать что безопасные изменения сохранены. ' +
            'Раньше через `r.message ||` пробрасывался generic "Цены не применены...", который лжёт.');

        /* НЕ должно быть паттерна `message: r.message || '...'` в anomaly-блоке. */
        assert.doesNotMatch(blockBody, /message\s*:\s*r\.message\s*\|\|/,
            'anomaly-блок НЕ должен использовать `r.message || fallback` — этот pattern ' +
            'позволяет generic message пройти и обмануть пользователя. Формируйте конкретный message здесь.');
    });
});

describe('audit #8 P3-1: undo deleteQuestion answer restore — inverse pattern (commit ДО store)', () => {
    const src = readFileSync(join(REPO_ROOT, 'js/app.js'), 'utf8');

    it('app.js: восстановление backupAnswer через commitActiveCalc(restored) → store.setActiveCalc', () => {
        /* Ищем undo-callback по литералу 'Вопрос «${backup.title}» удалён'.
         * Это уникальная якорная строка undo-deletion вопроса. */
        const anchorIdx = src.indexOf('Вопрос «${backup.title}» удалён');
        assert.ok(anchorIdx >= 0, 'Якорная строка undo deleteQuestion должна существовать');

        /* Берём фрагмент ±2KB после якоря — достаточно для undo-callback'а. */
        const fragment = src.slice(anchorIdx, anchorIdx + 2500);

        /* Должен быть commitActiveCalc(restored) — inverse pattern. */
        assert.match(fragment, /commitActiveCalc\s*\(\s*restored\s*\)/,
            'undo deleteQuestion должен commit'+'ить локальный restored ДО store.setActiveCalc. ' +
            'Раньше: store.updateActiveCalc({answers:...}) → потом commit (store-first violation).');

        /* НЕ должен использовать store.updateActiveCalc для backupAnswer. */
        const backupAnswerRestoreMatch = fragment.match(/if\s*\(\s*backupAnswer\s*!==\s*undefined\s*\)\s*\{([\s\S]*?)\}\s*snackbar\.success\(['"]Восстановлено['"]/);
        if (backupAnswerRestoreMatch) {
            const block = backupAnswerRestoreMatch[1];
            assert.doesNotMatch(block, /store\.updateActiveCalc\s*\(/,
                'Блок восстановления backupAnswer НЕ должен использовать store.updateActiveCalc — ' +
                'только inverse pattern (commitActiveCalc(restored) → setActiveCalc(restored)).');
        }
    });
});
