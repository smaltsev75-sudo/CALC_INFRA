/**
 * Регрессия 12.U22: модалка «мерцает» при каждом изменении draft.
 *
 * Корень: `renderModals()` в [js/ui/index.js] на каждом rerender'е делает
 * `replace(_modalsRoot, null)` + `appendChild(...)` — т.е. полностью пересоздаёт
 * overlay-узел даже если та же модалка уже была открыта. CSS-анимации
 * `fadeIn 0.2s` (overlay) и `modalIn 0.22s` (modal) перезапускаются на
 * каждой вставке свежего DOM-узла → пользователь видит «мерцание» при любом
 * взаимодействии (выбор опции в select, ввод в input).
 *
 * Решение: помечать классом `modal-overlay-fresh` ТОЛЬКО только что открывшиеся
 * модалки. CSS-анимация привязана к классу, не к базовому `.modal-overlay`.
 *
 * Тест проверяет чистую функцию `_computeFreshModals(rendered, prevOpen)`:
 *   - модалка только что открылась (была закрыта, стала открыта) → попадает в fresh
 *   - модалка остаётся открытой между рендерами → НЕ попадает в fresh (нет flicker'а)
 *   - модалка закрыта (overlay = null) → НЕ попадает в fresh
 *   - модалка закрылась и открылась снова → попадает в fresh (анимация играет заново)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _computeFreshModals } from '../../../js/ui/index.js';

/* Простой mock overlay-узла — в _computeFreshModals нам нужен только сам факт
 * truthy/falsy для каждого имени. */
const o = () => ({ tagName: 'DIV' });

describe('_computeFreshModals — анимация только для впервые открывшихся модалок', () => {
    it('первый рендер: ВСЕ открытые модалки — fresh (анимация появления играет)', () => {
        const rendered = [
            ['message', null],
            ['quickStart', o()],
            ['help', null]
        ];
        const fresh = _computeFreshModals(rendered, new Set());
        assert.equal(fresh.size, 1);
        assert.ok(fresh.has('quickStart'));
    });

    it('повторный рендер с той же открытой модалкой → НЕ fresh (нет flicker)', () => {
        // Первый рендер: quickStart открылась.
        const r1 = [['quickStart', o()]];
        const f1 = _computeFreshModals(r1, new Set());
        assert.ok(f1.has('quickStart'), 'на первом рендере newCalc должна быть fresh');

        // Симулируем patchModal: тот же модальный набор, но prevOpen уже включает 'quickStart'.
        const r2 = [['quickStart', o()]];
        const f2 = _computeFreshModals(r2, new Set(['quickStart']));
        assert.equal(f2.size, 0,
            'модалка, открытая в прошлом рендере, НЕ должна получать класс fresh ' +
            '(иначе CSS-анимация запускается заново — пользователь видит мерцание)');
    });

    it('закрытая модалка (overlay=null) НЕ попадает в fresh', () => {
        const rendered = [['quickStart', null]];
        const fresh = _computeFreshModals(rendered, new Set());
        assert.equal(fresh.size, 0);
    });

    it('модалка закрылась и открылась снова → опять fresh', () => {
        // Сценарий: open → close → open
        const f1 = _computeFreshModals([['quickStart', o()]], new Set());
        assert.ok(f1.has('quickStart'));

        // close: overlay=null, prev включал newCalc.
        const f2 = _computeFreshModals([['quickStart', null]], new Set(['quickStart']));
        assert.equal(f2.size, 0);

        // re-open: overlay есть, prev уже не включает (после close).
        const f3 = _computeFreshModals([['quickStart', o()]], new Set());
        assert.ok(f3.has('quickStart'),
            'после close → re-open анимация должна сыграть снова');
    });

    it('одновременная смена: одна модалка закрылась, другая открылась', () => {
        // Раньше была открыта help, теперь открыта newCalc.
        const rendered = [['help', null], ['quickStart', o()]];
        const prev = new Set(['help']);
        const fresh = _computeFreshModals(rendered, prev);
        assert.equal(fresh.size, 1);
        assert.ok(fresh.has('quickStart'),
            'newCalc только что открылась → fresh');
        assert.ok(!fresh.has('help'),
            'help закрылась (overlay=null) → не fresh, что правильно');
    });

    it('две модалки открыты, одна остаётся, другая впервые → только новая fresh', () => {
        const rendered = [['help', o()], ['quickStart', o()]];
        const prev = new Set(['help']);  // help уже была открыта в прошлый рендер
        const fresh = _computeFreshModals(rendered, prev);
        assert.equal(fresh.size, 1);
        assert.ok(fresh.has('quickStart'));
        assert.ok(!fresh.has('help'),
            'help остаётся открытой между рендерами → НЕ fresh (без перезапуска анимации)');
    });
});

describe('CSS: анимации привязаны к .modal-overlay-fresh, а не к базовому .modal-overlay', async () => {
    /* Дополнительная страховка: если кто-то случайно перенесёт `animation: fadeIn`
     * обратно на `.modal-overlay`, тест упадёт. */
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const cssPath = path.resolve(here, '../../../css/modals.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    it('блок .modal-overlay { ... } НЕ содержит animation: fadeIn', () => {
        const m = css.match(/\.modal-overlay\s*\{([^}]+)\}/);
        assert.ok(m, 'не нашёл блок .modal-overlay в modals.css');
        assert.ok(!/animation\s*:\s*fadeIn/.test(m[1]),
            'animation: fadeIn должна быть на .modal-overlay-fresh, не на .modal-overlay — ' +
            'иначе анимация перезапускается при каждом patchModal (мерцание)');
    });

    it('блок .modal { ... } НЕ содержит animation: modalIn', () => {
        // Берём ПЕРВЫЙ матч `.modal {` — не `.modal-overlay`.
        const m = css.match(/\n\.modal\s*\{([^}]+)\}/);
        assert.ok(m, 'не нашёл блок .modal в modals.css');
        assert.ok(!/animation\s*:\s*modalIn/.test(m[1]),
            'animation: modalIn должна быть на .modal-overlay-fresh .modal, не на базовом .modal');
    });

    it('класс .modal-overlay-fresh определён и содержит animation: fadeIn', () => {
        assert.match(css, /\.modal-overlay-fresh\s*\{[^}]*animation\s*:\s*fadeIn/,
            '.modal-overlay-fresh должна иметь animation: fadeIn для первого появления модалки');
    });

    it('правило .modal-overlay-fresh .modal содержит animation: modalIn', () => {
        assert.match(css, /\.modal-overlay-fresh\s+\.modal\s*\{[^}]*animation\s*:\s*modalIn/,
            '.modal-overlay-fresh .modal должна иметь animation: modalIn для первого появления');
    });
});
