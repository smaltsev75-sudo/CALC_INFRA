import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    DETAILS_PRINT_BODY_CLASS,
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
});
