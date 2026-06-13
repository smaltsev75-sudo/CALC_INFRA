import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

let activeDom = null;
let previousGlobals = new Map();

function setGlobal(name, value) {
    if (!previousGlobals.has(name)) {
        previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {
        configurable: true,
        writable: true,
        value
    });
}

function installJSDom() {
    activeDom = new JSDOM('<!doctype html><html><body></body></html>', {
        url: 'http://localhost/'
    });
    setGlobal('window', activeDom.window);
    setGlobal('document', activeDom.window.document);
    setGlobal('HTMLElement', activeDom.window.HTMLElement);
    setGlobal('Node', activeDom.window.Node);
    setGlobal('requestAnimationFrame', (fn) => {
        fn();
        return 0;
    });
    activeDom.window.HTMLAnchorElement.prototype.click = function click() {};
}

function restoreJSDom() {
    for (const [name, descriptor] of [...previousGlobals.entries()].reverse()) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
    }
    previousGlobals = new Map();
    activeDom?.window.close();
    activeDom = null;
}

describe('CSV export: защита от формул в ячейках', () => {
    beforeEach(() => installJSDom());
    afterEach(() => restoreJSDom());

    it('buildProdPassportCsv сохраняет формат Excel-RU и нейтрализует формулы', async () => {
        const { buildProdPassportCsv } = await import('../../../js/ui/prodPassportReport.js');
        const model = {
            items: [{
                name: '=1+1',
                quantityText: '1',
                monthlyCost: 1000,
                budgetShareText: '100%'
            }]
        };

        const csv = buildProdPassportCsv(model);

        assert.equal(csv.charCodeAt(0), 0xFEFF);
        assert.ok(csv.startsWith('\ufeffЭК;Количество;Бюджет/мес., тыс.руб.;% бюджета'));
        assert.match(csv, /\r\n"\'=1\+1";1;1;100%/);
        assert.doesNotMatch(csv, /\r?\n=1\+1;1;1;100%/);
        assert.equal(csv.split('\r\n').length, 2);
    });

    it('exportProdPassportCsv скачивает CSV, построенный buildProdPassportCsv', async () => {
        const {
            buildProdPassportCsv,
            exportProdPassportCsv
        } = await import('../../../js/ui/prodPassportReport.js');
        let blobParts = [];
        const model = {
            items: [{
                name: '=1+1',
                quantityText: '1',
                monthlyCost: 1000,
                budgetShareText: '100%'
            }]
        };

        setGlobal('Blob', class Blob {
            constructor(parts) {
                blobParts = parts;
            }
        });
        setGlobal('URL', {
            createObjectURL: () => 'blob:prod-passport-csv-test',
            revokeObjectURL() {}
        });
        setGlobal('setTimeout', () => 0);

        const result = exportProdPassportCsv(model, 'csv-test');

        const csv = blobParts.map(part => String(part)).join('');
        assert.deepEqual(result, { ok: true });
        assert.equal(buildProdPassportCsv(model), csv);
    });

    it('exportProdPassportCsv показывает ошибку, если браузер не смог создать download-url', async () => {
        const { exportProdPassportCsv } = await import('../../../js/ui/prodPassportReport.js');
        const logs = [];
        const originalConsoleError = console.error;

        setGlobal('Blob', class Blob {});
        setGlobal('URL', {
            createObjectURL: () => {
                throw new Error('createObjectURL failed');
            },
            revokeObjectURL() {}
        });
        setGlobal('setTimeout', () => 0);
        console.error = (...args) => logs.push(args);

        try {
            const result = exportProdPassportCsv({ items: [] }, 'csv-test');

            assert.equal(result.ok, false);
            assert.ok(result.error instanceof Error);
            assert.match(document.body.textContent, /Не удалось скачать CSV Паспорта ПРОМ/);
            assert.ok(logs.some(args => String(args[0]).includes('Не удалось скачать CSV Паспорта ПРОМ')));
        } finally {
            console.error = originalConsoleError;
        }
    });
});
