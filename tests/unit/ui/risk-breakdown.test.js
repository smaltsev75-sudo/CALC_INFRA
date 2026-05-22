/**
 * 12.U25-fix-6: разбивка суммы рисков (буферы / инфляция / сезонность / сдвиг
 * расписания / резерв) в Hero и в стенд-карточках на дашборде. По аналогии
 * с VAT-разбивкой: статус (бейдж «С РИСКАМИ») + сумма (строка «Риски: X ₽»).
 *
 * Проверяемые свойства:
 *   - extractRiskAmount возвращает 0 при applyRisks=false (риски не «зашиты» в total).
 *   - extractRiskAmount суммирует по всем cells: cell.costBase × (riskTotal − 1) × vatMul.
 *     vatMul участвует, потому что costFinal = costBase × riskTotal × vatMul,
 *     и риск-наценка в итоге включает эффект НДС поверх.
 *   - renderRiskBreakdownLine возвращает null при applyRisks=false (бейдж «БЕЗ РИСКОВ»
 *     — единственный достаточный маркер; принцип «один маркер = одна грань»).
 *   - Label строки = «Риски:» (без процента — он уже в риск-бейдже-статусе).
 *   - Сумма умножается на periodMul (mul за месяц/год/день).
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

function makeMockElement(tag = 'div') {
    return {
        tagName: String(tag).toUpperCase(),
        children: [],
        attributes: {},
        style: {},
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            contains(c) { return this._list.has(c); }
        },
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        title: '',
        appendChild(c) { if (c) { this.children.push(c); c._parent = this; } return c; },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener() {},
        removeEventListener() {}
    };
}

const cell = (costBase, riskTotal = 1.50, vatMul = 1.20) => ({
    costBase,
    riskBreakdown: { total: riskTotal, vatMul }
});

describe('extractRiskAmount — сумма наценки от риск-коэффициентов', () => {
    let extractRiskAmount;

    before(async () => {
        globalThis.document = {
            createElement: tag => makeMockElement(tag),
            createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
            body: makeMockElement('body'),
            getElementById: () => null,
            addEventListener: () => {}
        };
        const mod = await import('../../../js/ui/riskBreakdown.js');
        extractRiskAmount = mod.extractRiskAmount;
    });

    /* 12.U25-fix-7: extractRiskAmount считает ПОТЕНЦИАЛЬНУЮ риск-наценку
     * по реальным коэффициентам в riskBreakdown — независимо от applyRisks.
     * applyRisks-флаг меняет только UI-текст (см. renderRiskBreakdownLine),
     * не сами числа. Это согласовано с инвариантом из CLAUDE.md:
     * «cell.riskBreakdown ВСЕГДА содержит реальные коэффициенты». */
    it('одна ячейка: base=1000, riskTotal=1.5, vatMul=1.2 → markup = 1000 × 0.5 × 1.2 = 600 (всегда, не зависит от applyRisks)', () => {
        assert.equal(extractRiskAmount([cell(1000, 1.50, 1.20)]), 600);
    });

    it('сумма по нескольким ячейкам', () => {
        const cells = [
            cell(1000, 1.50, 1.20),  // 600
            cell(500,  1.20, 1.20),  // 500 × 0.20 × 1.20 = 120
            cell(200,  1.00, 1.00)   // 200 × 0 × 1 = 0 (нейтральная)
        ];
        assert.equal(extractRiskAmount(cells), 720);
    });

    it('cells без riskBreakdown пропускаются', () => {
        const cells = [
            { costBase: 1000 },                            // skip
            { costBase: 500, riskBreakdown: null },        // skip
            cell(200, 1.50, 1.00)                          // 200 × 0.5 × 1 = 100
        ];
        assert.equal(extractRiskAmount(cells), 100);
    });

    it('cells без vatMul (защита) → vatMul=1', () => {
        const cells = [{ costBase: 1000, riskBreakdown: { total: 1.50 } }];
        // 1000 × 0.5 × 1 = 500.
        assert.equal(extractRiskAmount(cells), 500);
    });

    it('пустой массив → 0', () => {
        assert.equal(extractRiskAmount([]), 0);
    });

    it('not-array → 0', () => {
        assert.equal(extractRiskAmount(null), 0);
        assert.equal(extractRiskAmount(undefined), 0);
    });
});

const hasClass = (node, name) => (node?.className || '').split(/\s+/).includes(name);

