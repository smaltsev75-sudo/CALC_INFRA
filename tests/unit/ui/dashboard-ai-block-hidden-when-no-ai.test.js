/**
 * UX-ревью (2026-05-31): для расчёта без AI дашборд рендерил 6 блоков «Объёмы
 * AI-нагрузки» (Hero + 5 стенд-карточек), все строки «—». Причина — предикат
 * показа `e.qty > 0 || e.applicable`: ветка `|| applicable` qty-независима и
 * истинна для любого расчёта (все AI-ЭК применимы ко всем стендам в seed).
 *
 * Фикс зеркалит уже принятый в проекте критерий соседних экранов:
 *   - Сравнение (comparison.js renderAiMetricsComparisonSection): `e.qty > 0`;
 *   - Детали (detailsAiSummary.js renderAiMetricsSummary): `e.qty > 0`.
 *
 * Контракт: блок целиком скрывается, когда в scope нет НИ ОДНОЙ метрики qty>0
 * (AI не используется). Когда AI настроен и хотя бы одна метрика >0 — блок
 * остаётся, а отдельные нулевые метрики показываются как «—» (правило 12.U10
 * «строка как — вместо silent skip»). Случай «AI включён, но всё схлопнулось в 0»
 * ловит отдельный Health-error, а не пустой блок.
 *
 * Поведенческий тест: null-ветка срабатывает ДО любого обращения к document,
 * поэтому проверяется на реальном вызове функции под минимальным DOM-stub'ом.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Минимальный DOM-stub: достаточно для el() в положительной ветке.
function makeNode(tag) {
    return {
        tagName: tag, id: '', style: {}, dataset: {}, attributes: {}, childNodes: [],
        _class: '', _text: undefined,
        set className(v) { this._class = v; }, get className() { return this._class; },
        setAttribute(k, v) { this.attributes[k] = v; },
        addEventListener() {},
        appendChild(c) { this.childNodes.push(c); return c; },
        set textContent(v) { this._text = String(v); this.childNodes = []; },
        get textContent() {
            if (this._text !== undefined) return this._text;
            return this.childNodes.map(c => (typeof c === 'string' ? c : (c.textContent || ''))).join('');
        },
    };
}
globalThis.document = {
    createElement: t => makeNode(t),
    createTextNode: t => ({ textContent: String(t), nodeType: 3 }),
};

const { renderAiMetricsBlock } = await import('../../../js/ui/dashboardMetricBlocks.js');
const { DASHBOARD_AI_METRIC_LABELS } = await import('../../../js/utils/constants.js');

function metricMap(overrides = {}) {
    const m = {};
    for (const label of DASHBOARD_AI_METRIC_LABELS) m[label] = { qty: 0, unit: '', applicable: true };
    return Object.assign(m, overrides);
}

describe('Dashboard AI-блок: скрыт, когда AI не используется', () => {
    it('все метрики qty=0 (хотя applicable=true) → блок НЕ рендерится (null)', () => {
        const out = renderAiMetricsBlock(metricMap(), 'Объёмы AI-нагрузки', true, {}, 'monthly');
        assert.equal(out, null,
            'для не-AI расчёта (qty=0 у всех, applicable=true) блок «Объёмы AI-нагрузки» ' +
            'должен скрываться — как в Сравнении и Деталях, а не показывать 4 строки «—»');
    });

    it('хотя бы одна метрика qty>0 → блок рендерится (AI настроен)', () => {
        const first = DASHBOARD_AI_METRIC_LABELS[0];
        const out = renderAiMetricsBlock(
            metricMap({ [first]: { qty: 100, unit: 'млн', applicable: true } }),
            'Объёмы AI-нагрузки', true, { openMessageModal() {} }, 'monthly');
        assert.ok(out, 'при настроенном AI (есть метрика qty>0) блок должен рендериться');
    });
});
