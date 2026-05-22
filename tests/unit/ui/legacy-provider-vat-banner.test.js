/**
 * Stage VAT-2 Phase 5: legacy provider double-VAT banner на openCalc.
 *
 * Тесты — source-grep по `js/app/vatBanners.js` + wiring в `js/app.js`:
 *   - функция maybeShowLegacyProviderVatBanner существует
 *   - вызывается из ctx.openCalc
 *   - использует state.ui.shownLegacyProviderVatBanners как session-only флаг
 *   - НЕ persist'ит флаг в localStorage / STORAGE_KEYS
 *   - детектирует legacy через items.vatNormalized !== true
 *   - НЕ делает auto-apply (только action 'Перейти к тарифам')
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const APP_PATH = join(REPO_ROOT, 'js', 'app.js');
const BANNERS_PATH = join(REPO_ROOT, 'js', 'app', 'vatBanners.js');

const src = readFileSync(APP_PATH, 'utf8');
const code = stripJsComments(src);
const bannerCode = stripJsComments(readFileSync(BANNERS_PATH, 'utf8'));

function legacyProviderBannerBody() {
    const fnMatch = bannerCode.match(
        /function\s+maybeShowLegacyProviderVatBanner\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(fnMatch, 'функция должна быть найдена');
    return fnMatch[1];
}

describe('Phase 5.20: maybeShowLegacyProviderVatBanner существует и вызывается на openCalc', () => {
    it('функция определена', () => {
        assert.match(bannerCode, /function\s+maybeShowLegacyProviderVatBanner/);
    });

    it('вызывается из ctx.openCalc', () => {
        /* Должен быть вызов maybeShowLegacyProviderVatBanner() рядом с
         * openCalc body — после calcList.openCalc(id). */
        const openCalcMatch = code.match(/openCalc\s*\([^)]*\)\s*\{[\s\S]*?\}/);
        assert.ok(openCalcMatch, 'ctx.openCalc должен существовать');
        assert.match(openCalcMatch[0], /maybeShowLegacyProviderVatBanner/);
    });
});

describe('Phase 5.21: session-only — state.ui.shownLegacyProviderVatBanners', () => {
    it('использует state.ui.shownLegacyProviderVatBanners (не STORAGE_KEYS)', () => {
        assert.match(bannerCode, /shownLegacyProviderVatBanners/);
    });

    it('НЕ записывается в localStorage / persist API', () => {
        /* Проверяем тело функции — внутри не должно быть persist.* /
         * setItem / saveX, относящихся к этому флагу. */
        const body = legacyProviderBannerBody();
        assert.doesNotMatch(body, /STORAGE_KEYS/,
            'banner-флаг session-only — STORAGE_KEYS НЕ должен упоминаться');
        assert.doesNotMatch(body, /\.setItem\(/);
        assert.doesNotMatch(body, /persist\.save/);
    });

    it('НЕТ ключа shownLegacyProviderVatBanners в STORAGE_KEYS (constants.js)', () => {
        const constantsPath = join(REPO_ROOT, 'js', 'utils', 'constants.js');
        const constSrc = readFileSync(constantsPath, 'utf8');
        assert.doesNotMatch(constSrc, /shownLegacyProviderVatBanners/i,
            'не должно быть STORAGE_KEYS для session-only banner-флага');
    });
});

describe('Phase 5.22: детекция legacy через vatNormalized !== true', () => {
    it('читает items.vatNormalized в условии', () => {
        const body = legacyProviderBannerBody();
        assert.match(body, /vatNormalized/,
            'детекция должна использовать item.vatNormalized как сигнал');
    });

    it('НЕ показывает banner если vatEnabled=false (нет риска двойного учёта)', () => {
        const body = legacyProviderBannerBody();
        assert.match(body, /vatEnabled/);
    });
});

describe('Phase 5.23: НЕТ auto-apply, только CTA на provider summary', () => {
    it('действие banner-а: раскрытие provider summary, НЕ apply', () => {
        const body = legacyProviderBannerBody();
        assert.match(body, /providerOverlayExpanded/);
        assert.doesNotMatch(body, /applyOverrideToActiveCalc/,
            'banner НЕ должен auto-apply override');
        assert.doesNotMatch(body, /applyOverrideToAllCalcs/);
    });

    it('snackbar.action содержит "Перейти к тарифам" (или эквивалент)', () => {
        const body = legacyProviderBannerBody();
        assert.match(body, /action\s*:\s*['"]/);
    });
});
