/**
 * Smoke-тест UI-модулей: каждый файл из js/ui/ и js/ui/modals/ должен
 * импортироваться без ошибок (под минимальным DOM-mock'ом).
 *
 * Это страховка от регрессий вроде «забыли переименовать TARIFF_LABELS
 * после schema v1→v2» — такие баги ломают boot браузера, но не покрываются
 * domain-тестами.
 *
 * Suite использует `concurrency: true` — модули импортируются параллельно.
 *
 * НЕ покрывает: визуальный рендер, события, корректность layout.
 * Покрывает: import-time errors, отсутствующие экспорты, top-level вызовы
 * `document.*` / `window.*` в момент загрузки модуля.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_ROOT = join(__dirname, '..', '..', '..', 'js', 'ui');

/* ---------- Минимальный DOM-mock ---------- */

function makeMockElement(tag = 'div') {
    const node = {
        tagName: tag.toUpperCase(),
        nodeName: tag.toUpperCase(),
        children: [],
        childNodes: [],
        attributes: {},
        style: {},
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            toggle(c) { this._list.has(c) ? this._list.delete(c) : this._list.add(c); },
            contains(c) { return this._list.has(c); }
        },
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        title: '',
        value: '',
        checked: false,
        disabled: false,
        placeholder: '',
        type: '',
        get firstChild() { return this.children[0] || null; },
        get parentNode() { return null; },
        appendChild(c) { if (c) { this.children.push(c); this.childNodes.push(c); } return c; },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) { this.children.splice(i, 1); this.childNodes.splice(i, 1); }
            return c;
        },
        replaceChild(neu, old) {
            const i = this.children.indexOf(old);
            if (i >= 0) { this.children[i] = neu; this.childNodes[i] = neu; }
            return old;
        },
        insertBefore(neu, ref) {
            const i = this.children.indexOf(ref);
            if (i >= 0) { this.children.splice(i, 0, neu); this.childNodes.splice(i, 0, neu); }
            else { this.children.push(neu); this.childNodes.push(neu); }
            return neu;
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        removeAttribute(k) { delete this.attributes[k]; },
        hasAttribute(k) { return k in this.attributes; },
        addEventListener() {},
        removeEventListener() {},
        dispatchEvent() { return true; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getElementsByClassName() { return []; },
        getElementsByTagName() { return []; },
        focus() {},
        blur() {},
        click() {},
        scrollIntoView() {},
        getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
        contains() { return false; },
        closest() { return null; }
    };
    return node;
}

function installDomMock() {
    const body = makeMockElement('body');
    const html = makeMockElement('html');
    const head = makeMockElement('head');
    globalThis.document = {
        createElement: (tag) => makeMockElement(tag),
        createTextNode: (t) => ({ nodeType: 3, textContent: String(t), nodeValue: String(t) }),
        createDocumentFragment: () => makeMockElement('fragment'),
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        body,
        head,
        documentElement: html,
        activeElement: null,
        title: '',
        readyState: 'complete',
        hidden: false,
        visibilityState: 'visible'
    };
    globalThis.window = {
        addEventListener: () => {},
        removeEventListener: () => {},
        location: { hash: '', pathname: '/', search: '', href: 'http://localhost/', reload: () => {} },
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        setTimeout: setTimeout,
        clearTimeout: clearTimeout,
        innerWidth: 1280,
        innerHeight: 720,
        devicePixelRatio: 1,
        matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        navigator: { clipboard: { writeText: async () => {} }, userAgent: 'node-test' },
        scrollTo: () => {},
        print: () => {},
        alert: () => {},
        confirm: () => true,
        prompt: () => null,
        URL: globalThis.URL,
        Blob: class { constructor(parts) { this.parts = parts; } }
    };
    const _store = new Map();
    globalThis.localStorage = {
        getItem: (k) => _store.has(k) ? _store.get(k) : null,
        setItem: (k, v) => _store.set(k, String(v)),
        removeItem: (k) => _store.delete(k),
        clear: () => _store.clear(),
        get length() { return _store.size; },
        key: (i) => Array.from(_store.keys())[i] ?? null
    };
    globalThis.sessionStorage = { ...globalThis.localStorage };
    globalThis.requestAnimationFrame = globalThis.window.requestAnimationFrame;
    globalThis.cancelAnimationFrame = globalThis.window.cancelAnimationFrame;
    globalThis.HTMLElement = function() {};
}

/* ---------- Сбор UI-файлов ---------- */

function collectUiFiles(root, prefix = '') {
    const out = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        const full = join(root, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            out.push(...collectUiFiles(full, rel));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push({ rel, full });
        }
    }
    return out;
}

const uiFiles = collectUiFiles(UI_ROOT);

/* ---------- DOM-mock устанавливается ДО первого импорта UI ---------- */

before(() => {
    installDomMock();
});

/* ---------- Тесты — параллельные ---------- */