describe('renderRiskBreakdownLine — DOM-узел строки «Риски: X ₽»', () => {
    let renderRiskBreakdownLine;

    before(async () => {
        const mod = await import('../../../js/ui/riskBreakdown.js');
        renderRiskBreakdownLine = mod.renderRiskBreakdownLine;
    });

    /* 12.U25-fix-7: helper показывает строку и в режиме «БЕЗ РИСКОВ» —
     * тогда сумма помечается как ПОТЕНЦИАЛЬНАЯ («если применить»). Симметрично
     * с Hero-сообщением «+85.6% если применить риски». Ранее возвращал null
     * при applyRisks=false (по аналогии с VAT), но это скрывало полезную инфу:
     * пользователь видел БЕЗ РИСКОВ-бейдж, но не знал, СКОЛЬКО ₽ потенциальной
     * риск-наценки лежит в каждой карточке. */

    it('applyRisks=true → строка БЕЗ суффикса «если применить»', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], true, 1, '/мес');
        assert.ok(node);
        assert.ok(hasClass(node, 'risk-breakdown'));
        const allText = node.children.map(c => c.textContent).join(' ');
        assert.ok(!/если применить/i.test(allText),
            `при applyRisks=true НЕ должно быть «если применить»: «${allText}»`);
        assert.ok(/600/.test(allText), 'сумма 600 должна быть в строке');
    });

    it('applyRisks=false → строка С суффиксом «если применить» И корректной потенциальной суммой', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], false, 1, '/мес');
        assert.ok(node, 'helper должен возвращать строку даже при applyRisks=false (потенциальная)');
        assert.ok(hasClass(node, 'risk-breakdown'));
        const allText = node.children.map(c => c.textContent).join(' ');
        assert.match(allText, /если применить/i,
            'при applyRisks=false должен быть суффикс «если применить» — это потенциальная сумма');
        assert.ok(/600/.test(allText),
            'потенциальная сумма = 600 (та же формула, что и при applyRisks=true)');
    });

    it('label всегда «Риски:», без процента/множителя в обоих режимах', () => {
        for (const mode of [true, false]) {
            const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], mode, 1, '/мес');
            const childTexts = node.children.map(c => c.textContent);
            assert.ok(childTexts.some(t => t === 'Риски:'),
                `label «Риски:» в режиме applyRisks=${mode}`);
            const allText = childTexts.join(' | ');
            assert.ok(!/С РИСКАМИ/.test(allText), `НЕ дублировать статус-бейдж: «${allText}»`);
            assert.ok(!/×\s*1[.,]/.test(allText), `НЕ показывать множитель: «${allText}»`);
        }
    });

    it('периодный множитель: monthly=600 при mul=1, annual=7200 при mul=12 (в обоих режимах)', () => {
        for (const mode of [true, false]) {
            const monthly = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], mode, 1, '/мес');
            const annual  = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], mode, 12, '/год');
            assert.match(monthly.children.map(c => c.textContent).join(' '), /600/);
            assert.match(annual.children.map(c => c.textContent).join(' '), /7\s?200/);
        }
    });

    it('все коэффициенты нейтральны (riskTotal=1) → null (нечего показывать)', () => {
        // riskTotal=1 везде → потенциальная сумма = 0; строку не показываем.
        // Это работает в обоих режимах: ничего показывать не имеет смысла.
        assert.equal(renderRiskBreakdownLine([cell(1000, 1, 1)], true, 1, '/мес'), null);
        assert.equal(renderRiskBreakdownLine([cell(1000, 1, 1)], false, 1, '/мес'), null);
    });

    /* 12.U25-fix-8: опциональный 5-й параметр surplusPct — % наценки от базы.
     * Когда передан и |pct| >= 0.05, добавляется inline-пилл справа от amount:
     *   - applyRisks=true:  «+85.6% от базы»
     *   - applyRisks=false: «+85.6% если применить риски»
     * Используется в Hero «Итого по расчёту» — раньше этот пилл стоял отдельной
     * строкой над НДС/Рисками, теперь — на одной строке с риск-наценкой
     * (логически он принадлежит ей: % = масштаб риск-наценки от базы). */

    it('surplusPct не передан → НЕТ inline-пилла (backward compat для стенд-карточек)', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], true, 1, '/мес');
        const childCount = node.children.length;
        assert.equal(childCount, 2,
            `без surplusPct у строки только label + amount = 2 ребёнка, получено ${childCount}`);
    });

    /* surplusPct передаётся в ПРОЦЕНТАХ (86.6, не 0.866) — согласуется со старым
     * dash-hero-sub-кодом, где surplusPct = riskInfo.surplus * 100. */

    it('surplusPct=86.6 + applyRisks=true → пилл «+86.6% от базы» 3-м ребёнком', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], true, 1, '/мес', 86.6);
        assert.equal(node.children.length, 3);
        const pill = node.children[2];
        assert.match(pill.textContent, /\+86[.,]6\s*%\s*от\s*базы/i,
            `pill text = «+86.6% от базы», получено: «${pill.textContent}»`);
        assert.ok(pill.className.includes('risk-breakdown-pct'),
            `pill должен иметь класс risk-breakdown-pct, получено: «${pill.className}»`);
    });

    it('surplusPct=85.6 + applyRisks=false → пилл «+85.6% если применить риски»', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], false, 1, '/мес', 85.6);
        const pill = node.children[2];
        assert.match(pill.textContent, /\+85[.,]6\s*%\s*если\s*применить/i,
            `pill text = «+85.6% если применить ...», получено: «${pill.textContent}»`);
    });

    it('surplusPct = крошечный (|pct| < 0.05%) → пилл НЕ добавляется', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], true, 1, '/мес', 0.001);
        assert.equal(node.children.length, 2,
            'при крошечной наценке (< 0.05%) пилл бесполезен — не добавляем визуальный шум');
    });

    it('surplusPct отрицательный (нелогичная конфигурация коэффициентов) → пилл со знаком минус', () => {
        const node = renderRiskBreakdownLine([cell(1000, 1.50, 1.20)], true, 1, '/мес', -10);
        const pill = node.children[2];
        assert.match(pill.textContent, /-10[.,]0\s*%\s*от\s*базы/i);
    });
});
