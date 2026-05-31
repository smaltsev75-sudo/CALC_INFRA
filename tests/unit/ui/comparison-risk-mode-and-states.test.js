/**
 * UX-ревью (2026-05-31), экран «Сравнение»:
 *   #3 — режим рисков (applyRiskFactors) меняет итог (costFinal × riskTotal), но
 *        раньше Сравнение не показывало бейдж режима в основной таблице и не
 *        предупреждало о смешивании «с рисками»/«без рисков» (warning был только
 *        для НДС). renderComparisonRiskModeWarning зеркалит renderComparisonVatWarning.
 *   #4 — при 0 расчётов пустое состояние ссылалось на «селектор выше», которого
 *        нет (renderPicker→null при 0). Теперь разводим текст по state.calcList.
 *   #8 — inline-дельта использовала строгое delta===0 вместо isZeroMoney —
 *        фантомная цветная «+0 ₽» на почти равных расчётах из-за float-остатка.
 *
 * Поведенческие тесты под минимальным DOM-stub'ом (функции экспортированы для тестов).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

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

const cmp = await import('../../../js/ui/comparison.js');

function mkCalc(name, risks = true) {
    return { name, settings: { applyRiskFactors: risks }, dictionaries: { items: [] }, view: {} };
}

describe('Сравнение #3 — предупреждение о смешанном режиме рисков', () => {
    it('warning при разных applyRiskFactors', () => {
        const out = cmp.renderComparisonRiskModeWarning([mkCalc('A', true), mkCalc('B', false)]);
        assert.ok(out, 'смешанный режим рисков должен давать warning');
        assert.match(out.textContent, /разных режимах рисков/);
    });
    it('нет warning при одинаковом режиме', () => {
        assert.equal(cmp.renderComparisonRiskModeWarning([mkCalc('A', true), mkCalc('B', true)]), null);
    });
    it('нет warning при <2 расчётах', () => {
        assert.equal(cmp.renderComparisonRiskModeWarning([mkCalc('A', false)]), null);
    });
});

describe('Сравнение #4 — пустое состояние при 0 расчётах', () => {
    it('0 расчётов → подсказка создать расчёт, без ссылки на несуществующий селектор', () => {
        const out = cmp.renderEmptyState({ calcList: [] }, {});
        assert.match(out.textContent, /Создайте расчёт/);
        assert.doesNotMatch(out.textContent, /в селекторе выше/);
    });
    it('есть расчёты → подсказка про селектор выше', () => {
        const out = cmp.renderEmptyState({ calcList: [{ id: '1' }] }, {});
        assert.match(out.textContent, /селекторе выше/);
    });
});

describe('Сравнение #8 — дельта через isZeroMoney', () => {
    it('разница в полукопейки → нейтральная «нет разницы» (cmp-delta-zero)', () => {
        const out = cmp.renderDeltaInline(100.003, 100);
        assert.match(out.className, /cmp-delta-zero/);
        assert.doesNotMatch(out.className, /cmp-delta-(up|down)/);
    });
    it('реальная разница → cmp-delta-up', () => {
        const out = cmp.renderDeltaInline(200, 100);
        assert.match(out.className, /cmp-delta-up/);
    });
});
