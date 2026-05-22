/**
 * 12.U25-fix-9: eyebrow-подзаголовок карточки «Вклад риск-коэффициентов»
 * не должен ломаться по середине числа.
 *
 * Проблема: блок «Общая наценка +85.6% · 75 тыс. ₽ / день» в карточке Вклад
 * без display:flex+flex-wrap раскидывается на 2 строки по словам — «75 тыс.»
 * на одной, «₽ / день» на другой. Выглядит как вёрстка-баг.
 *
 * Фикс — display:flex c flex-wrap:wrap на контейнере + white-space:nowrap
 * на дочерних spans (% и сумма становятся атомарными единицами; если не
 * помещаются — переносится целая «единица», не середина её).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssSource = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'dashboard.css'),
    'utf8'
);

describe('Карточка «Вклад риск-коэффициентов» — eyebrow без переноса по середине числа', () => {
    it('.dash-card-eyebrow-sub — flex/inline-flex с flex-wrap (атомарные дети не рвутся посередине)', () => {
        const m = cssSource.match(/\.dash-card-eyebrow-sub\s*\{([^}]+)\}/);
        assert.ok(m, '.dash-card-eyebrow-sub должен быть определён');
        const body = m[1];
        assert.match(body, /display\s*:\s*(?:inline-)?flex/,
            '.dash-card-eyebrow-sub должен быть flex/inline-flex — иначе spans wrap по словам внутри одного span');
        assert.match(body, /flex-wrap\s*:\s*wrap/,
            '.dash-card-eyebrow-sub должен иметь flex-wrap: wrap — чтобы при нехватке места атомарные spans уходили на новую строку целиком');
    });

    it('.dash-risk-surplus-amount — white-space: nowrap (сумма «75 тыс. ₽ / день» не рвётся)', () => {
        const m = cssSource.match(/\.dash-risk-surplus-amount\s*\{([^}]+)\}/);
        assert.ok(m, '.dash-risk-surplus-amount должен быть определён');
        const body = m[1];
        assert.match(body, /white-space\s*:\s*nowrap/,
            'сумма «X тыс. ₽ / период» должна быть атомарной — иначе ломается по середине');
    });

    it('.dash-risk-surplus — white-space: nowrap (процент «+85.6%» не рвётся между знаком и числом)', () => {
        const m = cssSource.match(/\.dash-risk-surplus\s*\{([^}]+)\}/);
        assert.ok(m, '.dash-risk-surplus должен быть определён');
        const body = m[1];
        assert.match(body, /white-space\s*:\s*nowrap/,
            'процент «+85.6%» должен быть атомарным');
    });
});
