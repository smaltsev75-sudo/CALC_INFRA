/**
 * 12.U23: VAT-бейдж и расчёт суммы НДС из итога.
 *
 * Тест проверяет:
 *   - vatInfo возвращает корректные значения для разных конфигураций settings.
 *   - extractVatAmount(total, vatMul) корректно извлекает VAT-долю из итога С НДС
 *     по формуле total × (1 − 1/vatMul).
 *   - Defaults используются, когда settings.vatEnabled/vatRate не заданы.
 *   - При vatMul = 1 (НДС выключен) VAT-доля = 0.
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

describe('vatInfo — извлечение НДС-настроек', () => {
    let vatInfo;

    before(async () => {
        globalThis.document = {
            createElement: tag => makeMockElement(tag),
            createTextNode: t => ({ nodeType: 3, textContent: String(t) }),
            body: makeMockElement('body'),
            getElementById: () => null,
            addEventListener: () => {}
        };
        const mod = await import('../../../js/ui/vatBadge.js');
        vatInfo = mod.vatInfo;
    });

    it('vatEnabled=true, vatRate=0.20 → enabled=true, rate=0.20, vatMul=1.20', () => {
        const r = vatInfo({ settings: { vatEnabled: true, vatRate: 0.20 } });
        assert.equal(r.enabled, true);
        assert.equal(r.rate, 0.20);
        assert.equal(r.vatMul, 1.20);
    });

    it('vatEnabled=false → enabled=false, vatMul=1 (даже если vatRate задана)', () => {
        const r = vatInfo({ settings: { vatEnabled: false, vatRate: 0.20 } });
        assert.equal(r.enabled, false);
        assert.equal(r.vatMul, 1);
    });

    it('пустые settings → используются дефолты (DEFAULT_VAT_ENABLED + getCurrentVatRate)', () => {
        const r = vatInfo({ settings: {} });
        // VAT-1 Phase 6: vatRate fallback теперь идёт через getCurrentVatRate()
        // из vatRateTable.js (DEFAULT_VAT_RATE удалён). Текущая ставка РФ — 22%.
        assert.equal(r.enabled, true);
        assert.equal(r.rate, 0.22);
        assert.equal(r.vatMul, 1.22);
    });

    it('null calc → дефолты не падают', () => {
        const r = vatInfo(null);
        assert.equal(r.enabled, true);
        assert.equal(r.vatMul, 1.22);
    });
});

describe('extractVatAmount — VAT-доля из итога С НДС', () => {
    let extractVatAmount;

    before(async () => {
        const mod = await import('../../../js/ui/vatBadge.js');
        extractVatAmount = mod.extractVatAmount;
    });

    it('VAT 20% из 1200 = 200', () => {
        // costFinal = 1000 × 1.20 = 1200; VAT часть = 1200 × (1 − 1/1.20) = 200.
        const v = extractVatAmount(1200, 1.20);
        assert.ok(Math.abs(v - 200) < 1e-9, `ожидалось 200, получено ${v}`);
    });

    it('VAT 10% из 1100 = 100', () => {
        const v = extractVatAmount(1100, 1.10);
        assert.ok(Math.abs(v - 100) < 1e-9);
    });

    it('vatMul=1 (НДС выключен) → VAT-доля = 0', () => {
        assert.equal(extractVatAmount(1500, 1), 0);
    });

    it('vatMul=0 или отрицательный → 0 (защита)', () => {
        assert.equal(extractVatAmount(1500, 0), 0);
        assert.equal(extractVatAmount(1500, -1), 0);
    });

    it('total не финитен → 0', () => {
        assert.equal(extractVatAmount(NaN, 1.20), 0);
        assert.equal(extractVatAmount(Infinity, 1.20), 0);
    });

    it('round-trip: total = base × vatMul; extractVatAmount(total) + base = total', () => {
        const base = 100000;
        const vatMul = 1.20;
        const total = base * vatMul;  // 120 000
        const vat = extractVatAmount(total, vatMul);
        const reconstructedBase = total - vat;
        assert.ok(Math.abs(reconstructedBase - base) < 1e-6,
            `base после reconstruct: ${reconstructedBase}, ожидалось ${base}`);
    });

    it('правильно с разными ставками НДС (5%, 10%, 18%, 20%)', () => {
        for (const rate of [0.05, 0.10, 0.18, 0.20]) {
            const base = 1000;
            const total = base * (1 + rate);
            const vat = extractVatAmount(total, 1 + rate);
            assert.ok(Math.abs(vat - base * rate) < 1e-6,
                `rate=${rate}: ожидалось ${base * rate}, получено ${vat}`);
        }
    });
});

/* el() ставит классы через node.className, не через classList.add — мок-классlist
 * не реагирует на className. Поэтому проверяем подстроку в className напрямую. */
