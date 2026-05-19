/**
 * Архитектурный инвариант: множества модалок в MODAL_ORDER и MODAL_RENDERERS
 * (js/ui/index.js) должны совпадать.
 *
 * Если модалка рендерится (есть в MODAL_RENDERERS), но отсутствует в MODAL_ORDER,
 * `topOpenModalName()` её не видит → focus-trap и первичный фокус не активируются,
 * Tab уходит за overlay (нарушение WCAG 2.1 + сломанная клавиатурная навигация).
 *
 * Обратно: если модалка есть в MODAL_ORDER, но её нет в MODAL_RENDERERS — это
 * мёртвая запись, которая ни на что не влияет (низкий приоритет, но всё равно
 * мусор). Тест ловит оба случая.
 *
 * Порядок (z-приоритет vs DOM-порядок) специально НЕ проверяется — это разные
 * семантики, см. JSDoc к MODAL_ORDER.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const src = stripJsComments(readFileSync(join('js', 'ui', 'index.js'), 'utf8'));

function extractModalOrderNames() {
    const m = src.match(/const\s+MODAL_ORDER\s*=\s*\[([\s\S]+?)\]\s*;/);
    if (!m) throw new Error('MODAL_ORDER declaration not found in js/ui/index.js');
    return [...m[1].matchAll(/'([a-zA-Z][a-zA-Z0-9]*)'/g)].map(x => x[1]);
}

function extractModalRendererNames() {
    const m = src.match(/const\s+MODAL_RENDERERS\s*=\s*\[([\s\S]+?)\]\s*;/);
    if (!m) throw new Error('MODAL_RENDERERS declaration not found in js/ui/index.js');
    return [...m[1].matchAll(/\[\s*'([a-zA-Z][a-zA-Z0-9]*)'\s*,/g)].map(x => x[1]);
}

test('MODAL_ORDER и MODAL_RENDERERS содержат идентичные множества модалок', () => {
    const orderNames = extractModalOrderNames();
    const rendererNames = extractModalRendererNames();

    assert.ok(orderNames.length > 0, 'MODAL_ORDER пустой — парсер не нашёл имена');
    assert.ok(rendererNames.length > 0, 'MODAL_RENDERERS пустой — парсер не нашёл имена');

    const orderSet = new Set(orderNames);
    const rendererSet = new Set(rendererNames);

    const missingInOrder = rendererNames.filter(n => !orderSet.has(n));
    const missingInRenderers = orderNames.filter(n => !rendererSet.has(n));

    assert.deepEqual(
        missingInOrder, [],
        `Модалки рендерятся, но отсутствуют в MODAL_ORDER (focus-trap не сработает): ${missingInOrder.join(', ')}`
    );
    assert.deepEqual(
        missingInRenderers, [],
        `Модалки есть в MODAL_ORDER, но не рендерятся (мёртвые записи): ${missingInRenderers.join(', ')}`
    );
});

test('MODAL_ORDER не содержит дубликатов', () => {
    const names = extractModalOrderNames();
    assert.equal(names.length, new Set(names).size, `Дубликаты в MODAL_ORDER: ${names.join(', ')}`);
});

test('MODAL_RENDERERS не содержит дубликатов', () => {
    const names = extractModalRendererNames();
    assert.equal(names.length, new Set(names).size, `Дубликаты в MODAL_RENDERERS: ${names.join(', ')}`);
});
