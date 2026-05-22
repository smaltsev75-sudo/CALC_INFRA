/**
 * PATCH 2.4.36 — AI-метрики на стенд-карточке: qty и unit разнесены по
 * двум строкам.
 *
 * Bug: пользователь screenshot'ом показал, что на стенд-карточке внутри
 * карточки AI-метрики «Токены» отображались как:
 *
 *     267 015 млн токенов
 *             / мес
 *
 * Длинный русский unit «млн токенов / мес» wrap'ился прямо рядом с числом
 * (был inline-flex baseline), занимал визуальное место разрядов, ломал
 * tabular-nums-выравнивание чисел между метриками.
 *
 * Fix: .dash-ai-metric-row-value перевод с inline-flex на flex-column.
 * qty крупным шрифтом сверху, unit мелкий + приглушённый снизу — паттерн
 * параллельный hardware-метрикам (.dash-resource-row-value уже так делал).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PATCH 2.4.36 / AI-metric value stacked', () => {
    const cssRaw = read('css/dashboard.css');

    it('.dash-ai-metric-row-value использует flex-column (qty над unit)', () => {
        const body = ruleBody(cssRaw, '.dash-ai-metric-row-value');
        assert.match(body, /display:\s*flex\b/,
            'flex layout (column) — qty над unit');
        assert.match(body, /flex-direction:\s*column/,
            'flex-direction: column — vertical stack qty + unit');
        assert.doesNotMatch(body, /align-items:\s*baseline/,
            'baseline (inline-flex baseline-режим) удалён — это был старый side-by-side layout');
    });

    it('.dash-ai-metric-row-value НЕ использует inline-flex (regression-guard)', () => {
        const body = ruleBody(cssRaw, '.dash-ai-metric-row-value');
        assert.doesNotMatch(body, /display:\s*inline-flex/,
            'inline-flex удалён — был причиной side-by-side qty + unit с переносом по словам');
    });

    it('.dash-ai-metric-row-unit допускает wrap (white-space: normal)', () => {
        // На узких стенд-карточках длинный unit «млн токенов / мес» может
        // не помещаться в одну строку — нужен wrap, не ellipsis.
        const body = ruleBody(cssRaw, '.dash-ai-metric-row-unit');
        assert.match(body, /white-space:\s*normal\b/,
            'white-space: normal — unit может занять 2 строки на узкой карточке');
        assert.match(body, /overflow-wrap:\s*anywhere/,
            'overflow-wrap: anywhere — на очень узком cell unit не overflow\'ит за рамку');
    });

    it('.dash-ai-metric-row-qty имеет line-height (visual rhythm к unit)', () => {
        const body = ruleBody(cssRaw, '.dash-ai-metric-row-qty');
        assert.match(body, /line-height:\s*1\.\d+/,
            'line-height задан явно — qty и unit без разрыва (default 1.5 даёт пустоту)');
    });
});
