/**
 * Stage 6.2.B (PATCH 2.4.23) — Multi-level accordion для подгрупп опросника.
 *
 * Подгруппы внутри секций (например, в AI/LLM/RAG: «Использование LLM»,
 * «Агенты», «RAG», «Кастомизация и приватность») становятся collapsible.
 * Header — semantic <button> с aria-expanded, body рендерится conditionally.
 * Состояние persist'ится в localStorage через
 * state.ui.questionnaireCollapsedSubgroups = { [sectionId]: string[] }.
 *
 * Защищает паттерн на уровне persistence + state + render + CSS.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, ruleBody } from '../../_helpers/source.js';
import { STORAGE_KEYS } from '../../../js/utils/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 6.2.B / constants.js — STORAGE_KEYS', () => {
    it('STORAGE_KEYS.QUESTIONNAIRE_COLLAPSED_SUBGROUPS существует', () => {
        assert.ok(STORAGE_KEYS.QUESTIONNAIRE_COLLAPSED_SUBGROUPS,
            'Должен быть ключ для persistence свёрнутых подгрупп');
        assert.equal(typeof STORAGE_KEYS.QUESTIONNAIRE_COLLAPSED_SUBGROUPS, 'string');
        assert.match(STORAGE_KEYS.QUESTIONNAIRE_COLLAPSED_SUBGROUPS, /^calc\./,
            'ключ должен иметь префикс calc. (соответствует whitelist в storage.js)');
    });
});

describe('Stage 6.2.B / persistence.js — load/save helpers', () => {
    const src = stripJsComments(read('js/state/persistence.js'));

    it('loadQuestionnaireCollapsedSubgroups определена и фильтрует мусор', () => {
        assert.match(src, /export\s+function\s+loadQuestionnaireCollapsedSubgroups\s*\(\)/,
            'loadQuestionnaireCollapsedSubgroups должна быть экспортирована');
        // Защита от array (массив — не объект-map)
        assert.match(src, /Array\.isArray\(\s*v\s*\)\s*\)\s*return\s+null/,
            'loadQuestionnaireCollapsedSubgroups должна reject массив (защита от мусора)');
    });

    it('saveQuestionnaireCollapsedSubgroups определена', () => {
        assert.match(src, /export\s+function\s+saveQuestionnaireCollapsedSubgroups/);
    });
});

describe('Stage 6.2.B / uiPersistenceSubscriber.js — subscriber для persistence', () => {
    const src = stripJsComments(read('js/app/uiPersistenceSubscriber.js'));

    it('subscriber отслеживает state.ui.questionnaireCollapsedSubgroups', () => {
        assert.match(src, /name:\s*['"]questionnaireCollapsedSubgroups['"]/,
            'subscriber должен иметь rule для questionnaireCollapsedSubgroups');
        assert.match(src, /state\.ui\.questionnaireCollapsedSubgroups/,
            'subscriber должен читать state.ui.questionnaireCollapsedSubgroups');
        assert.match(src, /persist\.saveQuestionnaireCollapsedSubgroups/,
            'subscriber должен вызывать saveQuestionnaireCollapsedSubgroups при изменении');
    });
});

describe('Stage 6.2.B / calcListController.js — restore on init', () => {
    const src = stripJsComments(read('js/controllers/calcListController.js'));

    it('initFromStorage восстанавливает questionnaireCollapsedSubgroups', () => {
        assert.match(src, /persist\.loadQuestionnaireCollapsedSubgroups/,
            'initFromStorage должна вызывать loadQuestionnaireCollapsedSubgroups');
        assert.match(src, /questionnaireCollapsedSubgroups:\s*qCollapsedSubs/,
            'restore должен передавать значение в store.setUi');
    });
});

describe('Stage 6.2.B / questionnaire.js — collapsible subgroup render', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    it('subgroupCollapsed helper возвращает boolean из state', () => {
        assert.match(src, /function\s+subgroupCollapsed\s*\(\s*state\s*,\s*sectionId\s*,\s*title\s*\)/,
            'subgroupCollapsed helper должна быть определена');
    });

    it('toggleSubgroup helper меняет state.ui.questionnaireCollapsedSubgroups', () => {
        assert.match(src, /function\s+toggleSubgroup\s*\(\s*state\s*,\s*ctx\s*,\s*sectionId\s*,\s*title\s*\)/,
            'toggleSubgroup helper должна быть определена');
        assert.match(src, /ctx\.setUi\(\s*\{\s*questionnaireCollapsedSubgroups:/,
            'toggleSubgroup должен вызывать ctx.setUi с новым значением');
    });

    it('subgroup header — <button> с aria-expanded', () => {
        assert.match(src, /class:\s*['"]questionnaire-subgroup-header['"]/,
            'header класс есть');
        assert.match(src, /'aria-expanded':\s*isCollapsed\s*\?\s*['"]false['"]\s*:\s*['"]true['"]/,
            'aria-expanded зависит от isCollapsed (a11y)');
    });

    it('header имеет accordion-chevron, который вращается при !isCollapsed', () => {
        assert.match(src, /class:\s*\[\s*['"]accordion-chevron['"]\s*,\s*!isCollapsed\s*&&\s*['"]accordion-chevron-open['"]/,
            'chevron должен conditionally получать accordion-chevron-open');
    });

    it('subgroup body рендерится conditionally (только при !isCollapsed)', () => {
        const fnStart = src.indexOf('function renderSection(');
        const after = src.indexOf('\nfunction ', fnStart + 30);
        const body = after < 0 ? src.slice(fnStart) : src.slice(fnStart, after);
        assert.match(body, /!isCollapsed[\s\S]{0,150}?renderSubgroupBody/,
            'renderSubgroupBody вызывается только при !isCollapsed (conditional rendering — лучше content-visibility)');
    });

    it('subgroup div получает класс questionnaire-subgroup-collapsed при isCollapsed', () => {
        assert.match(src, /isCollapsed\s*&&\s*['"]questionnaire-subgroup-collapsed['"]/,
            'div должен conditionally получать класс questionnaire-subgroup-collapsed');
    });
});

describe('Stage 6.2.B / forms.css — стили collapsible header', () => {
    it('.questionnaire-subgroup-header — button-стили (cursor:pointer, transparent bg)', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-subgroup-header');
        assert.match(body, /cursor:\s*pointer/,
            'header должен иметь cursor:pointer (button affordance)');
        assert.match(body, /background:\s*transparent/,
            'native <button> должен сбрасывать дефолтный background');
        assert.match(body, /font:\s*inherit/,
            'native <button> должен наследовать font (иначе монотон ms-sans-serif на FF)');
    });

    it('.questionnaire-subgroup-header:focus-visible имеет outline (a11y, WCAG 2.4.7)', () => {
        const css = read('css/forms.css');
        const m = css.match(/\.questionnaire-subgroup-header:focus-visible\s*\{([^}]+)\}/);
        assert.ok(m, ':focus-visible правило должно существовать');
        assert.match(m[1], /outline:\s*2px\s+solid\s+var\(--accent\)/,
            'focus-visible должен показывать accent-outline');
    });

    it('.questionnaire-subgroup-collapsed .questionnaire-subgroup-header убирает border-bottom', () => {
        const css = read('css/forms.css');
        const m = css.match(/\.questionnaire-subgroup-collapsed\s+\.questionnaire-subgroup-header\s*\{([^}]+)\}/);
        assert.ok(m, 'правило для collapsed-header должно существовать');
        assert.match(m[1], /border-bottom:\s*0/,
            'свёрнутый header не должен иметь border-bottom (линия висит на «ничего»)');
    });
});
