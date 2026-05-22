/**
 * setButtonLoading + .btn-loading контракт.
 *
 * Этап 12.1.3: длительные async-операции (импорт/экспорт/печать) маркируют
 * вызывающую кнопку через setButtonLoading() — кнопка получает класс
 * .btn-loading и атрибут disabled на время операции, в finally состояние
 * снимается. Тест проверяет:
 *   1. setButtonLoading(btn, true) — добавляет класс и disabled.
 *   2. setButtonLoading(btn, false) — снимает оба.
 *   3. Безопасен к null/undefined/objects без classList.
 *   4. CSS-правило .btn-loading присутствует в css/components.css
 *      и содержит spinner-анимацию.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

/* ---------- Минимальный DOM-mock для setButtonLoading ---------- */

class MockClassList {
    constructor() { this._set = new Set(); }
    add(cls)      { this._set.add(cls); }
    remove(cls)   { this._set.delete(cls); }
    contains(cls) { return this._set.has(cls); }
}

function mockButton() {
    return {
        tagName: 'BUTTON',
        classList: new MockClassList(),
        disabled: false
    };
}

describe('setButtonLoading (Этап 12.1.3)', () => {
    let setButtonLoading;

    before(async () => {
        // dom.js использует document при загрузке (escapeHtml не использует, но el() — да).
        // Имитируем минимум, чтобы import не упал.
        globalThis.document = globalThis.document || {
            createElement: () => mockButton(),
            createTextNode: () => ({})
        };
        const mod = await import('../../../js/ui/dom.js');
        setButtonLoading = mod.setButtonLoading;
    });

    it('isLoading=true — навешивает .btn-loading и disabled', () => {
        const btn = mockButton();
        setButtonLoading(btn, true);
        assert.equal(btn.classList.contains('btn-loading'), true);
        assert.equal(btn.disabled, true);
    });

    it('isLoading=false — снимает .btn-loading и disabled', () => {
        const btn = mockButton();
        setButtonLoading(btn, true);
        setButtonLoading(btn, false);
        assert.equal(btn.classList.contains('btn-loading'), false);
        assert.equal(btn.disabled, false);
    });

    it('btn=null — не бросает', () => {
        assert.doesNotThrow(() => setButtonLoading(null, true));
        assert.doesNotThrow(() => setButtonLoading(undefined, false));
    });

    it('btn без classList — не бросает (дефенсивная проверка)', () => {
        assert.doesNotThrow(() => setButtonLoading({ tagName: 'BUTTON' }, true));
    });
});

describe('CSS-контракт .btn-loading в css/components.css', () => {
    const css = readFileSync(join(REPO_ROOT, 'css', 'components.css'), 'utf8');

    it('содержит правило .btn-loading', () => {
        assert.match(css, /\.btn-loading\s*\{/);
    });

    it('содержит spinner-анимацию (@keyframes btn-spin)', () => {
        assert.match(css, /@keyframes\s+btn-spin/);
    });

    it('.btn-loading::after с border-radius 50% (CSS-only spinner)', () => {
        assert.match(css, /\.btn-loading::after[^{]*\{[\s\S]*?border-radius\s*:\s*50%/);
    });
});
