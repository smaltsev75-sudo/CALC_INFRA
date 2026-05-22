import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAst, isAstError, clearAstCache } from '../../../js/domain/formula/cache.js';

describe('formula AST cache', () => {
    it('returns null for empty/whitespace', () => {
        assert.equal(getAst(''), null);
        assert.equal(getAst('   '), null);
        assert.equal(getAst(null), null);
        assert.equal(getAst(undefined), null);
    });
    it('returns same AST instance for repeated calls', () => {
        clearAstCache();
        const a = getAst('1 + 2');
        const b = getAst('1 + 2');
        assert.equal(a, b);
    });
    it('captures parse errors', () => {
        const r = getAst('1 + +');
        assert.ok(isAstError(r));
    });
    it('isAstError on valid AST returns false', () => {
        const r = getAst('1 + 2');
        assert.equal(isAstError(r), false);
    });
    it('clearAstCache forces re-parse', () => {
        const a = getAst('5 * 6');
        clearAstCache();
        const b = getAst('5 * 6');
        assert.notEqual(a, b);
    });
});
