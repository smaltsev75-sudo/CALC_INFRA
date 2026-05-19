/**
 * Stage 6.2.A (PATCH 2.4.21) — Subgroup inline progress chip.
 *
 * Расширение Stage 5.4 (section progress chips) на уровень подгруппы.
 * Каждая subgroup внутри секции получает свой mini-chip с текстом
 * «${subAnswered} / ${subVisibleTotal}» (или «—» при gated).
 *
 * Семантика 1-в-1 с section-count chip:
 *   • visibleTotal = НЕ-gated вопросы подгруппы (через dependsOnUnmet)
 *   • answered = только из visible
 *   • subgroupGated → chip = «—», class -gated, opacity 0.5
 *   • subIsDone → class -done, accent-faint background
 *   • title-tooltip объясняет состояние
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

describe('Stage 6.2.A / questionnaire.js — subgroup chip computation', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    function renderSectionBody() {
        const fnStart = src.indexOf('function renderSection(');
        const after = src.indexOf('\nfunction ', fnStart + 30);
        return after < 0 ? src.slice(fnStart) : src.slice(fnStart, after);
    }

    it('renderSection вычисляет subAnswered и subVisibleTotal через dependsOnUnmet', () => {
        const body = renderSectionBody();
        assert.match(body, /\bsubAnswered\s*=\s*0/,
            'должна быть переменная subAnswered = 0 (init)');
        assert.match(body, /\bsubVisibleTotal\s*=\s*0/,
            'должна быть переменная subVisibleTotal = 0 (init)');
        // Цикл по subQuestions с dependsOnUnmet
        assert.match(body, /for\s*\(\s*const\s+q\s+of\s+subQuestions\s*\)\s*\{[\s\S]{0,400}?dependsOnUnmet\(\s*q\s*,\s*calc\s*\)/,
            'должен быть цикл по subQuestions с проверкой dependsOnUnmet (continue для gated)');
    });

    it('subIsDone требует subVisibleTotal > 0 (пустая subgroup НЕ done)', () => {
        const body = renderSectionBody();
        assert.match(body, /subIsDone\s*=\s*subVisibleTotal\s*>\s*0\s*&&\s*subAnswered\s*===\s*subVisibleTotal/,
            'subIsDone = subVisibleTotal > 0 && subAnswered === subVisibleTotal — защита от false-done на gated subgroup');
    });

    it('subChipText = «—» для gated, иначе «${subAnswered} / ${subVisibleTotal}»', () => {
        const body = renderSectionBody();
        assert.match(body, /subChipText\s*=\s*subgroupGated\s*\?\s*['"]—['"]/,
            'gated subgroup → chip text «—»');
        assert.match(body, /\$\{subAnswered\}\s*\/\s*\$\{subVisibleTotal\}/,
            'non-gated → шаблон «answered / visibleTotal»');
    });

    it('subChipTitle различает gated / done / in-progress', () => {
        const body = renderSectionBody();
        assert.match(body, /Подгруппа\s+заблокирована/,
            'gated tooltip упоминает «Подгруппа заблокирована»');
        assert.match(body, /Все\s+доступные\s+вопросы\s+уточнены/,
            'done tooltip упоминает «Все доступные вопросы уточнены»');
        assert.match(body, /Уточнено\s+в\s+подгруппе/,
            'in-progress tooltip упоминает «Уточнено в подгруппе»');
    });

    it('chip получает class is-gated / is-done conditionally', () => {
        const body = renderSectionBody();
        assert.match(body, /subgroupGated\s*&&\s*['"]questionnaire-subgroup-count-chip-gated['"]/,
            'class -gated применяется при subgroupGated');
        assert.match(body, /subIsDone\s*&&\s*['"]questionnaire-subgroup-count-chip-done['"]/,
            'class -done применяется при subIsDone');
    });

    it('subgroup структура использует header-обёртку (title + chip flex-row)', () => {
        const body = renderSectionBody();
        assert.match(body, /class:\s*['"]questionnaire-subgroup-header['"]/,
            'subgroup должен иметь header-обёртку для flex-row layout');
    });
});

describe('Stage 6.2.A / forms.css — стили subgroup chip', () => {
    it('.questionnaire-subgroup-header — flex-row с justify-content: space-between', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-header');
        assert.match(body, /display:\s*flex/);
        assert.match(body, /justify-content:\s*space-between/,
            'header должен иметь space-between — title слева, chip справа');
        assert.match(body, /border-bottom:\s*1px\s+solid\s+var\(--border\)/,
            'border-bottom переехал с title на header (Stage 6.2.A)');
    });

    it('.questionnaire-subgroup-count-chip — базовый стиль chip', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-count-chip');
        assert.match(body, /background:\s*var\(--bg-elevated\)/,
            'базовый chip имеет bg-elevated (как section-count)');
        assert.match(body, /border-radius:\s*999px/,
            'chip полностью округлый');
        assert.match(body, /cursor:\s*help/,
            'cursor: help — пользователь должен hover за tooltip');
    });

    it('.questionnaire-subgroup-count-chip-done использует accent-faint', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-count-chip-done');
        assert.match(body, /background:\s*var\(--accent-faint\)/,
            'done chip подсвечивается accent-faint');
        assert.match(body, /color:\s*var\(--accent\)/);
    });

    it('.questionnaire-subgroup-count-chip-gated имеет dashed-border + opacity 0.5', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-count-chip-gated');
        assert.match(body, /border:\s*1px\s+dashed/,
            'gated chip имеет dashed border (визуальный маркер «временно недоступно»)');
        assert.match(body, /opacity:\s*0\.5\b/);
    });

    it('.questionnaire-subgroup-title больше не имеет border-bottom (переехал на header)', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-title');
        assert.doesNotMatch(body, /border-bottom:/,
            '.questionnaire-subgroup-title не должен иметь border-bottom — он на header');
    });
});
