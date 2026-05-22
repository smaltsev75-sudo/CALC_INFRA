/**
 * Regression-тест к 12.U31 (Code Review Followup, Subagent E P1):
 * в visible UI-строках `js/ui/comparison.js` НЕ должно быть unicode-эмодзи.
 * CLAUDE.md правило: «Эмодзи в UI запрещены — только line-SVG из icons.js
 * (Lucide). В .md и комментариях кода — допустимы».
 *
 * До правки бейдж сортировки (`'🟢 → 🔴'`) и tooltip колонок (`'Сортировка:
 * 🟢 → 🟡 → 🔴 → нет...'`) содержали эмодзи — нарушение собственного правила.
 * Дополнительно эмодзи: (а) разный рендеринг на платформах (tofu-квадраты на
 * системах без emoji-fonts), (б) screen-reader произносит «зелёный круг»
 * (без смысла), (в) не различимы для colorblind.
 *
 * Тест ловит эмодзи в `text:` / `title:` атрибутах `el()`-вызовов и в
 * tooltip-сообщениях. Допускает эмодзи в JSDoc-комментариях.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const compSrc   = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'comparison.js'),
    'utf8'
);

import { stripJsComments } from '../../_helpers/source.js';

/* Юникод-эмодзи: цветные квадраты/кружки (used for sort indicators),
   стрелки-эмодзи (variation-selector-16), палитра Misc Symbols & Pictographs. */
const EMOJI_RE = /[\u{1F300}-\u{1F9FF}\u{1FA70}-\u{1FAFF}]|[\u{2600}-\u{26FF}\u{2700}-\u{27BF}]️?/u;

describe('comparison.js: visible UI-строки без эмодзи (CLAUDE.md «no emoji in UI»)', () => {
    it('исходник без эмодзи (после удаления комментариев)', () => {
        const stripped = stripJsComments(compSrc);
        const m = stripped.match(EMOJI_RE);
        assert.equal(m, null,
            `Найдено эмодзи "${m && m[0]}" в visible части comparison.js. ` +
            'Замените на CSS-класс (.cmp-dot-green/yellow/red) или Lucide line-SVG. ' +
            'Текстовое описание в title: «зелёный → красный» вместо «🟢 → 🔴».');
    });
});
