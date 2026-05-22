/**
 * UI-улучшения после ревью (2026-05-05): @container queries для stand-card.
 *
 * Stand-card — независимый компонент, чьи внутренние пропорции (font-size
 * total-value, видимость cats-block) должны зависеть от ШИРИНЫ САМОЙ КАРТОЧКИ,
 * а не от viewport. На viewport=1500px разные grid-layout'ы (5 колонок vs
 * 3 колонки) дают разную ширину карточки при одинаковом viewport, и @media
 * по viewport такие случаи не различает.
 *
 * Решение: containment context на .dash-stand-card через
 * `container-type: inline-size` + `container-name: stand-card`, и адаптация
 * через `@container stand-card (max-width: ...)`.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments, ruleBody } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, '../../../css/dashboard.css');
const css = fs.readFileSync(cssPath, 'utf8');
const stripped = stripCssComments(css);

describe('@container queries для stand-card', () => {
    it('.dash-stand-card имеет container-type: inline-size', () => {
        // Не используем ruleBody — он берёт ПЕРВЫЙ матч, а .dash-stand-card
        // в файле есть и в селекторе .dash-stand-card-* — нужно искать точнее.
        const m = stripped.match(/\n\.dash-stand-card\s*\{([^}]+)\}/);
        assert.ok(m, 'не нашёл блок .dash-stand-card');
        assert.match(m[1], /container-type\s*:\s*inline-size/,
            '.dash-stand-card должен иметь `container-type: inline-size` для активации @container queries');
    });

    it('.dash-stand-card имеет container-name: stand-card', () => {
        const m = stripped.match(/\n\.dash-stand-card\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /container-name\s*:\s*stand-card/,
            '.dash-stand-card должен иметь явное container-name для именованных @container queries');
    });

    it('есть @container правило для узкой карточки (max-width)', () => {
        assert.match(stripped, /@container\s+stand-card\s*\(\s*max-width\s*:[^)]+\)\s*\{/,
            'нужно правило @container stand-card (max-width: ...) для адаптации компактного варианта');
    });

    it('узкое правило @container уменьшает font-size .dash-stand-card-total-value', () => {
        const m = stripped.match(/@container\s+stand-card\s*\(\s*max-width[^)]+\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(m, 'не нашёл body @container max-width правила');
        assert.match(m[1], /\.dash-stand-card-total-value[^{]*\{[^}]*font-size/,
            'в @container max-width должен переопределяться font-size .dash-stand-card-total-value');
    });

    it('есть @container правило для широкой карточки (min-width)', () => {
        assert.match(stripped, /@container\s+stand-card\s*\(\s*min-width\s*:[^)]+\)\s*\{/,
            'нужно правило @container stand-card (min-width: ...) для расширенного варианта');
    });
});
