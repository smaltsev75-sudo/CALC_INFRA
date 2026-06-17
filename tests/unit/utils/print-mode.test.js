import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DETAILS_PRINT_BODY_CLASS,
    DETAILS_PRINT_NO_QUANTITY_CLASS,
    DETAILS_PRINT_PAGE_CSS,
    DETAILS_PRINT_STYLE_ID,
    beginDetailsPrintMode,
    printWithDetailsMode
} from '../../../js/utils/printMode.js';

function makeClassList() {
    const set = new Set();
    return {
        add: (...names) => names.forEach(name => set.add(name)),
        remove: (...names) => names.forEach(name => set.delete(name)),
        contains: name => set.has(name),
        toString: () => [...set].join(' ')
    };
}

function makeDocument() {
    const elements = new Map();
    const doc = {
        body: { classList: makeClassList() },
        documentElement: null,
        head: {
            appendChild(el) {
                elements.set(el.id, el);
                el.remove = () => elements.delete(el.id);
            }
        },
        createElement(tag) {
            return {
                tagName: tag.toUpperCase(),
                id: '',
                textContent: '',
                attrs: {},
                setAttribute(name, value) { this.attrs[name] = value; }
            };
        },
        getElementById(id) {
            return elements.get(id) || null;
        }
    };
    doc.documentElement = doc.head;
    return doc;
}

function makeWindow() {
    const listeners = new Map();
    return {
        addEventListener(name, fn) { listeners.set(name, fn); },
        removeEventListener(name, fn) {
            if (listeners.get(name) === fn) listeners.delete(name);
        },
        dispatch(name) { listeners.get(name)?.(); }
    };
}

describe('details print page margins', () => {
    it('A4 landscape, левое поле >= правого (контент смещён вправо, не у края)', () => {
        assert.match(DETAILS_PRINT_PAGE_CSS, /size:\s*A4\s+landscape/);
        const m = DETAILS_PRINT_PAGE_CSS.match(/margin:\s*([^;]+);/);
        assert.ok(m, 'должно быть объявление margin');
        const parts = m[1].trim().split(/\s+/).map(v => parseFloat(v));
        // CSS margin: top right bottom left (или 1 значение = все стороны).
        const left  = parts.length >= 4 ? parts[3] : parts[parts.length === 2 ? 1 : 0];
        const right = parts.length >= 2 ? parts[1] : parts[0];
        assert.ok(left >= right, `левое поле (${left}) должно быть >= правого (${right})`);
        assert.ok(left >= 9, `левое поле должно быть достаточным (>=9mm), получено ${left}`);
        // usable-ширина A4 landscape (297мм) должна оставаться >= 281мм (док. безопасный минимум).
        const usable = 297 - (left + right);
        assert.ok(usable >= 281, `usable-ширина ${usable}мм < 281мм — риск обрезки таблицы справа`);
    });
});

describe('details print mode', () => {
    it('adds transient body class and print-only A4 landscape style', () => {
        const doc = makeDocument();
        const win = makeWindow();

        beginDetailsPrintMode({ doc, win });

        const style = doc.getElementById(DETAILS_PRINT_STYLE_ID);
        assert.ok(doc.body.classList.contains(DETAILS_PRINT_BODY_CLASS));
        assert.equal(style?.attrs.media, 'print');
        assert.equal(style?.textContent, DETAILS_PRINT_PAGE_CSS);

        win.dispatch('afterprint');
        assert.equal(doc.body.classList.contains(DETAILS_PRINT_BODY_CLASS), false);
        assert.equal(doc.getElementById(DETAILS_PRINT_STYLE_ID), null);
    });

    it('cleans up when printWindow throws', () => {
        const doc = makeDocument();
        const win = makeWindow();

        assert.throws(() => printWithDetailsMode(() => {
            throw new Error('print failed');
        }, { doc, win }), /print failed/);

        assert.equal(doc.body.classList.contains(DETAILS_PRINT_BODY_CLASS), false);
        assert.equal(doc.getElementById(DETAILS_PRINT_STYLE_ID), null);
    });

    it('can hide quantity explanation summary for Details PDF', () => {
        const doc = makeDocument();
        const win = makeWindow();

        beginDetailsPrintMode({ doc, win, includeQuantitySummary: false });

        assert.equal(doc.body.classList.contains(DETAILS_PRINT_BODY_CLASS), true);
        assert.equal(doc.body.classList.contains(DETAILS_PRINT_NO_QUANTITY_CLASS), true);

        win.dispatch('afterprint');
        assert.equal(doc.body.classList.contains(DETAILS_PRINT_BODY_CLASS), false);
        assert.equal(doc.body.classList.contains(DETAILS_PRINT_NO_QUANTITY_CLASS), false);
    });
});
