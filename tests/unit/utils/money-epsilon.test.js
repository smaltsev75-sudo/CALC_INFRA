/**
 * 12.U32 #1: EPSILON_KOPECK + isZeroMoney() — порог различия для денежных
 * сумм. Защита от float-rounding в N×M умножениях (риск-факторы × VAT
 * накапливают остатки порядка 1e-12...1e-15).
 *
 * Контракт:
 *   - 0, +0, -0, NaN, Infinity → true
 *   - |value| < 0.005 → true (полкопейки)
 *   - |value| ≥ 0.005 → false
 *   - реальные суммы (>1 руб) → false
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EPSILON_KOPECK, isZeroMoney } from '../../../js/utils/constants.js';

describe('EPSILON_KOPECK / isZeroMoney (12.U32 #1)', () => {
    it('EPSILON_KOPECK = 0.005 руб (полкопейки)', () => {
        assert.equal(EPSILON_KOPECK, 0.005);
    });

    it('точный 0 → true', () => {
        assert.equal(isZeroMoney(0), true);
        assert.equal(isZeroMoney(-0), true);
        assert.equal(isZeroMoney(+0), true);
    });

    it('float-артефакты <0.005 → true', () => {
        assert.equal(isZeroMoney(1e-15), true);
        assert.equal(isZeroMoney(-1e-15), true);
        assert.equal(isZeroMoney(0.0001), true);
        assert.equal(isZeroMoney(-0.004), true);
    });

    it('значения >= EPSILON → false', () => {
        assert.equal(isZeroMoney(0.005), false);
        assert.equal(isZeroMoney(0.01), false);
        assert.equal(isZeroMoney(1), false);
        assert.equal(isZeroMoney(46_465_240), false);
    });

    it('NaN/Infinity → true (защита от protected agg бага)', () => {
        assert.equal(isZeroMoney(NaN), true);
        assert.equal(isZeroMoney(Infinity), true);
        assert.equal(isZeroMoney(-Infinity), true);
    });

    it('симулируем накопление из 6 умножений: 1 × 1.30 × 1.15 × 1.10 × 1.20 × 1.20 = 2.36808 (не ноль)', () => {
        // Реальная цепочка риск-факторов даёт ≈2.37 — точно НЕ ноль.
        const v = 1 * 1.30 * 1.15 * 1.10 * 1.20 * 1.20;
        assert.equal(isZeroMoney(v), false);
    });

    it('симулируем floating-point остаток после вычитания: 0.1 + 0.2 - 0.3 ≈ 5.5e-17', () => {
        const v = 0.1 + 0.2 - 0.3;  // ≈ 5.55e-17
        assert.equal(isZeroMoney(v), true,
            'классический IEEE 754 артефакт должен трактоваться как ноль');
    });
});

describe('comparison.js использует isZeroMoney вместо строгого === 0', () => {
    it('исходник comparison.js импортирует isZeroMoney', async () => {
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const __dirname = dirname(fileURLToPath(import.meta.url));
        const src = readFileSync(
            join(__dirname, '..', '..', '..', 'js', 'ui', 'comparison.js'),
            'utf8'
        );
        // Проверяем что импорт isZeroMoney присутствует
        assert.match(src, /import\s+\{[^}]*isZeroMoney[^}]*\}\s+from\s+['"][^'"]*constants\.js['"]/);
        // И что нет наивного `cell.value === 0` (вне комментариев)
        const stripComments = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
        assert.doesNotMatch(stripComments, /cell\.value\s*===\s*0\b/,
            'cell.value === 0 → должен быть isZeroMoney(cell.value) (epsilon-tolerant)');
    });
});
