/**
 * Дополнительное покрытие веток evaluator.js (12.U32 #4):
 * defensive throws (unknown scope/unary/binary/node type), все BUILTINS
 * по отдельности, collectReferences по каждому AST-типу, edge-cases в toNum.
 *
 * Базовый файл evaluator.test.js покрывает arithmetic + happy path.
 * Этот файл целит на 51% → 80%+ branches путём прицельного синтеза AST.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, FormulaError } from '../../../js/domain/formula/parser.js';
import { evaluate, collectReferences } from '../../../js/domain/formula/evaluator.js';

const ctx = (over = {}) => ({ Q: {}, S: {}, STAND: 'PROD', questionDefaults: {}, ...over });

/* ============================================================
 * Defensive throws — каждая «недостижимая» ветвь покрыта
 * ============================================================ */

describe('evaluator: defensive throws (12.U32 coverage)', () => {
    it('Var с unknown scope бросает FormulaError', () => {
        assert.throws(
            () => evaluate({ type: 'Var', scope: 'X', path: ['foo'] }, ctx()),
            (e) => e instanceof FormulaError && /scope/i.test(e.message)
        );
    });

    it('UnaryOp с неизвестным op бросает', () => {
        assert.throws(
            () => evaluate({ type: 'UnaryOp', op: '?', arg: { type: 'Number', value: 1 } }, ctx()),
            (e) => e instanceof FormulaError && /унарный/i.test(e.message)
        );
    });

    it('BinOp с неизвестным op бросает', () => {
        assert.throws(
            () => evaluate({
                type: 'BinOp', op: '@@',
                left:  { type: 'Number', value: 1 },
                right: { type: 'Number', value: 2 }
            }, ctx()),
            (e) => e instanceof FormulaError && /оператор/i.test(e.message)
        );
    });

    it('узел с неизвестным type бросает', () => {
        assert.throws(
            () => evaluate({ type: 'WeirdNode' }, ctx()),
            (e) => e instanceof FormulaError && /тип узла/i.test(e.message)
        );
    });

    it('Call с неизвестным именем бросает', () => {
        assert.throws(
            () => evaluate({ type: 'Call', name: 'evil', args: [] }, ctx()),
            (e) => e instanceof FormulaError && /функция/i.test(e.message)
        );
    });

    it('if() с не-3 аргументами бросает', () => {
        assert.throws(
            () => evaluate({
                type: 'Call', name: 'if',
                args: [{ type: 'Bool', value: true }, { type: 'Number', value: 1 }]
            }, ctx()),
            (e) => e instanceof FormulaError && /3 аргумента/i.test(e.message)
        );
    });
});

/* ============================================================
 * BUILTINS — каждая функция whitelist'а
 * ============================================================ */

describe('evaluator: BUILTINS (12.U32 coverage)', () => {
    const ev = (src) => evaluate(parseFormula(src), ctx());

    it('min/max', () => {
        assert.equal(ev('min(3, 1, 2)'), 1);
        assert.equal(ev('max(3, 1, 2)'), 3);
        assert.equal(ev('min(5)'), 5);
    });

    it('round/ceil/floor/abs', () => {
        assert.equal(ev('round(2.4)'), 2);
        assert.equal(ev('round(2.6)'), 3);
        assert.equal(ev('ceil(2.1)'), 3);
        assert.equal(ev('floor(2.9)'), 2);
        assert.equal(ev('abs(-5)'), 5);
        assert.equal(ev('abs(5)'), 5);
    });

    it('clamp', () => {
        assert.equal(ev('clamp(5, 0, 10)'), 5);
        assert.equal(ev('clamp(-3, 0, 10)'), 0);
        assert.equal(ev('clamp(15, 0, 10)'), 10);
    });

    it('if() lazy — false-ветвь не вычисляет true-ветвь (нет throw)', () => {
        // Если бы if был не ленивый, обращение к Q.required упало бы при отсутствии.
        // С lazy — Q.required не нужен, потому что cond=false.
        assert.equal(ev('if(false, 1/0, 42)'), 42);
        assert.equal(ev('if(true, 99, 1/0)'), 99);
    });
});

