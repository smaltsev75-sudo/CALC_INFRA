/**
 * Регрессия 12.U21: `el('option', { value })` теперь действительно ставит
 * `option.value` через IDL-property. Раньше для тега <option> ветка
 * `node.value = props.value` не срабатывала (option не входил в whitelist),
 * value-атрибут на DOM-узле не проставлялся, и `<select>.value` возвращал
 * текст опции вместо id — баг проявлялся в любом селекте, читающем
 * `e.target.value` в onChange (новой модалке выбора шаблона расчёта).
 *
 * Тест проверяет:
 *   1. el('option', { value: 'X' }, 'label') → node.value === 'X' (а не 'label').
 *   2. То же для пустой строки: value: '' → node.value === ''.
 *   3. Когда value не передан, el() не трогает node.value (default-поведение
 *      браузера: option.value падает в option.text).
 *   4. Симуляция flow выбора в select: `select.value` после установки = id
 *      шаблона/опции, а не label. Stage 4.9/4.14: пример переписан с
 *      newCalcModal (удалён) на абстрактный template-select.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* Мок-элемент, имитирующий DOM-ноду для node:test без jsdom.
 * Поддерживает то минимальное API, которое использует el(): appendChild,
 * setAttribute, addEventListener, value, textContent, children, options. */
function makeMockElement(tag = 'div') {
    const node = {
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
        // Симуляция option.value: когда explicit value НЕ задан, возвращаем text.
        // Это копирует поведение браузера для <option> без атрибута value=.
        _explicitValue: undefined,
        get value() {
            if (this.tagName === 'OPTION') {
                return this._explicitValue !== undefined ? this._explicitValue : this.textContent;
            }
            return this._explicitValue;
        },
        set value(v) { this._explicitValue = v; },
        get parentNode() { return this._parent || null; },
        set parentNode(v) { this._parent = v; },
        appendChild(c) { if (c) { this.children.push(c); c._parent = this; } return c; },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener() {},
        removeEventListener() {}
    };
    return node;
}

describe('el(\'option\', { value }) — регрессия 12.U21', () => {
    let el;

    before(async () => {
        globalThis.document = {
            createElement: (tag) => makeMockElement(tag),
            createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
            body: makeMockElement('body'),
            getElementById: () => null,
            addEventListener: () => {}
        };
        const mod = await import('../../../js/ui/dom.js');
        el = mod.el;
    });

    it('value: \'tier1-mvp\' устанавливает option.value === \'tier1-mvp\'', () => {
        const opt = el('option', { value: 'tier1-mvp' }, 'MVP / пилот');
        assert.equal(opt.value, 'tier1-mvp',
            `option.value должен быть 'tier1-mvp', получено '${opt.value}'`);
    });

    it('value: \'\' (пустая строка) устанавливает option.value === \'\'', () => {
        const opt = el('option', { value: '' }, 'Пустой');
        assert.equal(opt.value, '',
            `option.value должен быть пустой строкой, получено '${opt.value}'`);
    });

    it('без value option.value падает в textContent (default браузера)', () => {
        const opt = el('option', { class: 'opt' }, 'Just text');
        // textContent не выставлен через props.text — мок не агрегирует children в text.
        // Проверяем, что _explicitValue остался undefined (мы НЕ переопределили).
        assert.equal(opt._explicitValue, undefined,
            'без props.value el() не должен трогать node.value');
    });

    it('numeric value тоже устанавливается корректно', () => {
        const opt = el('option', { value: 42 }, 'Сорок два');
        assert.equal(opt.value, 42,
            `option.value должен быть 42, получено '${opt.value}'`);
    });

    it('select с template-id: каждый option.value = id, не label (общий паттерн)', () => {
        // Stage 4.9/4.14: пример переписан с конкретного newCalcModal
        // (удалён) на абстрактный template-select. Тот же паттерн используется
        // в любом select с onChange: e => x(e.target.value).
        const templates = [
            { id: 'tier1-mvp', label: 'MVP' },
            { id: 'tier2-small-saas', label: 'Малый SaaS' },
            { id: 'tier3-medium-saas', label: 'Средний SaaS' }
        ];
        const sel = el('select', { class: 'input' },
            el('option', { value: '' }, 'Пустой'),
            ...templates.map(t => el('option', { value: t.id }, `${t.label} — N пользователей`))
        );
        // Проверяем что у каждого option .value = id, не label.
        assert.equal(sel.children[0].value, '', 'option[0].value (Пустой) === \'\'');
        assert.equal(sel.children[1].value, 'tier1-mvp', 'option[1].value === \'tier1-mvp\'');
        assert.equal(sel.children[2].value, 'tier2-small-saas', 'option[2].value === \'tier2-small-saas\'');
        assert.equal(sel.children[3].value, 'tier3-medium-saas', 'option[3].value === \'tier3-medium-saas\'');
    });
});
