/**
 * UX-ревью (2026-05-31, #5): на ноутбучных ширинах (1280–1600px) кластер из 8
 * кнопок топбара вытеснял имя активного расчёта (.app-topbar-title), и оно
 * обрезалось в «Текущий...» (clientWidth 85px vs scrollWidth 248px на 1440px).
 *
 * Фикс: .app-topbar получает flex-wrap, а .app-topbar-title — ненулевой min-width.
 * Когда actions не помещаются рядом — они переносятся на вторую строку, а имя
 * расчёта получает полную строку. Широкие экраны (≥~1600px) остаются в одну строку.
 *
 * Поведенческая проверка (clientWidth ≥ scrollWidth на 1440px) — в desktop
 * Playwright-смоуке; здесь — регресс-гард, что flex-wrap и min-width не откатили.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments, ruleBody } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const layoutCss = stripCssComments(fs.readFileSync(
    path.resolve(here, '../../../css/layout.css'), 'utf8'));

describe('Топбар: имя расчёта не обрезается (flex-wrap + min-width)', () => {
    it('.app-topbar разрешает перенос (flex-wrap: wrap)', () => {
        const body = ruleBody(layoutCss, '.app-topbar');
        assert.ok(body, 'нет правила .app-topbar');
        assert.match(body, /flex-wrap\s*:\s*wrap/,
            '.app-topbar должен иметь flex-wrap: wrap — иначе actions не переносятся ' +
            'и title сжимается до многоточия на ноутбуках');
    });

    it('.app-topbar-title резервирует место (min-width ≥ 10rem, не 0)', () => {
        const body = ruleBody(layoutCss, '.app-topbar-title');
        assert.ok(body, 'нет правила .app-topbar-title');
        const m = body.match(/min-width\s*:\s*([0-9.]+)\s*rem/);
        assert.ok(m, '.app-topbar-title должен иметь min-width в rem (резерв под имя расчёта)');
        assert.ok(parseFloat(m[1]) >= 10,
            `min-width = ${m[1]}rem: должен быть ≥ 10rem, чтобы имя расчёта помещалось ` +
            `до переноса actions на вторую строку`);
    });
});
