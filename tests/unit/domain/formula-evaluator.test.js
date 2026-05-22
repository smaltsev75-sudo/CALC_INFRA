import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, FormulaError } from '../../../js/domain/formula/parser.js';
import { evaluate, collectReferences } from '../../../js/domain/formula/evaluator.js';
import { FORMULA_MAX_DEPTH } from '../../../js/utils/constants.js';

const evalStr = (src, ctx = {}) => evaluate(parseFormula(src), { Q: {}, S: {}, STAND: 'PROD', ...ctx });

describe('evaluator: arithmetic', () => {
    it('evaluates simple arithmetic', () => {
        assert.equal(evalStr('2 + 3'), 5);
        assert.equal(evalStr('10 - 4'), 6);
        assert.equal(evalStr('3 * 4'), 12);
        assert.equal(evalStr('20 / 4'), 5);
        assert.equal(evalStr('17 % 5'), 2);
    });
    it('respects precedence', () => {
        assert.equal(evalStr('2 + 3 * 4'), 14);
        assert.equal(evalStr('(2 + 3) * 4'), 20);
    });
    it('handles unary minus', () => {
        assert.equal(evalStr('-5'), -5);
        assert.equal(evalStr('-(2 + 3)'), -5);
        assert.equal(evalStr('--5'), 5);
    });
    it('handles division by zero gracefully', () => {
        // Спецификация: x/0 → 0 (silent), не Infinity.
        assert.equal(evalStr('10 / 0'), 0);
        assert.equal(evalStr('10 % 0'), 0);
    });
});

describe('evaluator: variables', () => {
    it('reads Q.<id>', () => {
        assert.equal(evalStr('Q.x', { Q: { x: 42 } }), 42);
    });
    it('returns 0 for missing Q.<id>', () => {
        assert.equal(evalStr('Q.missing'), 0);
    });
    it('uses questionDefaults if Q.<id> not in answers', () => {
        assert.equal(evalStr('Q.x', { Q: {}, questionDefaults: { x: 99 } }), 99);
    });
    it('reads S.<id>', () => {
        assert.equal(evalStr('S.bufferTask', { S: { bufferTask: 0.3 } }), 0.3);
    });
    it('reads S.<id>.<sub> (multi-level path)', () => {
        assert.equal(
            evalStr('S.standSizeRatio.DEV', { S: { standSizeRatio: { DEV: 0.5, PROD: 1.0 } } }),
            0.5
        );
    });
    it('returns 0 for missing intermediate segment', () => {
        assert.equal(evalStr('S.foo.bar', { S: { foo: { other: 1 } } }), 0);
        assert.equal(evalStr('S.foo.bar', { S: {} }), 0);
        assert.equal(evalStr('S.foo.bar', { S: { foo: null } }), 0);
    });
    it('returns 0 if final value is non-primitive', () => {
        // Формула должна брать терминальный скаляр, а не объект.
        assert.equal(evalStr('S.standSizeRatio', { S: { standSizeRatio: { DEV: 0.5 } } }), 0);
    });
    it('reads STAND as string', () => {
        assert.equal(evalStr('STAND', { STAND: 'PROD' }), 'PROD');
    });
    it('combines STAND with S-path lookup (via if/expression)', () => {
        // Имитируем seed-паттерн: множитель на размер стенда.
        const ctx = {
            S: { standSizeRatio: { DEV: 0.3, IFT: 0.5, PROD: 1.0 } },
            STAND: 'IFT'
        };
        assert.equal(evalStr('100 * S.standSizeRatio.IFT', ctx), 50);
    });
});

describe('evaluator: type coercion', () => {
    it('boolean → number', () => {
        assert.equal(evalStr('Q.x + 0', { Q: { x: true } }), 1);
        assert.equal(evalStr('Q.x + 0', { Q: { x: false } }), 0);
    });
    it('multiselect array → length (in arithmetic context)', () => {
        // Чтение Q.x возвращает массив; длина появляется при числовой коэрции.
        assert.equal(evalStr('Q.x + 0', { Q: { x: ['a', 'b', 'c'] } }), 3);
        assert.equal(evalStr('Q.x * 1', { Q: { x: ['a', 'b'] } }), 2);
    });
    it('string with comma decimal → number', () => {
        assert.equal(evalStr('Q.x + 0', { Q: { x: '1,5' } }), 1.5);
    });
    it('non-numeric string → 0', () => {
        assert.equal(evalStr('Q.x + 0', { Q: { x: 'abc' } }), 0);
    });
});

describe('evaluator: comparison', () => {
    it('numeric comparison', () => {
        assert.equal(evalStr('5 > 3'), true);
        assert.equal(evalStr('5 < 3'), false);
        assert.equal(evalStr('5 == 5'), true);
        assert.equal(evalStr('5 != 3'), true);
        assert.equal(evalStr('5 >= 5'), true);
        assert.equal(evalStr('5 <= 4'), false);
    });
    it('string comparison', () => {
        assert.equal(evalStr('STAND == "PROD"', { STAND: 'PROD' }), true);
        assert.equal(evalStr('STAND == "DEV"', { STAND: 'PROD' }), false);
    });
    it('mixed type comparison via String', () => {
        assert.equal(evalStr('Q.x == "100"', { Q: { x: '100' } }), true);
    });
});

