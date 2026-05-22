/**
 * Stage 10.2: provider-block extraction в js/ui/providerPriceSummary.js +
 * timestamp humanizer + glow-animation на success.
 *
 * Source-grep тесты:
 *   1. providerPriceSummary.js существует, экспортирует renderProviderPriceSummary
 *      и re-export'ит renderProviderUpdateRow из providerUpdateRow.js.
 *   2. questionnaireProviderSettings.js импортирует обе функции из providerPriceSummary.js
 *      и более НЕ объявляет их локально.
 *   3. providerUpdateRow.js использует formatTimeAgo для inline-таймстампа.
 *   4. CSS forms.css содержит .provider-update-row--just-updated и keyframes
 *      providerJustUpdatedGlow.
 *   5. CSS .provider-rollback-btn-ago для суффикса «N мин назад» рядом с rollback.
 *   6. Glow-animation отключена при prefers-reduced-motion (base.css правило).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROVIDER_SRC = stripJsComments(fs.readFileSync(
    path.resolve(__dirname, '../../../js/ui/providerPriceSummary.js'), 'utf8'
));
const PROVIDER_UPDATE_SRC = stripJsComments(fs.readFileSync(
    path.resolve(__dirname, '../../../js/ui/providerUpdateRow.js'), 'utf8'
));
const QUEST_SRC = stripJsComments(fs.readFileSync(
    path.resolve(__dirname, '../../../js/ui/questionnaireProviderSettings.js'), 'utf8'
));
const FORMS_CSS = stripCssComments(fs.readFileSync(
    path.resolve(__dirname, '../../../css/forms.css'), 'utf8'
));
const BASE_CSS = stripCssComments(fs.readFileSync(
    path.resolve(__dirname, '../../../css/base.css'), 'utf8'
));

describe('Stage 10.2 — providerPriceSummary.js файл-модуль', () => {
    it('re-export renderProviderUpdateRow', () => {
        assert.match(PROVIDER_SRC,
            /export\s*\{\s*renderProviderUpdateRow\s*\}\s*from\s*['"]\.\/providerUpdateRow\.js['"]/);
    });

    it('providerUpdateRow.js export renderProviderUpdateRow', () => {
        assert.match(PROVIDER_UPDATE_SRC, /export\s+function\s+renderProviderUpdateRow\s*\(/);
    });

    it('export renderProviderPriceSummary', () => {
        assert.match(PROVIDER_SRC, /export\s+function\s+renderProviderPriceSummary\s*\(/);
    });

    it('содержит PROVIDER_PRICE_SUMMARY_PICKS и PROVIDER_PRICE_CATEGORIES', () => {
        assert.match(PROVIDER_SRC, /const\s+PROVIDER_PRICE_SUMMARY_PICKS\s*=/);
        assert.match(PROVIDER_SRC, /const\s+PROVIDER_PRICE_CATEGORIES\s*=/);
    });

    it('содержит helper _renderDeltaPill', () => {
        assert.match(PROVIDER_SRC, /function\s+_renderDeltaPill\s*\(/);
    });
});

describe('Stage 10.2 — questionnaireProviderSettings.js использует extracted module', () => {
    it('импортирует renderProviderUpdateRow и renderProviderPriceSummary', () => {
        assert.match(QUEST_SRC,
            /import\s*\{[^}]*renderProviderUpdateRow[^}]*renderProviderPriceSummary[^}]*\}\s*from\s*['"]\.\/providerPriceSummary\.js['"]/);
    });

    it('больше НЕ объявляет renderProviderUpdateRow локально', () => {
        assert.doesNotMatch(QUEST_SRC, /^\s*function\s+renderProviderUpdateRow\s*\(/m,
            'после Stage 10.2 функция должна жить ТОЛЬКО в providerPriceSummary.js');
    });

    it('больше НЕ объявляет renderProviderPriceSummary локально', () => {
        assert.doesNotMatch(QUEST_SRC, /^\s*function\s+renderProviderPriceSummary\s*\(/m);
    });

    it('больше НЕ объявляет PROVIDER_PRICE_CATEGORIES / PROVIDER_PRICE_SUMMARY_PICKS', () => {
        assert.doesNotMatch(QUEST_SRC, /const\s+PROVIDER_PRICE_SUMMARY_PICKS/);
        assert.doesNotMatch(QUEST_SRC, /const\s+PROVIDER_PRICE_CATEGORIES/);
    });
});

describe('Stage 10.2 — formatTimeAgo используется в provider блоке', () => {
    it('импортирует formatTimeAgo из format.js', () => {
        assert.match(PROVIDER_UPDATE_SRC,
            /import\s*\{[^}]*formatTimeAgo[^}]*\}\s*from\s*['"]\.\.\/services\/format\.js['"]/);
    });

    it('вызывает formatTimeAgo для previousAppliedAt', () => {
        assert.match(PROVIDER_UPDATE_SRC, /formatTimeAgo\s*\(\s*previousAppliedAt\s*\)/);
    });

    it('rollback кнопка получает суффикс с relative-time текстом', () => {
        assert.match(PROVIDER_UPDATE_SRC, /class:\s*['"]provider-rollback-btn-ago['"]/);
    });
});

describe('Stage 10.2 — glow-animation на success status', () => {
    it('renderProviderUpdateRow добавляет класс provider-update-row--just-updated при isJustUpdated', () => {
        const fn = PROVIDER_UPDATE_SRC.match(/function\s+renderProviderUpdateRow[\s\S]+?\n\}\s*\n/);
        assert.ok(fn, 'функция должна существовать');
        assert.match(fn[0], /isJustUpdated\s*=\s*updateState\.status\s*===\s*['"]success['"]/);
        assert.match(fn[0], /isJustUpdated\s*&&\s*['"]provider-update-row--just-updated['"]/);
    });

    it('CSS .provider-update-row--just-updated объявлен с animation', () => {
        const m = FORMS_CSS.match(/\.provider-update-row--just-updated\s*\{[^}]+\}/);
        assert.ok(m, 'правило .provider-update-row--just-updated должно существовать');
        assert.match(m[0], /animation\s*:\s*providerJustUpdatedGlow/);
    });

    it('@keyframes providerJustUpdatedGlow определены', () => {
        assert.match(FORMS_CSS, /@keyframes\s+providerJustUpdatedGlow\s*\{/);
    });

    it('prefers-reduced-motion обнуляет animation (через global @media в base.css)', () => {
        /* base.css имеет общее правило @media (prefers-reduced-motion: reduce):
           {animation: ... 0.01ms} — оно автоматически отключает glow. Здесь
           проверяем, что общее правило вообще есть. */
        assert.match(BASE_CSS,
            /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{[\s\S]*animation/);
    });
});

describe('Stage 10.2 — CSS .provider-rollback-btn-ago', () => {
    it('класс объявлен в forms.css', () => {
        assert.match(FORMS_CSS, /\.provider-rollback-btn-ago\s*\{/);
    });

    it('использует muted цвет (приглушённый)', () => {
        const m = FORMS_CSS.match(/\.provider-rollback-btn-ago\s*\{([^}]+)\}/);
        assert.ok(m);
        assert.match(m[1], /color\s*:\s*var\(--text-muted\)/);
    });
});

describe('Stage 10.2 — layer compliance', () => {
    it('providerPriceSummary.js НЕ импортирует controllers/ напрямую', () => {
        assert.doesNotMatch(PROVIDER_SRC, /from\s+['"][^'"]*\/controllers\//);
        assert.doesNotMatch(PROVIDER_UPDATE_SRC, /from\s+['"][^'"]*\/controllers\//);
    });

    it('providerPriceSummary.js НЕ импортирует state/ напрямую', () => {
        assert.doesNotMatch(PROVIDER_SRC, /from\s+['"][^'"]*\/state\//);
        assert.doesNotMatch(PROVIDER_UPDATE_SRC, /from\s+['"][^'"]*\/state\//);
    });
});