/* ============================================================
 * toNum / toBool — edge cases
 * ============================================================ */

describe('evaluator: toNum/toBool edge cases (12.U32 coverage)', () => {
    it('строка через запятую корректно парсится', () => {
        // toNum заменяет ',' → '.' и parseFloat'ит.
        const r = evaluate(parseFormula('Q.x + 1'), ctx({ Q: { x: '2,5' } }));
        assert.equal(r, 3.5);
    });

    it('строка-мусор → 0', () => {
        const r = evaluate(parseFormula('Q.x + 5'), ctx({ Q: { x: 'abc' } }));
        assert.equal(r, 5);
    });

    it('массив (multiselect) → длина в арифметике', () => {
        const r = evaluate(parseFormula('Q.tags + 0'), ctx({ Q: { tags: ['a', 'b', 'c'] } }));
        assert.equal(r, 3);
    });

    it('null в ответе → 0 (toNum fallback)', () => {
        const r = evaluate(parseFormula('Q.x + 7'), ctx({ Q: { x: null } }));
        assert.equal(r, 7);
    });

    it('boolean → 0/1 в арифметике', () => {
        assert.equal(evaluate(parseFormula('Q.f + 0'), ctx({ Q: { f: false } })), 0);
        assert.equal(evaluate(parseFormula('Q.t + 0'), ctx({ Q: { t: true } })), 1);
    });

    it('toBool: пустой массив → false, непустой → true', () => {
        assert.equal(evaluate(parseFormula('!Q.x'), ctx({ Q: { x: [] } })), true);
        assert.equal(evaluate(parseFormula('!Q.x'), ctx({ Q: { x: [1] } })), false);
    });

    it('toBool: строка "false"/"0"/"" → false', () => {
        assert.equal(evaluate(parseFormula('!Q.x'), ctx({ Q: { x: 'false' } })), true);
        assert.equal(evaluate(parseFormula('!Q.x'), ctx({ Q: { x: '0' } })), true);
        assert.equal(evaluate(parseFormula('!Q.x'), ctx({ Q: { x: '' } })), true);
        assert.equal(evaluate(parseFormula('!Q.x'), ctx({ Q: { x: 'yes' } })), false);
    });
});

/* ============================================================
 * resolveQuestion / resolveSettingPath — edge cases
 * ============================================================ */

describe('evaluator: resolve* edge cases (12.U32 coverage)', () => {
    it('Q.<id> с defaultValue из questionDefaults', () => {
        const r = evaluate(parseFormula('Q.foo'),
            ctx({ Q: {}, questionDefaults: { foo: 42 } }));
        assert.equal(r, 42);
    });

    it('Q.<id> когда нет ни в Q ни в defaults → 0', () => {
        assert.equal(evaluate(parseFormula('Q.absent'), ctx()), 0);
    });

    it('S.<path> к несуществующему сегменту → 0', () => {
        const r = evaluate(parseFormula('S.foo.bar'), ctx({ S: { foo: {} } }));
        assert.equal(r, 0);
    });

    it('S.<path> где терминал — массив (не примитив) → 0', () => {
        const r = evaluate(parseFormula('S.list'),
            ctx({ S: { list: [1, 2, 3] } }));
        assert.equal(r, 0);
    });

    it('S.<path> где терминал — объект → 0', () => {
        const r = evaluate(parseFormula('S.obj'),
            ctx({ S: { obj: { x: 1 } } }));
        assert.equal(r, 0);
    });

    it('S.<path> где терминал — строка → строка', () => {
        const r = evaluate(parseFormula('S.period'),
            ctx({ S: { period: 'monthly' } }));
        assert.equal(r, 'monthly');
    });
});

