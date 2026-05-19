/**
 * Архитектурный invariant — forcing function против повтора паттерна v8.30.0
 * PLANNER и обоих внешних аудитов 2026-05-18.
 *
 * Контекст:
 *   - Skill `review` §2 «после фикса искать родственные» — после первого
 *     внешнего аудита 2026-05-18 я починил P1-2 в apply-фазе bundleExport,
 *     но не тронул rollback-фазу той же функции; починил P2-2 в одной
 *     функции, не тронул соседнюю в том же файле. Аудитор #2 за час нашёл
 *     это и ещё 7 пунктов того же класса.
 *
 * Этот линтер ловит характерную форму бага автоматически: вызов
 * `persist.save*(...)` или `persist.removeCalc(...)` как expression-statement
 * без оборачивания return-значения проверкой или явного маркера best-effort.
 *
 * Разрешённые формы (не считаются нарушением):
 *   - `if (!persist.saveX(...)) { ... }`
 *   - `if (persist.saveX(...) === false) { ... }`
 *   - `const ok = persist.saveX(...);`
 *   - `return persist.saveX(...);`
 *   - `failures.push(...) || persist.saveX(...);` (any expression-context)
 *   - На той же строке или одной из двух следующих — комментарий
 *     `/* best-effort: ...` либо `// best-effort: ...` (явное намерение).
 *
 * Если новый код добавляет silent `persist.save*(...)` — тест упадёт, и
 * автор обязан либо проверить return, либо явно отметить best-effort.
 *
 * Что НЕ покрывается:
 *   - Wrappers `commitActiveCalc` / `commitNewCalc` / etc — это уже атомарные
 *     обёртки, их return-значение должно проверяться вызывающими (отдельный
 *     class ошибок, см. providerController.applyOverrideToActiveCalc P1-3).
 *     Линтер для них в этом же файле — `WRAPPER_FUNCTIONS`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

/* persist.save*  +  persist.removeCalc — методы с false-return контрактом. */
const PERSIST_METHODS = [
    'saveCalc',
    'saveCalcList',
    'saveDefaultDictionary',
    'saveActiveCalcId',
    'saveProviderOverride',
    'saveActiveTab',
    'saveTheme',
    'saveAdvancedModeEnabled',
    'saveQuestionnaireOpenSections',
    'saveQuestionnaireSettingsOpen',
    'saveQuestionnaireCollapsedSubgroups',
    'saveHealthLastTab',
    'saveHealthScoreTrend',
    'saveProviderAnalyticsVisibleCategories',
    'saveScenarioComparisonSelectedProviders',
    'saveDeltaHistoryExpandedProviders',
    'saveStandCardsCatsExpanded',
    'saveDetailsCollapsedCats',
    'saveComparisonCollapsedCats',
    'saveItemsCollapsedCats',
    'saveQuestionsCollapsedSecs',
    'saveComparisonSort',
    'saveSensitivityFilters',
    'saveProviderOverlayExpanded',
    'pushProviderOverrideHistory',
    'setProviderOverrideHistory'
];

/* Атомарные обёртки — их return ТОЖЕ должен проверяться. */
const WRAPPER_FUNCTIONS = [
    'commitActiveCalc',
    'commitNewCalc',
    'commitCalcRename',
    'commitMigratedCalc'
];

function walk(dir, accum = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const full = join(dir, name);
        const stat = statSync(full);
        if (stat.isDirectory()) walk(full, accum);
        else if (name.endsWith('.js')) accum.push(full);
    }
    return accum;
}

/**
 * Просканировать одну строку: содержит ли вызов одного из patterns в
 * expression-statement форме?
 *
 * Эвристика:
 *   - Найти первое вхождение `<pattern>(`.
 *   - Если ему предшествует на той же строке: `if (`/`while (`/`!`/`= `/
 *     `return `/`?? `/`|| `/`&& `/`?`/`,`/`(` (в составе выражения) — OK.
 *   - Если на предыдущей строке `if (` ещё не закрыт (multi-line условие) — OK.
 *     Простая эвристика: предыдущая строка содержит `if (` без `)` в конце.
 *   - Если строка сама по себе начинается (после трим) с pattern — нарушение.
 *
 * Best-effort маркер: на этой же строке или одной из двух предыдущих/
 * следующих есть `best-effort` в комментарии — нарушение пропускается.
 */
