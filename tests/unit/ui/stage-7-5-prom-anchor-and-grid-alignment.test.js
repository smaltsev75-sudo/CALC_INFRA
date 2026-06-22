/**
 * PATCH 2.4.33 — Two UX improvements bundled:
 *
 *   1. ПРОМ AI-stand-factor больше не рендерится как disabled <input>.
 *      Юзер-feedback: «зачем выводишь по ПРОМ если нельзя корректировать?».
 *      Disabled input выглядит как поле — пользователь пытается кликнуть.
 *      Заменено на визуально-отличный anchor-блок с dashed border + accent
 *      цветом + label «эталон» (.stand-prod-anchor / .stand-prod-anchor-value
 *      / .stand-prod-anchor-suffix).
 *
 *   2. .questionnaire-grid .field перешёл с flex на grid с явными
 *      grid-template-rows: minmax(3em, auto) auto 1fr. Раньше flex-column +
 *      min-height: 64px давал плавающий control — когда у соседних полей
 *      label занимал разное число строк (1 vs 2 vs 3), control оказывался
 *      на разной y-позиции. Grid с явным label-floor 3em + control row
 *      auto + desc row 1fr с `align-self: end` фиксирует controls на одной
 *      горизонтали независимо от длины label/desc.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('PATCH 2.4.33 / ПРОМ anchor — renderAiStandFactors', () => {
    const js = stripJsComments(read('js/ui/questionnaireStandSettings.js'));

    it('renderAiStandFactors НЕ создаёт disabled <input> для PROD', () => {
        const fnStart = js.indexOf('function renderAiStandFactors');
        assert.ok(fnStart > 0, 'renderAiStandFactors должна существовать');
        const fnEnd = js.indexOf('\nfunction ', fnStart + 30);
        const body = js.slice(fnStart, fnEnd);
        // prodField не должен содержать <input> с disabled и value: 100.
        // Проверяем отсутствие старого паттерна .input-readonly или
        // disabled: true в prodField блоке.
        const prodFieldStart = body.indexOf('const prodField');
        assert.ok(prodFieldStart > 0, 'prodField блок должен существовать');
        const prodFieldEnd = body.indexOf(';', prodFieldStart);
        const prodFieldBlock = body.slice(prodFieldStart, prodFieldEnd);
        assert.doesNotMatch(prodFieldBlock, /['"]input-readonly['"]/,
            'prodField не должен использовать .input-readonly');
        assert.doesNotMatch(prodFieldBlock, /disabled:\s*true/,
            'prodField не должен иметь disabled:true (раньше disabled-input)');
    });

    it('renderAiStandFactors использует stand-prod-anchor класс для ПРОМ', () => {
        const fnStart = js.indexOf('function renderAiStandFactors');
        const fnEnd = js.indexOf('\nfunction ', fnStart + 30);
        const body = js.slice(fnStart, fnEnd);
        assert.match(body, /class:\s*['"]stand-prod-anchor['"]/,
            'ПРОМ должен рендериться как .stand-prod-anchor (визуально-отличный non-input)');
        assert.match(body, /class:\s*['"]stand-prod-anchor-value['"]/,
            'value sub-element должен быть .stand-prod-anchor-value');
        assert.match(body, /class:\s*['"]stand-prod-anchor-suffix['"]/,
            'suffix («эталон») должен быть .stand-prod-anchor-suffix');
    });
});

describe('PATCH 2.4.33 / ПРОМ anchor — CSS', () => {
    const cssRaw = read('css/forms.css');

    it('.stand-prod-anchor имеет dashed border + accent цвет', () => {
        const body = ruleBody(cssRaw, '.stand-prod-anchor');
        assert.match(body, /border:\s*1px\s+dashed\s+var\(--accent\)/,
            'dashed border + accent — визуальный non-input affordance');
        assert.match(body, /color:\s*var\(--accent\)/,
            'текст в accent для отличия от обычных inputs');
        assert.match(body, /background:\s*var\(--accent-faint\)/,
            'subtle accent-faint background для consistency');
    });

    it('.stand-prod-anchor имеет height: 38px (как inputs — для row-alignment)', () => {
        const body = ruleBody(cssRaw, '.stand-prod-anchor');
        assert.match(body, /height:\s*38px/,
            '38px высота консистентна с .input — controls в одной row на одной y');
    });
});

describe('PATCH 2.4.33 / .questionnaire-grid .field — grid layout для alignment', () => {
    const cssRaw = read('css/forms.css');
    const questionnaireJs = stripJsComments(read('js/ui/questionnaire.js'));

    it('.questionnaire-grid .field использует display: grid', () => {
        const body = ruleBody(cssRaw, '.questionnaire-grid .field');
        assert.match(body, /display:\s*grid/,
            '.field перешёл с flex на grid для детерминированной y-позиции controls');
    });

    it('.questionnaire-grid .field использует grid-template-rows с row-aware label floor', () => {
        // PATCH 2.4.33 floor был 3em (=42px) — фитил 1-2 строки label-text.
        // PATCH 2.4.37 поднял до 4.5em (=63px) — фитит 3+ строки, нужно
        // когда у label есть бейджи «Из мастера AI» / «Не знаю» (~150px)
        // и текст вроде «Запросов к ИИ на одного активного пользователя
        // в день» wrap'ится в 3 строки на ~210px доступного места.
        // PATCH 2.22.40: высота label floor стала row-aware через CSS-переменную:
        // строка сетки берёт максимум по заголовкам именно этой строки, а 4.5em
        // остаётся fallback'ом до JS-измерения.
        const body = ruleBody(cssRaw, '.questionnaire-grid .field');
        assert.match(body,
            /grid-template-rows:\s*minmax\(\s*var\(--question-field-label-height,\s*4\.5em\)\s*,\s*auto\s*\)\s+auto\s+1fr/,
            'rows: row-aware label height / auto для control / 1fr для desc');
    });

    it('.questionnaire-grid .field > .field-description top-aligned (PATCH 2.4.35 заменил end → start)', () => {
        // PATCH 2.4.33 использовал align-self: end. PATCH 2.4.35 заменил на
        // start: bottom-align создавал visual gap у 1-line desc внутри row
        // с 2-line siblings. Top-align консистентнее визуально.
        const body = ruleBody(cssRaw, '.questionnaire-grid .field > .field-description');
        assert.match(body, /align-self:\s*start/,
            'description top-aligned через align-self: start (PATCH 2.4.35)');
    });

    it('controls (.switch / .input / .segmented / .multiselect) имеют align-self: center', () => {
        const stripped = stripCssComments(cssRaw);
        // Group selector — все controls в .questionnaire-grid .field получают align-self: center
        assert.match(stripped,
            /\.questionnaire-grid\s+\.field\s*>\s*\.switch[\s\S]{0,400}?align-self:\s*center/,
            'switch / input / segmented / multiselect должны иметь align-self: center');
    });

    it('scheduleQuestionnaireFieldAlignment повторяет пересчёт после монтирования DOM', () => {
        const start = questionnaireJs.indexOf('function scheduleQuestionnaireFieldAlignment');
        assert.ok(start > 0, 'scheduleQuestionnaireFieldAlignment должна существовать');
        const end = questionnaireJs.indexOf('\nfunction ', start + 30);
        const body = questionnaireJs.slice(start, end);

        assert.match(body, /requestAnimationFrame/,
            'первый пересчёт должен идти через requestAnimationFrame');
        assert.match(body, /setTimeout/,
            'нужны повторные попытки после вставки вкладки в DOM и стабилизации layout');
        assert.match(body, /80|120|160|240|250/,
            'повторный пересчёт должен быть отложен на следующий layout-tick, а не только на текущий кадр');
    });
});
