import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFormula, FormulaError } from '../../../js/domain/formula/parser.js';

describe('parser: numbers', () => {
    it('parses integers', () => {
        const ast = parseFormula('42');
        assert.deepEqual(ast, { type: 'Number', value: 42 });
    });
    it('parses floats with dot', () => {
        const ast = parseFormula('3.14');
        assert.deepEqual(ast, { type: 'Number', value: 3.14 });
    });
    it('parses floats starting with dot', () => {
        const ast = parseFormula('.5');
        assert.deepEqual(ast, { type: 'Number', value: 0.5 });
    });
    it('parses exponent notation', () => {
        assert.equal(parseFormula('1e10').value, 1e10);
        assert.equal(parseFormula('2.5e-3').value, 2.5e-3);
        assert.equal(parseFormula('1.5e+2').value, 150);
        assert.equal(parseFormula('5E5').value, 500000);
    });
    it('rejects standalone dot', () => {
        assert.throws(() => parseFormula('.'), FormulaError);
    });
});

describe('parser: arithmetic', () => {
    it('parses simple addition', () => {
        const ast = parseFormula('1 + 2');
        assert.equal(ast.type, 'BinOp');
        assert.equal(ast.op, '+');
    });
    it('respects operator precedence', () => {
        const ast = parseFormula('2 + 3 * 4');
        assert.equal(ast.op, '+');
        assert.equal(ast.right.op, '*');
    });
    it('respects parentheses', () => {
        const ast = parseFormula('(2 + 3) * 4');
        assert.equal(ast.op, '*');
        assert.equal(ast.left.op, '+');
    });
    it('parses unary minus', () => {
        const ast = parseFormula('-5');
        assert.equal(ast.type, 'UnaryOp');
        assert.equal(ast.op, '-');
    });
});

describe('parser: identifiers', () => {
    it('parses Q.<id>', () => {
        const ast = parseFormula('Q.pcu');
        assert.deepEqual(ast, { type: 'Var', scope: 'Q', path: ['pcu'] });
    });
    it('parses S.<id>', () => {
        const ast = parseFormula('S.bufferTask');
        assert.deepEqual(ast, { type: 'Var', scope: 'S', path: ['bufferTask'] });
    });
    it('parses S.<id>.<sub> (multi-level for settings)', () => {
        const ast = parseFormula('S.standSizeRatio.DEV');
        assert.deepEqual(ast, { type: 'Var', scope: 'S', path: ['standSizeRatio', 'DEV'] });
    });
    it('parses S.<id>.<sub>.<deeper> (3+ levels)', () => {
        const ast = parseFormula('S.a.b.c');
        assert.deepEqual(ast, { type: 'Var', scope: 'S', path: ['a', 'b', 'c'] });
    });
    it('rejects Q.<id>.<sub> (Q is single-level)', () => {
        assert.throws(() => parseFormula('Q.foo.bar'), FormulaError);
    });
    it('parses STAND', () => {
        assert.deepEqual(parseFormula('STAND'), { type: 'Stand' });
    });
    it('parses true/false', () => {
        assert.equal(parseFormula('true').value, true);
        assert.equal(parseFormula('false').value, false);
    });
    it('rejects unknown bare identifier', () => {
        assert.throws(() => parseFormula('foo'), FormulaError);
    });
});

describe('parser: function calls', () => {
    it('parses min/max', () => {
        const ast = parseFormula('min(1, 2, 3)');
        assert.equal(ast.type, 'Call');
        assert.equal(ast.name, 'min');
        assert.equal(ast.args.length, 3);
    });
    it('parses if(cond, a, b)', () => {
        const ast = parseFormula('if(1 > 0, 100, 200)');
        assert.equal(ast.name, 'if');
        assert.equal(ast.args.length, 3);
    });
    it('parses nested calls', () => {
        const ast = parseFormula('max(min(1, 2), 3)');
        assert.equal(ast.name, 'max');
        assert.equal(ast.args[0].name, 'min');
    });
    it('parses no-arg call', () => {
        // не используется, но синтаксически валидно
        assert.doesNotThrow(() => parseFormula('min()'));
    });
});

describe('parser: comparison and logic', () => {
    it('parses comparisons', () => {
        for (const op of ['<', '<=', '>', '>=', '==', '!=']) {
            const ast = parseFormula(`1 ${op} 2`);
            assert.equal(ast.op, op);
        }
    });
    it('parses && and ||', () => {
        assert.equal(parseFormula('true && false').op, '&&');
        assert.equal(parseFormula('true || false').op, '||');
    });
    it('parses unary !', () => {
        const ast = parseFormula('!true');
        assert.equal(ast.type, 'UnaryOp');
        assert.equal(ast.op, '!');
    });
});

describe('parser: strings', () => {
    it('parses double-quoted strings', () => {
        assert.equal(parseFormula('"hello"').value, 'hello');
    });
    it('parses single-quoted strings', () => {
        assert.equal(parseFormula("'hello'").value, 'hello');
    });
    it('rejects unterminated string', () => {
        assert.throws(() => parseFormula('"unterminated'), FormulaError);
    });
});

describe('parser: errors', () => {
    it('throws on empty paren', () => {
        // ()  — empty group; min() is OK but () is invalid
        assert.throws(() => parseFormula('()'), FormulaError);
    });
    it('throws on dangling operator', () => {
        assert.throws(() => parseFormula('1 +'), FormulaError);
    });
    it('throws on extra tokens', () => {
        assert.throws(() => parseFormula('1 2'), FormulaError);
    });
    it('throws on unknown character', () => {
        assert.throws(() => parseFormula('1 # 2'), FormulaError);
    });
    it('returns null for empty input', () => {
        assert.equal(parseFormula(''), null);
        assert.equal(parseFormula('   '), null);
    });
    it('throws on non-string input', () => {
        assert.throws(() => parseFormula(null), FormulaError);
    });
});

describe('parser: real seed-like formulas', () => {
    it('parses if(Q.pcu >= 100, 7, 5)', () => {
        const ast = parseFormula('if(Q.pcu >= 100, 7, 5)');
        assert.equal(ast.type, 'Call');
        assert.equal(ast.name, 'if');
    });
    it('parses if(Q.uses_llm, max(0.1, Q.tokens * 0.05), 0)', () => {
        const ast = parseFormula('if(Q.uses_llm, max(0.1, Q.tokens * 0.05), 0)');
        assert.equal(ast.name, 'if');
        assert.equal(ast.args[1].name, 'max');
    });
    it('parses ceil(Q.pcu/30)', () => {
        const ast = parseFormula('ceil(Q.pcu/30)');
        assert.equal(ast.name, 'ceil');
    });
});
