/**
 * Фикс 2026-06-17: на плитках «Карты бюджета ПРОМ» крупное число (826/177…)
 * выводилось без единицы измерения (stripMonthlySuffix срезал её ради
 * компактности) — пользователь не понимал, что это тыс.₽/мес. Единица qty в
 * строке выше («840 млн токенов») есть, а у стоимости — нет (асимметрия).
 *
 * Каждая плитка должна показывать единицу стоимости (pp-tile-unit) — карта
 * бывает развёрнута, и caption-подсказка в шапке тогда не видна.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = stripJsComments(
    readFileSync(path.resolve(__dirname, '../../../js/ui/prodPassportReport.js'), 'utf8')
);

describe('passport tile — единица стоимости на плитке', () => {
    it('плитки рендерят pp-tile-unit с единицей тыс.₽/мес', () => {
        const unitSpans = (SRC.match(/pp-tile-unit/g) || []).length;
        assert.ok(unitSpans >= 2, `ожидалось ≥2 pp-tile-unit (обе плитки), найдено ${unitSpans}`);
        assert.ok(/тыс\.₽\/мес/.test(SRC), 'единица «тыс.₽/мес» должна присутствовать в рендере плитки');
    });
});
