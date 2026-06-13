/**
 * Архитектурный invariant (forcing function для RISK-2, состязательное ревью 2026-06-13).
 *
 * Контракт: `calcRevision` — поле STORE-ROOT (`store._state.calcRevision`,
 * инкрементируется в store.js при setActiveCalc/updateActiveCalc), оно НИКОГДА
 * не пишется на объект расчёта (`calc`). Поэтому чтение `calc.calcRevision`
 * (или `calc?.calcRevision`) ВСЕГДА возвращает undefined → `?? null` → null →
 * `calculate()`/sensitivity-memo постоянно обходят кэш (контракт-дрейф).
 *
 * До фикса нарушали 4 потребителя (budgetGuardrails.js, budgetGuardrailsController.js,
 * decisionMemoController.js, sensitivityAnalysisModal.js). Правильный источник
 * revision: `store.getState().calcRevision` (controllers) / `state.calcRevision`
 * (UI render) — ЛИБО memo по идентичности объекта calc (он всегда новый при
 * мутации store), что не требует revision вовсе.
 *
 * Этот тест сканирует js/ и падает, если где-то снова читается `calc.calcRevision`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const JS_ROOT = join(REPO_ROOT, 'js');

function walkJs(rootDir) {
    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSync(dir); }
        catch { continue; }
        for (const name of entries) {
            const full = join(dir, name);
            let s;
            try { s = statSync(full); }
            catch { continue; }
            if (s.isDirectory()) stack.push(full);
            else if (s.isFile() && full.endsWith('.js')) out.push(full);
        }
    }
    out.sort();
    return out;
}

/* Ловит `calc.calcRevision` и `calc?.calcRevision` (любой пробельный стиль).
   НЕ ловит `state.calcRevision` / `getState().calcRevision` / `_state.calcRevision`
   — там перед `.calcRevision` нет токена `calc`. */
const FORBIDDEN_RE = /\bcalc\s*\??\s*\.\s*calcRevision\b/;

describe('Architecture: calcRevision читается из store, а не с объекта calc (RISK-2)', () => {
    const jsFiles = walkJs(JS_ROOT);

    it('обход js/ нашёл хотя бы один .js файл', () => {
        assert.ok(jsFiles.length > 0, 'Не найден ни один .js в ' + JS_ROOT);
    });

    for (const file of jsFiles) {
        const rel = relative(REPO_ROOT, file);
        it(`${rel} — не читает calc.calcRevision`, () => {
            const src = readFileSync(file, 'utf8');
            const lines = src.split('\n');
            const hits = [];
            lines.forEach((line, idx) => {
                // Пропускаем строки-комментарии: пояснения легитимно упоминают
                // прежний антипаттерн calc.calcRevision как документацию.
                // Реальный код-доступ не начинается с маркера комментария.
                const t = line.trim();
                if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
                if (FORBIDDEN_RE.test(line)) hits.push(`${rel}:${idx + 1}: ${t}`);
            });
            assert.equal(hits.length, 0,
                'Найдено чтение calc.calcRevision (поле живёт только на store-root, ' +
                'всегда undefined на calc → кэш обходится). Используйте ' +
                'store.getState().calcRevision / state.calcRevision, либо memo по ' +
                'идентичности объекта calc:\n' + hits.join('\n'));
        });
    }
});
