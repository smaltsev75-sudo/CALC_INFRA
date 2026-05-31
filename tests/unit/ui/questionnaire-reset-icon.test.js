/**
 * UX-ревью (2026-05-31, #7): кнопка «Сбросить ответы к рекомендуемым» в подвале
 * Опросника использовала сырой юникод-глиф ↺ (U+21BA) — единственное такое место
 * среди reset-кнопок, рендерится разной толщиной по шрифтам/ОС и нарушает правило
 * проекта «только Lucide-SVG, глифы в UI запрещены». Заменено на icon('rotate-ccw').
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
// Глифы в комментариях допустимы (правило проекта — про UI-узлы); снимаем комментарии.
const src = stripJsComments(fs.readFileSync(path.resolve(here, '../../../js/ui/questionnaire.js'), 'utf8'));

describe('Опросник: кнопка сброса — Lucide-иконка, не глиф (#7)', () => {
    it('нет сырого глифа ↺/↻/⟳ в коде questionnaire.js (вне комментариев)', () => {
        assert.doesNotMatch(src, /[↺↻⟳]/,
            'reset-кнопка должна использовать icon(), а не сырой юникод-глиф ↺');
    });
    it('кнопка сброса использует icon(\'rotate-ccw\')', () => {
        assert.match(src, /icon\(\s*['"]rotate-ccw['"]/,
            'кнопка «Сбросить ответы к рекомендуемым» должна рендерить Lucide-иконку rotate-ccw');
    });
});
