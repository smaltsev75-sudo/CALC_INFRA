/**
 * Auto-suggestion logic for Price Import Mapping Assistant.
 */

import {
    KNOWN_ALIASES,
    normalize,
    tokenize,
    jaccard
} from './priceImportMappingRows.js';
/* ============================================================
 * Suggest mappings — auto-match rows к internal items
 * ============================================================ */

/**
 * Для каждой нормализованной строки предлагает internal item id с уровнем
 * уверенности. Возвращает Map<rowId, { itemId, confidence, reason }> | null
 * (если совпадений нет).
 *
 * Правила:
 *   high   — exact id match | exact alias match | exact name match (нормализованный)
 *   medium — token overlap ≥ 0.5 + same category/unit hint
 *   low    — token overlap ≥ 0.3
 *   none   — ниже порога (rowId не попадает в результат)
 *
 * @param {Array} normalizedRows — результат normalizeRows()
 * @param {Array<{ id, name, category? }>} knownItems — список internal ЭК
 * @returns {Object} map rowId → suggestion
 */
export function suggestItemMappings(normalizedRows, knownItems) {
    const result = {};
    if (!Array.isArray(normalizedRows) || !Array.isArray(knownItems)) return result;
    if (knownItems.length === 0) return result;

    // Индексы для быстрого matching
    const itemById   = new Map(knownItems.map(it => [it.id, it]));
    const itemByName = new Map(knownItems.map(it => [normalize(it.name || ''), it]));
    const itemTokens = knownItems.map(it => ({
        item: it,
        tokens: tokenize(`${it.name || ''} ${it.category || ''}`)
    }));

    for (const row of normalizedRows) {
        const sug = suggestForRow(row, itemById, itemByName, itemTokens);
        if (sug && sug.confidence !== 'none') {
            result[row.rowId] = sug;
        }
    }
    return result;
}

function suggestForRow(row, itemById, itemByName, itemTokens) {
    // 1. Exact id match
    if (row.sourceId && itemById.has(row.sourceId)) {
        return { itemId: row.sourceId, confidence: 'high', reason: 'exact-id' };
    }
    // 2. Exact alias match
    const candidate = row.sourceName || row.sourceId;
    if (candidate) {
        const aliasKey = normalize(candidate);
        const aliased = KNOWN_ALIASES[aliasKey];
        if (aliased && itemById.has(aliased)) {
            return { itemId: aliased, confidence: 'high', reason: 'alias' };
        }
    }
    // 3. Exact name match (normalized)
    if (candidate) {
        const nameKey = normalize(candidate);
        const namedItem = itemByName.get(nameKey);
        if (namedItem) {
            return { itemId: namedItem.id, confidence: 'high', reason: 'exact-name' };
        }
    }
    // 4. Token overlap
    const rowTokens = tokenize(`${row.sourceName || ''} ${row.sourceCategory || ''} ${row.sourceUnit || ''}`);
    if (rowTokens.length === 0) {
        return { itemId: null, confidence: 'none', reason: 'no-tokens' };
    }
    let best = { itemId: null, score: 0 };
    for (const { item, tokens } of itemTokens) {
        if (tokens.length === 0) continue;
        const score = jaccard(rowTokens, tokens);
        if (score > best.score) {
            best = { itemId: item.id, score };
        }
    }
    if (best.score >= 0.5) {
        return { itemId: best.itemId, confidence: 'medium', reason: `token-overlap-${best.score.toFixed(2)}` };
    }
    if (best.score >= 0.3) {
        return { itemId: best.itemId, confidence: 'low', reason: `token-overlap-${best.score.toFixed(2)}` };
    }
    return { itemId: null, confidence: 'none', reason: 'no-match' };
}
