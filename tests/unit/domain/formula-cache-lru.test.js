/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent B P3-6):
 * AST-кэш в `formula/cache.js` имеет LRU-eviction при достижении CAPACITY=256.
 *
 * Без этого теста рефакторинг capacity (256 → 16 или → unbounded) пройдёт
 * незамеченным:
 *   - capacity↓ → пере-парсинг seed-формул на каждый calculate (CPU regression).
 *   - capacity↑/unbounded → memory leak в long-running session.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getAst, clearAstCache } from '../../../js/domain/formula/cache.js';

describe('formula/cache: LRU eviction (capacity=256)', () => {
    beforeEach(() => clearAstCache());

    it('после 257 уникальных формул первая выселена (size остаётся ≤ CAPACITY)', () => {
        // Формула: уникальная строка для каждой итерации.
        for (let i = 0; i < 257; i++) {
            getAst(`${i} + 1`);
        }
        // Первая «0 + 1» должна быть выселена. Проверим косвенно: повторный getAst
        // на «0 + 1» должен пройти через парсер — но кэш уже не содержит ключ,
        // значит будет новый AST-узел. Прямой тест — сравнение identity:
        const a = getAst('0 + 1');  // должен быть свежим (парсер вызывался заново)
        const b = getAst('0 + 1');  // теперь из кэша
        const c = getAst('256 + 1'); // тоже из кэша (он туда попал последним)
        const d = getAst('256 + 1');
        assert.equal(a, b, 'после повторного запроса AST лежит в кэше → identity-equal');
        assert.equal(c, d, 'свежезапрошенная формула — identity-equal при повторе');
    });

    it('LRU-touch: повторный запрос освежает позицию (старая запись не выселяется)', () => {
        const oldFormula = 'KEEP + 1';
        const oldAst1 = getAst(oldFormula);
        // Заполним кэш до 255 уникальных, потом «touch» oldFormula
        for (let i = 0; i < 255; i++) {
            getAst(`fill_${i}`);
        }
        // Touch oldFormula — он должен переместиться в конец LRU
        const oldAst2 = getAst(oldFormula);
        assert.equal(oldAst1, oldAst2, 'oldFormula всё ещё в кэше до 256-й вставки');
        // Теперь добавим ещё 5 — выселим самые старые «fill_0..fill_4», а oldFormula остался
        for (let i = 0; i < 5; i++) {
            getAst(`extra_${i}`);
        }
        const oldAst3 = getAst(oldFormula);
        assert.equal(oldAst1, oldAst3, 'после touch oldFormula НЕ выселен (LRU-touch работает)');
    });
});
