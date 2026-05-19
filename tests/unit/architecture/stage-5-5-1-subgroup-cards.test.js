/**
 * Stage 5.5.1 — Subgroup-cards с gated-modifier.
 *
 * Когда ВСЕ вопросы подгруппы заблокированы master-toggle (например,
 * подгруппа «RAG (поиск по базе знаний)» при выключенном rag_needed),
 * вся карточка-подгруппа получает класс .questionnaire-subgroup-gated
 * и приглушается до opacity 0.4. Пользователь видит физически связанный
 * блок, а не россыпь несвязанных disabled-полей (Gestalt «общая судьба»).
 *
 * Для пустых подгрупп — нет gated. Для частично gated — нет gated
 * (ровно один не-gated вопрос = подгруппа считается активной).
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

describe('Stage 5.5.1 / questionnaire.js — subgroup gated detection', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    it('renderSection вычисляет subgroupGated через every(dependsOnUnmet)', () => {
        // every(q => dependsOnUnmet(q, calc)) — все вопросы gated.
        assert.match(src, /subgroupGated\s*=\s*[\s\S]{0,200}?every\(\s*q\s*=>\s*dependsOnUnmet\(\s*q\s*,\s*calc\s*\)/,
            'subgroupGated должен использовать every(dependsOnUnmet) — ВСЕ вопросы gated');
    });

    it('renderSection требует subQuestions.length > 0 для gated (пустая подгруппа НЕ gated)', () => {
        // subQuestions.length > 0 && subQuestions.every(...)
        assert.match(src, /subQuestions\.length\s*>\s*0\s*[\s\S]{0,80}?every/,
            'subgroupGated должен исключать пустую подгруппу — иначе any-empty subgroup был бы gated');
    });

    it('renderSection строит subgroupTitle с упоминанием master-toggle', () => {
        assert.match(src, /Подгруппа\s+заблокирована:\s+сначала\s+включите/,
            'subgroupTitle должен сообщать «Подгруппа заблокирована: сначала включите…»');
    });

    it('subgroup div получает class questionnaire-subgroup-gated при gated', () => {
        assert.match(src, /class:\s*\[\s*['"]questionnaire-subgroup['"]\s*,\s*subgroupGated\s*&&\s*['"]questionnaire-subgroup-gated['"]/,
            'subgroup div должен conditionally получать класс questionnaire-subgroup-gated');
    });

    it('subgroup div получает title-attr только когда gated', () => {
        // attrs: subgroupTitle ? { title: subgroupTitle } : undefined
        assert.match(src, /attrs:\s*subgroupTitle\s*\?\s*\{\s*title:\s*subgroupTitle\s*\}\s*:\s*undefined/,
            'attrs.title ставится conditionally только при gated subgroup');
    });
});

describe('Stage 5.5.1 / forms.css — стили для gated subgroup', () => {
    it('.questionnaire-subgroup-gated имеет opacity 0.4 (унифицированный disabled-уровень)', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-gated');
        assert.match(body, /opacity:\s*0\.4\b/,
            '.questionnaire-subgroup-gated должен иметь opacity 0.4 — унификация со Stage 4.15 (все disabled = 0.4)');
        assert.match(body, /cursor:\s*help\b/,
            '.questionnaire-subgroup-gated должен иметь cursor: help — пользователь должен hover за tooltip');
    });

    it('.questionnaire-subgroup-gated .questionnaire-subgroup-title теряет accent-color', () => {
        const css = read('css/forms.css');
        const m = css.match(/\.questionnaire-subgroup-gated\s+\.questionnaire-subgroup-title\s*\{([^}]+)\}/);
        assert.ok(m, 'правило для title в gated-subgroup должно существовать');
        assert.match(m[1], /color:\s*var\(--text-muted\)/,
            'title в gated должен использовать text-muted color, не accent');
    });

    it('базовый .questionnaire-subgroup не сломан (всё ещё карточка)', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup');
        assert.match(body, /background:\s*var\(--bg-elevated\)/,
            '.questionnaire-subgroup сохраняет card-фон');
        assert.match(body, /border:\s*1px\s+solid\s+var\(--border\)/,
            '.questionnaire-subgroup сохраняет card-border');
    });
});