describe('UI modules: import smoke (parallel)', { concurrency: true }, () => {
    for (const { rel, full } of uiFiles) {
        it(`импортирует js/ui/${rel} без ошибок`, async () => {
            const url = pathToFileURL(full).href;
            await assert.doesNotReject(
                () => import(url),
                `js/ui/${rel} должен импортироваться чисто (под DOM-mock)`
            );
        });
    }
});

describe('UI modules: count and structure', () => {
    it('Найдено хотя бы 20 UI-файлов', () => {
        assert.ok(uiFiles.length >= 20, `найдено ${uiFiles.length}, ожидалось ≥ 20`);
    });
    it('Покрыты основные вкладки и модалки', () => {
        const names = uiFiles.map(f => f.rel);
        for (const must of [
            'index.js', 'dom.js', 'header.js', 'sidebar.js', 'icons.js', 'snackbar.js', 'focus.js',
            'calcList.js', 'questionnaire.js', 'dashboard.js', 'details.js',
            'itemsTab.js', 'questionsTab.js', 'comparison.js',
            'modals/baseModal.js', 'modals/messageModal.js', 'modals/confirmModal.js',
            'modals/inputModal.js', 'modals/itemEditModal.js', 'modals/questionEditModal.js',
            'modals/formulaModal.js', 'modals/helpModal.js', 'modals/resetModal.js'
        ]) {
            assert.ok(names.includes(must), `Отсутствует UI-файл: ${must}`);
        }
    });
});

/* ---------- Этап 10.3.1: trustedHtml как защита innerHTML ---------- */

describe('dom.js: trustedHtml-обёртка (Этап 10.3.1)', () => {
    it('trustedHtml(value) возвращает branded-объект { __trusted: true, value }', async () => {
        const { trustedHtml } = await import(pathToFileURL(join(UI_ROOT, 'dom.js')).href);
        const t = trustedHtml('<x>foo</x>');
        assert.equal(t.__trusted, true);
        assert.equal(t.value, '<x>foo</x>');
    });

    it('trustedHtml(null) и trustedHtml(undefined) → branded-объект с value: ""', async () => {
        const { trustedHtml } = await import(pathToFileURL(join(UI_ROOT, 'dom.js')).href);
        const a = trustedHtml(null);
        const b = trustedHtml(undefined);
        const c = trustedHtml();
        assert.equal(a.__trusted, true);
        assert.equal(a.value, '');
        assert.equal(b.__trusted, true);
        assert.equal(b.value, '');
        assert.equal(c.__trusted, true);
        assert.equal(c.value, '');
    });

    it('el("div", { html: "<x>" }) бросает с упоминанием trustedHtml', async () => {
        const { el } = await import(pathToFileURL(join(UI_ROOT, 'dom.js')).href);
        assert.throws(
            () => el('div', { html: '<x>injected</x>' }),
            (err) => err instanceof Error && /trustedHtml/.test(err.message),
            'el() должен отвергать plain string в props.html и упоминать trustedHtml'
        );
    });

    it('el("div", { trustedHtml: trustedHtml("<x>") }) → innerHTML установлен', async () => {
        const { el, trustedHtml } = await import(pathToFileURL(join(UI_ROOT, 'dom.js')).href);
        const node = el('div', { trustedHtml: trustedHtml('<x>safe</x>') });
        assert.equal(node.innerHTML, '<x>safe</x>');
    });

    it('el("div", { trustedHtml: "<x>" }) (plain string без обёртки) бросает с упоминанием trustedHtml', async () => {
        const { el } = await import(pathToFileURL(join(UI_ROOT, 'dom.js')).href);
        assert.throws(
            () => el('div', { trustedHtml: '<x>raw</x>' }),
            (err) => err instanceof Error && /trustedHtml/.test(err.message),
            'el() должен отвергать plain string в props.trustedHtml и требовать branded-объект'
        );
    });

    it('setTrustedHtml(node, plain string) бросает', async () => {
        const { el, setTrustedHtml, trustedHtml } = await import(pathToFileURL(join(UI_ROOT, 'dom.js')).href);
        const node = el('div');
        assert.throws(
            () => setTrustedHtml(node, '<x>raw</x>'),
            (err) => err instanceof Error && /trustedHtml/.test(err.message),
            'setTrustedHtml должен отвергать plain string'
        );
        // Положительный кейс: branded-объект работает.
        setTrustedHtml(node, trustedHtml('<x>safe</x>'));
        assert.equal(node.innerHTML, '<x>safe</x>');
    });
});

/* ---------- Этап 10.3.2: эмодзи удалены из helpModal ---------- */

describe('helpModal: эмодзи удалены (Этап 10.3.2)', () => {
    it('helpModal.js не содержит эмодзи 📖', async () => {
        const { readFileSync } = await import('node:fs');
        const helpPath = join(UI_ROOT, 'modals', 'helpModal.js');
        const src = readFileSync(helpPath, 'utf8');
        assert.ok(!src.includes('\u{1F4D6}'), 'helpModal.js не должен содержать эмодзи U+1F4D6 (📖)');
    });
});
