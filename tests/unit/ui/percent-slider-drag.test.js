/**
 * Percent slider drag: жалоба пользователя «не сдвинуть мышью зелёный thumb».
 *
 * Причина: `<input type="range" class="percent-slider">` использует
 * pointer-capture внутри браузера. Каждое движение мыши на 1px вызывает
 * `input`-событие; обработчик `onInput` коммитит значение в store →
 * subscriber в app.js планирует rAF render → DOM полностью перерисовывается
 * через el(...) → старый input-узел заменяется новым → pointer-capture
 * теряется → drag прерывается уже на первом mousemove. Пользователь видит
 * это как «слайдер не двигается».
 *
 * Стандартный паттерн для controlled range slider в vanilla:
 *   - `input` event (живой drag) — только локальный визуальный sync
 *     (number-input value), БЕЗ commit в store/state.
 *   - `change` event (mouseup, end of drag) — собственно commit, render.
 *
 * Этот тест анализирует исходник renderPercentField и требует:
 *   1) на percent-slider ЕСТЬ `onChange:` обработчик (commit на mouseup);
 *   2) внутри `onInput` percent-slider'а НЕ вызывается переданный извне
 *      callback `onChange(...)` — иначе DOM пересоздаётся в ходе drag'а.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUEST_PATH = join(__dirname, '..', '..', '..', 'js', 'ui', 'questionnairePercentField.js');

/** Извлечь тело el-блока, начиная с маркера `class: 'percent-slider'`,
 *  балансируя круглые скобки до закрывающей `)`. */
function extractPercentSliderElBlock(src) {
    const stripped = stripJsComments(src);
    const marker = "class: 'percent-slider'";
    const idx = stripped.indexOf(marker);
    if (idx === -1) return null;
    // Откатиться назад до открывающей `el(` объекта-props.
    // Проще: идём вперёд от marker до закрывающей `)` (с балансом скобок).
    let i = idx;
    let depth = 0;
    // Поднимем depth до 1 — мы внутри `el('input', { ... })`.
    // Найдём предыдущий `{` (props-объект).
    while (i > 0 && stripped[i] !== '{') i--;
    const start = i;
    depth = 0;
    let j = start;
    while (j < stripped.length) {
        const ch = stripped[j];
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return stripped.slice(start, j + 1);
        }
        j++;
    }
    return null;
}

describe('percent-slider: drag не должен прерываться commit\'ами в store', () => {
    const src = readFileSync(QUEST_PATH, 'utf8');
    const block = extractPercentSliderElBlock(src);
    assert.ok(block, 'percent-slider el-блок не найден в questionnairePercentField.js');

    it('percent-slider имеет onChange-обработчик (commit на mouseup)', () => {
        assert.ok(
            /\bonChange\s*:\s*/.test(block),
            'percent-slider не подписан на change-event — без него после ' +
            'разделения onInput/onChange коммит в store вообще не произойдёт.'
        );
    });

    it('onInput percent-slider\'а не вызывает переданный извне onChange', () => {
        // Извлечь тело onInput-обработчика. Балансируем `{...}` после onInput:.
        const onInputIdx = block.search(/\bonInput\s*:\s*\(?[^=]*=>\s*\{/);
        assert.ok(onInputIdx !== -1, 'onInput-обработчик не найден в percent-slider');
        const fromInput = block.slice(onInputIdx);
        // Найти первую `{` после `=>` и взять её body с балансом.
        const arrowAt = fromInput.indexOf('=>');
        const braceAt = fromInput.indexOf('{', arrowAt);
        assert.ok(braceAt !== -1, 'тело onInput не найдено');
        let depth = 1;
        let k = braceAt + 1;
        while (k < fromInput.length && depth > 0) {
            const ch = fromInput[k];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth === 0) break;
            k++;
        }
        const onInputBody = fromInput.slice(braceAt + 1, k);
        assert.ok(
            !/\bonChange\s*\(/.test(onInputBody),
            'percent-slider.onInput вызывает onChange(...) — каждый mousemove ' +
            'триггерит store-commit → rAF render → DOM-replace → drag прерывается. ' +
            'Перенести вызов onChange(...) в обработчик onChange (mouseup), ' +
            'оставить в onInput только локальный sync number-input value.'
        );
    });
});