function findOffenses(src, label, patterns) {
    /* Важно: ищем best-effort маркер в ОРИГИНАЛЕ (с комментариями), а форму
     * вызова — на той же позиции в строках. Линии и offsets совпадают, потому
     * что мы не удаляем содержимое, только строки используем для проверок. */
    const rawLines = src.split('\n');
    const offenses = [];

    for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        const trimmed = raw.trim();
        /* Если строка целиком — комментарий или внутри строкового литерала,
         * пропускаем. Простая эвристика: строка-комментарий начинается с //
         * или /*. Кода в ней быть не должно. */
        if (trimmed.startsWith('//')) continue;
        if (trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

        for (const m of patterns) {
            const callPattern = `${m}(`;
            const idx = trimmed.indexOf(callPattern);
            if (idx === -1) continue;

            /* Контекст перед вызовом на этой же строке (если есть). */
            const before = trimmed.slice(0, idx);
            /* Допустимые формы — вызов внутри выражения. */
            if (/[!=<>?(,&|]\s*$/.test(before)) continue;
            if (/\breturn\s+$/.test(before)) continue;
            if (/\bawait\s+$/.test(before)) continue;
            if (/\bconst\s+\w+\s*=\s*$/.test(before)) continue;
            if (/\blet\s+\w+\s*=\s*$/.test(before)) continue;
            if (/\bvar\s+\w+\s*=\s*$/.test(before)) continue;
            if (/\w+\s*=\s*$/.test(before) && !/^\s*$/.test(before)) continue;
            /* `if (foo) <pattern>(...)` — после `)` без `{` (single-statement if). */
            if (/\)\s*$/.test(before)) continue;

            /* Предыдущая строка — multi-line if/return/assign? */
            const prev = (rawLines[i - 1] || '').trim();
            if (/\b(if|while|return)\s*\(/.test(prev) && !prev.endsWith(';') && !prev.endsWith('}')) continue;
            if (prev.endsWith('=') || prev.endsWith('&&') || prev.endsWith('||') || prev.endsWith('??') || prev.endsWith('?')) continue;

            /* Best-effort маркер: ищем в окне ±5 строк. Многострочный
             * комментарий-блок (3-5 строк) перед вызовом — частая форма. */
            const start = Math.max(0, i - 5);
            const end = Math.min(rawLines.length, i + 3);
            const window = rawLines.slice(start, end).join('\n');
            if (/best-effort/i.test(window)) continue;

            /* Это нарушение — silent call. */
            offenses.push({
                file: label,
                line: i + 1,
                method: m,
                snippet: trimmed.slice(0, 120)
            });
        }
    }
    return offenses;
}

describe('architecture invariant: persist.save* возврат не должен игнорироваться (audit-2 forcing function)', () => {
    it('persist.<save*|push*|set*> вызовы в js/ обёрнуты в проверку или best-effort', () => {
        const allFiles = walk(join(REPO_ROOT, 'js'));
        const offenses = [];
        for (const file of allFiles) {
            const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/');
            /* Сам persistence.js — определения, не вызовы; storage.js — нижний уровень. */
            if (rel.endsWith('/state/persistence.js')) continue;
            if (rel.endsWith('/services/storage.js')) continue;
            /* calcPersistence — атомарное ядро, его именно задача обернуть save'ы. */
            if (rel.endsWith('/services/calcPersistence.js')) continue;
            const src = readFileSync(file, 'utf8');
            /* Учитываем только файлы, которые реально вызывают persist.X. */
            if (!PERSIST_METHODS.some(m => src.includes(`persist.${m}(`))) continue;
            /* Префикс persist. — обращаемся как `persist.saveX(`. */
            const patterns = PERSIST_METHODS.map(m => `persist.${m}`);
            offenses.push(...findOffenses(src, rel, patterns));
        }
        assert.equal(
            offenses.length, 0,
            `Найдены silent persist.<save> вызовы (return игнорируется без best-effort маркера):\n` +
            offenses.map(o => `  ${o.file}:${o.line}  ${o.method}  →  ${o.snippet}`).join('\n') +
            `\n\nКаждый такой вызов либо должен быть обёрнут в проверку (if (!persist.X(...)) { ... }), ` +
            `либо помечен комментарием с подстрокой "best-effort" в окне ±2 строки (для случаев, ` +
            `где silent-failure намеренно допустим — UI-state, optional metadata).`
        );
    });

    it('commitActiveCalc / commitNewCalc / commitCalcRename / commitMigratedCalc вызовы — с проверкой return', () => {
        const allFiles = walk(join(REPO_ROOT, 'js'));
        const offenses = [];
        for (const file of allFiles) {
            const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/');
            if (rel.endsWith('/services/calcPersistence.js')) continue;
            const src = readFileSync(file, 'utf8');
            if (!WRAPPER_FUNCTIONS.some(w => src.includes(`${w}(`))) continue;
            offenses.push(...findOffenses(src, rel, WRAPPER_FUNCTIONS));
        }
        assert.equal(
            offenses.length, 0,
            `Найдены silent вызовы commitActive*/commitNew*/commitCalc*/commitMigrated*:\n` +
            offenses.map(o => `  ${o.file}:${o.line}  ${o.method}  →  ${o.snippet}`).join('\n') +
            `\n\nЭти функции возвращают false при quota-сбое — каждый caller должен либо ` +
            `проверить return, либо пометить best-effort (если silent-failure допустим, ` +
            `например когда autosave debounce будет повторно вызван через секунду).`
        );
    });
});