const hasClass = (node, name) => {
    const cls = node?.className || '';
    return cls.split(/\s+/).includes(name);
};

describe('renderVatBadge — DOM-узел бейджа', () => {
    let renderVatBadge;

    before(async () => {
        const mod = await import('../../../js/ui/vatBadge.js');
        renderVatBadge = mod.renderVatBadge;
    });

    it('vatEnabled=true, vatRate=0.20 → класс vat-badge-on, текст «С НДС 20%»', () => {
        const node = renderVatBadge({ settings: { vatEnabled: true, vatRate: 0.20 } });
        assert.ok(hasClass(node, 'vat-badge'));
        assert.ok(hasClass(node, 'vat-badge-on'));
        assert.equal(node.textContent, 'С НДС 20%');
    });

    it('vatEnabled=false → класс vat-badge-off, текст «БЕЗ НДС»', () => {
        const node = renderVatBadge({ settings: { vatEnabled: false } });
        assert.ok(hasClass(node, 'vat-badge'));
        assert.ok(hasClass(node, 'vat-badge-off'));
        assert.equal(node.textContent, 'БЕЗ НДС');
    });

    it('round-rate (18% → «С НДС 18%»)', () => {
        const node = renderVatBadge({ settings: { vatEnabled: true, vatRate: 0.18 } });
        assert.equal(node.textContent, 'С НДС 18%');
    });
});

describe('renderVatBreakdownLine — строка «НДС: ... ₽»', () => {
    let renderVatBreakdownLine;

    before(async () => {
        const mod = await import('../../../js/ui/vatBadge.js');
        renderVatBreakdownLine = mod.renderVatBreakdownLine;
    });

    it('vatEnabled=true → возвращает узел с label «НДС:» и amount-суммой', () => {
        const node = renderVatBreakdownLine(
            { settings: { vatEnabled: true, vatRate: 0.20 } },
            1200, '/мес'
        );
        assert.ok(node);
        assert.ok(hasClass(node, 'vat-breakdown'));
        assert.ok(hasClass(node, 'vat-breakdown-on'));
        const childTexts = node.children.map(c => c.textContent);
        // 12.U24: label содержит ТОЛЬКО «НДС:» — без процента (он уже в бейдже).
        assert.ok(childTexts.some(t => t === 'НДС:'),
            `ожидался label «НДС:» без процента, получены: ${JSON.stringify(childTexts)}`);
        // НЕ должно быть «20%» в текстах элементов — иначе процент дублируется с бейджем.
        for (const t of childTexts) {
            assert.ok(!/20%/.test(t),
                `вырезаем дублирование процента: «20%» не должно быть в строке-разбивке (есть в: «${t}»)`);
        }
        assert.ok(childTexts.some(t => /200/.test(t)),
            `ожидалась сумма 200 в amount, получены: ${JSON.stringify(childTexts)}`);
    });

    it('vatEnabled=false → возвращает null (бейдж «БЕЗ НДС» — единственный маркер)', () => {
        // 12.U24: при выключенном НДС не дублируем «без НДС» в разбивке —
        // бейдж уже всё сказал, сумма налога нулевая, отдельной строки не нужно.
        const node = renderVatBreakdownLine(
            { settings: { vatEnabled: false } },
            1200, '/мес'
        );
        assert.equal(node, null);
    });
});
