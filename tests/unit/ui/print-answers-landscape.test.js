/**
 * Этап 13.U4: PDF Опросника по умолчанию печатается в A4 landscape, при
 * включённом toggle «портретная ориентация» — в A4 portrait. Реализовано через
 * именованные @page-правила (paLandscape / paPortrait) в css/print.css и
 * body-классы (printing-answers / printing-answers-portrait).
 *
 * Раньше (13.U3) использовался безымянный @page — он накрывал и обычные
 * print-сценарии (Дашборд, Сравнение). Именованные страницы решают эту
 * утечку и одновременно поддерживают переключатель ориентации в модалке.
 *
 * Тест защищает 4 инварианта:
 *   1. @page paLandscape определён с size: A4 landscape;
 *   2. @page paPortrait  определён с size: A4 portrait;
 *   3. body.printing-answers #print-answers-area → page: paLandscape (default);
 *   4. body.printing-answers-portrait #print-answers-area → page: paPortrait
 *      (override; идёт ПОСЛЕ landscape-правила, чтобы при равной специфичности
 *      portrait перезаписывал landscape).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PRINT_CSS = join(__dirname, '..', '..', '..', 'css', 'print.css');

describe('PDF Опросника: ориентация (landscape default + portrait toggle)', () => {

    it('@page paLandscape определён с size: A4 landscape', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const re = /@page\s+paLandscape\s*\{[^}]*size\s*:\s*A4\s+landscape[^}]*\}/i;
        assert.match(css, re,
            '@page paLandscape должен задавать size: A4 landscape — это режим ' +
            'по умолчанию, в котором печатаются длинные вопросы и extended-формат.');
    });

    it('@page paPortrait определён с size: A4 portrait', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const re = /@page\s+paPortrait\s*\{[^}]*size\s*:\s*A4\s+portrait[^}]*\}/i;
        assert.match(css, re,
            '@page paPortrait должен задавать size: A4 portrait — это режим ' +
            'при выключенном toggle «Альбомная ориентация» в модалке.');
    });

    it('body.printing-answers #print-answers-area → page: paLandscape (default)', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const re = /body\.printing-answers\s+#print-answers-area\s*\{[^}]*page\s*:\s*paLandscape/i;
        assert.match(css, re,
            'Базовый класс printing-answers должен мапиться на paLandscape — ' +
            'это даёт landscape по умолчанию.');
    });

    it('body.printing-answers-portrait #print-answers-area → page: paPortrait', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const re = /body\.printing-answers-portrait\s+#print-answers-area\s*\{[^}]*page\s*:\s*paPortrait/i;
        assert.match(css, re,
            'Класс printing-answers-portrait должен мапиться на paPortrait — ' +
            'это активируется когда пользователь снимает toggle.');
    });

    it('portrait-правило идёт ПОСЛЕ landscape (чтобы перебивать его при одинаковой специфичности)', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const idxLandscape = css.search(/body\.printing-answers\s+#print-answers-area\s*\{[^}]*page\s*:\s*paLandscape/i);
        const idxPortrait  = css.search(/body\.printing-answers-portrait\s+#print-answers-area\s*\{[^}]*page\s*:\s*paPortrait/i);
        assert.ok(idxLandscape >= 0 && idxPortrait >= 0, 'оба правила должны существовать');
        assert.ok(idxPortrait > idxLandscape,
            'portrait-правило обязано идти ПОСЛЕ landscape: оба селектора имеют ' +
            'одинаковую специфичность (0,1,2), и при добавлении к body класса ' +
            'printing-answers-portrait — оно поверх — выигрывает по порядку.');
    });

    it('extended-режим определяет ширины колонок в CSS (вопрос/ответ/пояснение)', () => {
        const css = stripCssComments(readFileSync(PRINT_CSS, 'utf8'));
        const re = /printing-answers-extended[^{]*\.pa-th-x\s*\{[^}]*width\s*:\s*\d+%/i;
        assert.ok(re.test(css),
            'CSS должен задать ширину колонки .pa-th-x (Пояснение) в extended-режиме, ' +
            'иначе третья колонка получит дефолтную ширину и выезжает.');
    });
});
