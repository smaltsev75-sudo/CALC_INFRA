/**
 * Stage 5.4 — Section-level progress chips.
 *
 * Раньше chip в заголовке секции показывал `${answered} / ${total}` где total =
 * физическое число вопросов в секции. Это было дезинформацией: AI/LLM/RAG
 * содержит 14 вопросов, gated по master-toggle `ai_llm_used`. При выключенном
 * мастере пользователь видел «0 / 14» — будто 14 полей нужно заполнить, хотя
 * физически они заблокированы.
 *
 * Stage 5.4 правка:
 *   • visibleTotal = число вопросов, НЕ gated по dependsOn (через
 *     dependsOnUnmet, тот же helper, что использует renderQuestionField).
 *   • answered считается только по visible.
 *   • Если visibleTotal === 0 → chip = «—» с класс-маркером is-gated и
 *     tooltip-объяснением «включите master-переключатель».
 *   • Иначе chip = «answered / visibleTotal» с tooltip «Уточнено N из M».
 *
 * Защищается через source-grep (renderer работает в браузере, не в node без DOM-mock).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 5.4 / questionnaire.js — visible-only counting', () => {
    it('renderSection использует dependsOnUnmet для отделения visible от gated', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        // Внутри renderSection должен быть вызов dependsOnUnmet(q, calc) или его
        // result в условии continue/skip.
        const renderSectionStart = src.indexOf('function renderSection(');
        assert.ok(renderSectionStart > 0, 'renderSection должен существовать');
        // Тело функции до первого следующего объявления function на корневом уровне:
        const tail = src.slice(renderSectionStart);
        // Берём ~5000 символов — этого хватает на тело
        const body = tail.slice(0, 5000);
        assert.match(body, /dependsOnUnmet\s*\(\s*q\s*,\s*calc\s*\)/,
            'renderSection должен вызывать dependsOnUnmet(q, calc) для определения gated-вопросов');
    });

    it('renderSection считает visibleTotal и answered раздельно', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        const renderSectionStart = src.indexOf('function renderSection(');
        const body = src.slice(renderSectionStart, renderSectionStart + 5000);
        assert.match(body, /\bvisibleTotal\b/,
            'должна быть переменная visibleTotal (число НЕ-gated вопросов)');
        assert.match(body, /\banswered\b/,
            'должна быть переменная answered (число уточнённых ответов из visible)');
    });

    it('renderSection вычисляет isGated = visibleTotal === 0 при наличии вопросов', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        const renderSectionStart = src.indexOf('function renderSection(');
        const body = src.slice(renderSectionStart, renderSectionStart + 5000);
        assert.match(body, /isGated\s*=\s*visibleTotal\s*===\s*0/,
            'isGated должен вычисляться как visibleTotal === 0 (с проверкой questions.length > 0)');
    });

    it('renderSection отображает chipText «—» для gated, иначе «answered / visibleTotal»', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        const renderSectionStart = src.indexOf('function renderSection(');
        const body = src.slice(renderSectionStart, renderSectionStart + 5000);
        // Проверяем оба варианта tern-операции: gated → '—', else → шаблон с visibleTotal.
        assert.match(body, /isGated\s*\?\s*['"`]—['"`]/,
            'chipText должен быть «—» при isGated');
        assert.match(body, /\$\{answered\}\s*\/\s*\$\{visibleTotal\}/,
            'chipText в non-gated режиме = `${answered} / ${visibleTotal}`');
    });

    it('renderSection ставит title (tooltip) на chip для всех состояний', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        const renderSectionStart = src.indexOf('function renderSection(');
        const body = src.slice(renderSectionStart, renderSectionStart + 5000);
        assert.match(body, /chipTitle/,
            'chipTitle должен быть переменной с разными tooltip-вариантами');
        // Конкретные tooltip-фразы по состояниям:
        assert.match(body, /Раздел\s+заблокирован/,
            'gated tooltip должен начинаться с «Раздел заблокирован»');
        assert.match(body, /Уточнено\s+ответов\s+в\s+разделе/,
            'non-gated tooltip должен содержать «Уточнено ответов в разделе»');
    });

    it('renderSection ставит class is-gated на chip при isGated', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        const renderSectionStart = src.indexOf('function renderSection(');
        const body = src.slice(renderSectionStart, renderSectionStart + 5000);
        // Идиома: ['classname', isGated && 'modifier'] для условного класса
        assert.match(body, /isGated\s*&&\s*['"`]questionnaire-section-count-gated['"`]/,
            'class «questionnaire-section-count-gated» должен ставиться при isGated');
    });

    it('renderSection НЕ маркирует as done при visibleTotal=0 (gated не считается «сделано»)', () => {
        const src = stripJsComments(read('js/ui/questionnaire.js'));
        const renderSectionStart = src.indexOf('function renderSection(');
        const body = src.slice(renderSectionStart, renderSectionStart + 5000);
        // isDone должен требовать visibleTotal > 0 — иначе gated секция (visibleTotal=0,
        // answered=0) ошибочно бы засчитывалась как «всё уточнено».
        assert.match(body, /isDone\s*=\s*visibleTotal\s*>\s*0\s*&&\s*answered\s*===\s*visibleTotal/,
            'isDone должен требовать visibleTotal > 0 + answered === visibleTotal');
    });
});

describe('Stage 5.4 / forms.css — стили для gated/done состояний', () => {
    it('forms.css: .questionnaire-section-count (базовый) сохранён', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-section-count');
        assert.match(body, /background:\s*var\(--bg-elevated\)/,
            'базовый chip должен иметь bg-elevated background');
    });

    it('forms.css: .questionnaire-section-count-done (полностью уточнено) сохранён', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-section-count-done');
        assert.match(body, /background:\s*var\(--accent-faint\)/,
            'done-chip должен подсвечиваться accent-faint background');
    });

    it('forms.css: .questionnaire-section-count-gated (новый) определяет dashed-border + opacity', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-section-count-gated');
        assert.match(body, /border:\s*1px\s+dashed/,
            'gated-chip должен иметь dashed border (визуальный маркер «временно недоступно»)');
        assert.match(body, /opacity:\s*0\.5\b/,
            'gated-chip должен иметь opacity 0.5');
        assert.match(body, /cursor:\s*help\b/,
            'gated-chip должен иметь cursor: help — пользователь должен hover за объяснением');
    });
});