describe('evaluator: logic', () => {
    it('&& short-circuits', () => {
        assert.equal(evalStr('false && Q.x', { Q: { x: 1 } }), false);
        assert.equal(evalStr('true && Q.x', { Q: { x: 1 } }), true);
    });
    it('||', () => {
        assert.equal(evalStr('true || false'), true);
        assert.equal(evalStr('false || false'), false);
    });
    it('!', () => {
        assert.equal(evalStr('!true'), false);
        assert.equal(evalStr('!false'), true);
        assert.equal(evalStr('!0'), true);
        assert.equal(evalStr('!1'), false);
    });
});

describe('evaluator: built-in functions', () => {
    it('min/max', () => {
        assert.equal(evalStr('min(1, 2, 3)'), 1);
        assert.equal(evalStr('max(1, 2, 3)'), 3);
    });
    it('round/ceil/floor/abs', () => {
        assert.equal(evalStr('round(2.4)'), 2);
        assert.equal(evalStr('round(2.5)'), 3);
        assert.equal(evalStr('ceil(2.1)'), 3);
        assert.equal(evalStr('floor(2.9)'), 2);
        assert.equal(evalStr('abs(-5)'), 5);
    });
    it('clamp', () => {
        assert.equal(evalStr('clamp(15, 0, 10)'), 10);
        assert.equal(evalStr('clamp(-5, 0, 10)'), 0);
        assert.equal(evalStr('clamp(5, 0, 10)'), 5);
    });
    it('if as ternary (lazy)', () => {
        assert.equal(evalStr('if(true, 100, 200)'), 100);
        assert.equal(evalStr('if(false, 100, 200)'), 200);
    });
    it('if rejects wrong arity', () => {
        assert.throws(() => evalStr('if(true, 1)'));
    });
    it('rejects unknown function', () => {
        assert.throws(() => evalStr('eval(1)'));
    });
});

describe('evaluator: collectReferences', () => {
    it('collects Q.* and S.* (refs are arrays)', () => {
        const refs = collectReferences(parseFormula('Q.pcu * 2 + S.bufferTask'));
        assert.deepEqual(refs.questions.sort(), ['pcu']);
        assert.deepEqual(refs.settings.sort(), ['bufferTask']);
    });
    it('collects multi-level S.* as dotted path', () => {
        const refs = collectReferences(parseFormula('S.standSizeRatio.DEV + S.bufferTask'));
        assert.deepEqual(refs.settings.sort(), ['bufferTask', 'standSizeRatio.DEV']);
    });
    it('collects function names', () => {
        const refs = collectReferences(parseFormula('if(Q.x > 0, max(1,2), 0)'));
        assert.ok(refs.functions.includes('if'));
        assert.ok(refs.functions.includes('max'));
    });
    it('detects STAND usage', () => {
        const refs = collectReferences(parseFormula('STAND == "PROD"'));
        assert.equal(refs.usesStand, true);
    });
});

describe('evaluator: edge cases', () => {
    it('Infinity propagates', () => {
        assert.equal(evalStr('1e308 * 10'), Infinity);
    });
    it('does not allow prototype access', () => {
        // Q.constructor — должен вернуть 0, не Object()
        assert.equal(evalStr('Q.constructor', { Q: {} }), 0);
    });
});

describe('evaluator: stack-depth guard', () => {
    // Хелпер: формула вида if(1, if(1, ... , 0), 0) глубиной N уровней.
    // Глубина рекурсии evaluate() для листа = N (каждый if добавляет 1 уровень).
    function deepFormula(depth) {
        let f = '1';
        for (let i = 0; i < depth; i++) {
            f = `if(1, ${f}, 0)`;
        }
        return f;
    }

    it('простая формула без вложенности — работает', () => {
        // Контрольный тест: убедиться, что guard не ломает обычный flow.
        assert.equal(evalStr('1 + 2'), 3);
    });

    it(`глубина FORMULA_MAX_DEPTH (${FORMULA_MAX_DEPTH}) — успешно вычисляется`, () => {
        const ast = parseFormula(deepFormula(FORMULA_MAX_DEPTH));
        // Не должно бросать; глубочайший узел оказывается ровно на границе.
        assert.equal(evaluate(ast, { Q: {}, S: {}, STAND: 'PROD' }), 1);
    });

    it(`глубина FORMULA_MAX_DEPTH + 1 (${FORMULA_MAX_DEPTH + 1}) — бросает FormulaError`, () => {
        const ast = parseFormula(deepFormula(FORMULA_MAX_DEPTH + 1));
        assert.throws(
            () => evaluate(ast, { Q: {}, S: {}, STAND: 'PROD' }),
            (err) => err instanceof FormulaError && /Глубина/.test(err.message)
        );
    });

    it('сильно превышенная глубина (70) — даёт чистую FormulaError, не RangeError', () => {
        const ast = parseFormula(deepFormula(70));
        assert.throws(
            () => evaluate(ast, { Q: {}, S: {}, STAND: 'PROD' }),
            FormulaError
        );
    });
});
