/**
 * UI-улучшения после ревью (2026-05-05): fluid typography через clamp().
 *
 * Крупные font-токены (--font-lg / --font-xl / --font-2xl) должны использовать
 * clamp(MIN, FALLBACK + Nvw, MAX) вместо фиксированных rem. Это даёт:
 *   - на узком viewport (≤480px) шрифт не уезжает в нечитаемый минимум;
 *   - на широком (≥1280px) шрифт не «улетает» в гигантский размер;
 *   - между — плавная интерполяция через 1vw без необходимости media-queries.
 *
 * Малые токены (--font-xs / --font-sm / --font-base / --font-md) остаются
 * фиксированными rem — для текста-в-теле fluid не нужен (читаемость body
 * стабильна, и users делают браузерный zoom).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, '../../../css/base.css');
const css = stripCssComments(fs.readFileSync(cssPath, 'utf8'));

function tokenValue(name) {
    const re = new RegExp('\\B--' + name + '\\s*:\\s*([^;]+);');
    const m = css.match(re);
    if (!m) throw new Error(`токен --${name} не найден в base.css`);
    return m[1].trim();
}

describe('Fluid typography через clamp() для крупных font-токенов', () => {
    it('--font-lg использует clamp() и имеет min/max в разумных пределах', () => {
        const v = tokenValue('font-lg');
        assert.match(v, /^clamp\s*\(/,
            `--font-lg должен использовать clamp() для fluid scaling, получили: ${v}`);
        // Должен включать min ~1.15rem и max ~1.3rem
        assert.match(v, /1\.15rem/,
            '--font-lg min ≈ 1.15rem (читаемый минимум на мобильном)');
        assert.match(v, /1\.3rem/,
            '--font-lg max ≈ 1.3rem (прежнее значение на десктопе как ceiling)');
    });

    it('--font-xl использует clamp()', () => {
        const v = tokenValue('font-xl');
        assert.match(v, /^clamp\s*\(/,
            `--font-xl должен использовать clamp(), получили: ${v}`);
        assert.match(v, /1\.6rem/,
            '--font-xl max = 1.6rem (прежнее ceiling)');
    });

    it('--font-2xl использует clamp()', () => {
        const v = tokenValue('font-2xl');
        assert.match(v, /^clamp\s*\(/,
            `--font-2xl должен использовать clamp(), получили: ${v}`);
        assert.match(v, /2\.1rem/,
            '--font-2xl max = 2.1rem (прежнее ceiling)');
    });

    it('малые токены НЕ используют clamp() — для body-текста стабильность важнее', () => {
        for (const name of ['font-xs', 'font-sm', 'font-base', 'font-md']) {
            const v = tokenValue(name);
            assert.ok(!/clamp\s*\(/.test(v),
                `--${name} = ${v}: малые токены должны быть фиксированными ` +
                `(пользователь использует браузерный zoom для body-текста)`);
        }
    });

    it('каждый clamp() содержит ровно 3 аргумента, разделённых запятой', () => {
        for (const name of ['font-lg', 'font-xl', 'font-2xl']) {
            const v = tokenValue(name);
            // clamp(min, preferred, max) — 3 аргумента
            const inner = v.replace(/^clamp\s*\(/, '').replace(/\)\s*$/, '');
            const parts = inner.split(',');
            assert.equal(parts.length, 3,
                `--${name}: clamp() должен иметь 3 аргумента (min, preferred, max), ` +
                `получили ${parts.length}: ${v}`);
        }
    });

    it('preferred-выражение clamp() содержит vw — иначе fluid scaling не работает', () => {
        for (const name of ['font-lg', 'font-xl', 'font-2xl']) {
            const v = tokenValue(name);
            const inner = v.replace(/^clamp\s*\(/, '').replace(/\)\s*$/, '');
            const parts = inner.split(',');
            const preferred = parts[1].trim();
            assert.match(preferred, /vw/,
                `--${name}: средний аргумент clamp() должен содержать vw для viewport-зависимости, ` +
                `получили: ${preferred}`);
        }
    });
});