/* ============================================================
 * Сравнения и логика — все ветви BinOp
 * ============================================================ */

describe('evaluator: comparison/logical ops (12.U32 coverage)', () => {
    const ev = (src, c = {}) => evaluate(parseFormula(src), ctx(c));

    it('< <= > >=', () => {
        assert.equal(ev('1 < 2'), true);
        assert.equal(ev('2 < 1'), false);
        assert.equal(ev('1 <= 1'), true);
        assert.equal(ev('1 > 0'), true);
        assert.equal(ev('1 >= 1'), true);
    });

    it('==/!= — численные', () => {
        assert.equal(ev('1 == 1'), true);
        assert.equal(ev('1 == 2'), false);
        assert.equal(ev('1 != 2'), true);
    });

    it('==/!= — обе строки', () => {
        assert.equal(ev('STAND == "PROD"'), true);
        assert.equal(ev('STAND != "DEV"'), true);
    });

    it('==/!= — смешанные типы (string + number)', () => {
        // Один из операндов строка → сравнение через String()
        assert.equal(ev('Q.x == "5"', { Q: { x: 5 } }), true);
        assert.equal(ev('Q.x == "5"', { Q: { x: 6 } }), false);
    });

    it('&& и || — короткое замыкание', () => {
        // если a=false, b не вычисляется → нет throw
        assert.equal(ev('false && (1/0)'), false);
        assert.equal(ev('true  || (1/0)'), true);
    });

    it('Stand узел возвращает context.STAND', () => {
        assert.equal(evaluate({ type: 'Stand' }, ctx({ STAND: 'DEV' })), 'DEV');
    });

    it('Stand узел без context.STAND → пустая строка', () => {
        assert.equal(evaluate({ type: 'Stand' }, { Q: {}, S: {} }), '');
    });

    it('null-узел → 0', () => {
        assert.equal(evaluate(null, ctx()), 0);
    });
});

/* ============================================================
 * collectReferences — по каждому AST-типу
 * ============================================================ */

describe('collectReferences: каждый AST-узел (12.U32 coverage)', () => {
    it('Q-ссылки', () => {
        const r = collectReferences(parseFormula('Q.foo + Q.bar'));
        assert.deepEqual(r.questions.sort(), ['bar', 'foo']);
    });

    it('S-ссылки одно- и многоуровневые', () => {
        const r = collectReferences(parseFormula('S.kInflation + S.standSizeRatio.DEV'));
        assert.deepEqual(r.settings.sort(), ['kInflation', 'standSizeRatio.DEV']);
    });

    it('STAND флаг', () => {
        const r = collectReferences(parseFormula('STAND == "DEV"'));
        assert.equal(r.usesStand, true);
        assert.deepEqual(r.questions, []);
    });

    it('functions whitelist собирается', () => {
        const r = collectReferences(parseFormula('min(Q.a, max(Q.b, 5))'));
        assert.deepEqual(r.functions.sort(), ['max', 'min']);
    });

    it('UnaryOp обходится', () => {
        const r = collectReferences(parseFormula('-Q.x'));
        assert.deepEqual(r.questions, ['x']);
    });

    it('BinOp обходит обе стороны', () => {
        const r = collectReferences(parseFormula('Q.left * Q.right'));
        assert.deepEqual(r.questions.sort(), ['left', 'right']);
    });

    it('null-узел не падает', () => {
        const r = collectReferences(null);
        assert.deepEqual(r.questions, []);
        assert.deepEqual(r.settings,  []);
        assert.deepEqual(r.functions, []);
        assert.equal(r.usesStand, false);
    });

    it('сложное выражение: if(Q.cond, S.a, S.b.c) + STAND', () => {
        const r = collectReferences(parseFormula('if(Q.cond, S.a, S.b.c)'));
        assert.deepEqual(r.questions, ['cond']);
        assert.deepEqual(r.settings.sort(), ['a', 'b.c']);
        assert.deepEqual(r.functions, ['if']);
    });
});
