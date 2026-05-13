/**
 * Общий кэш AST формул. Используется calculator.js, validation.js (lintFormulas)
 * и UI-модалками — устраняет тройной парсинг одной и той же строки.
 *
 * Ключ — исходная строка формулы. Значение:
 *   - null  — пустая или whitespace-only строка (qty = 0).
 *   - { __error: FormulaError } — формула не парсится; потребители проверяют поле.
 *   - AST-узел — успешный разбор.
 */

import { parseFormula } from './parser.js';

const CAPACITY = 256;
const _cache = new Map();

export function getAst(source) {
    if (!source || typeof source !== 'string') return null;
    const trimmed = source.trim();
    if (trimmed === '') return null;
    if (_cache.has(source)) {
        // LRU touch
        const v = _cache.get(source);
        _cache.delete(source);
        _cache.set(source, v);
        return v;
    }
    let ast;
    try { ast = parseFormula(source); }
    catch (e) { ast = { __error: e }; }
    if (_cache.size >= CAPACITY) {
        _cache.delete(_cache.keys().next().value);
    }
    _cache.set(source, ast);
    return ast;
}

/** Проверка: AST содержит ошибку парсинга. Возвращает строгий boolean. */
export function isAstError(ast) {
    return !!(ast && typeof ast === 'object' && ast.__error);
}

export function clearAstCache() {
    _cache.clear();
}
