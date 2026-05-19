/**
 * Stage VAT-2 Phase 5 — Architecture invariants.
 *
 * Защищает от регрессий:
 *   - Никакого парсинга priceSource для VAT-policy detection.
 *   - НЕТ STORAGE_KEYS для session-only banner-флагов VAT-2.
 *   - НЕТ auto-apply кнопок/функций («Применить обновлённый JSON» — анти-паттерн).
 *   - VAT-policy modal зарегистрирована в MODAL_RENDERERS / MODAL_ORDER.
 *   - validator вызывается с requireVatPolicy=true в user-import path.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const JS_ROOT = join(REPO_ROOT, 'js');

function walkJs(rootDir) {
    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSync(dir); }
        catch { continue; }
        for (const name of entries) {
            const full = join(dir, name);
            let s;
            try { s = statSync(full); }
            catch { continue; }
            if (s.isDirectory()) stack.push(full);
            else if (s.isFile() && full.endsWith('.js')) out.push(full);
        }
    }
    return out;
}

describe('Phase 5.40: НЕТ парсинга priceSource для VAT-policy detection', () => {
    it('ни один файл не делает /С НДС/.test(priceSource) или подобное', () => {
        const files = walkJs(JS_ROOT).filter(f => !f.endsWith('.generated.js'));
        const offenders = [];
        for (const file of files) {
            const src = stripJsComments(readFileSync(file, 'utf8'));
            /* Запрещены паттерны: priceSource + match/.test/.includes с
             * VAT-словами «НДС / VAT / vat». Это эвристические VAT-парсеры. */
            const re = /priceSource[^;]*?(\.match|\.test|\.includes|\.indexOf)\s*\([^)]*?(НДС|VAT|vat|нет НДС|с НДС)/i;
            if (re.test(src)) {
                const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
                offenders.push(rel);
            }
        }
        assert.deepEqual(offenders, [],
            'priceSource НЕ должен парситься для VAT-policy detection:\n' +
            offenders.join('\n'));
    });
});

describe('Phase 5.41: НЕТ STORAGE_KEYS для banner-флагов VAT-2', () => {
    it('STORAGE_KEYS не содержит shownLegacyProviderVatBanners / shownLegacyVatBanners', () => {
        const constantsPath = join(JS_ROOT, 'utils', 'constants.js');
        const src = readFileSync(constantsPath, 'utf8');
        /* Ищем KEY-литерал в объявлении STORAGE_KEYS. */
        const storageKeysMatch = src.match(/STORAGE_KEYS\s*=\s*Object\.freeze\s*\(\s*\{([\s\S]*?)\}\s*\)/);
        assert.ok(storageKeysMatch, 'STORAGE_KEYS должен существовать');
        const body = storageKeysMatch[1];
        assert.doesNotMatch(body, /shownLegacy[A-Za-z]*VatBanners/,
            'session-only banner flag НЕ должен жить в STORAGE_KEYS');
    });
});

describe('Phase 5.42: НЕТ auto-apply кнопок («Применить обновлённый JSON»)', () => {
    it('в коде нет литералов «Применить обновлённый JSON» — этот UX-путь отвергнут (Q4)', () => {
        const files = walkJs(JS_ROOT);
        const offenders = [];
        for (const file of files) {
            const src = stripJsComments(readFileSync(file, 'utf8'));
            if (/Применить обновл[её]нный JSON/i.test(src)) {
                const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
                offenders.push(rel);
            }
        }
        assert.deepEqual(offenders, [],
            'Auto-apply CTA отвергнут как анти-паттерн (Q4 decision):\n' +
            offenders.join('\n'));
    });
});

describe('Phase 5.43: vatPolicyChoice modal зарегистрирована', () => {
    const indexPath = join(JS_ROOT, 'ui', 'index.js');
    const indexSrc = readFileSync(indexPath, 'utf8');

    it('импортирована renderVatPolicyChoiceModal', () => {
        assert.match(indexSrc,
            /import\s*\{\s*renderVatPolicyChoiceModal\s*\}\s*from\s*['"]\.\/modals\/vatPolicyChoiceModal\.js['"]/);
    });

    it('добавлена в MODAL_ORDER', () => {
        assert.match(indexSrc, /'vatPolicyChoice'/);
    });

    it('добавлена в MODAL_RENDERERS с парой [vatPolicyChoice, renderVatPolicyChoiceModal]', () => {
        assert.match(indexSrc,
            /\[\s*['"]vatPolicyChoice['"]\s*,\s*renderVatPolicyChoiceModal\s*\]/);
    });
});

describe('Phase 5.44: providerController user-import требует requireVatPolicy=true', () => {
    const ctrlPath = join(JS_ROOT, 'controllers', 'providerController.js');
    const ctrlSrc = stripJsComments(readFileSync(ctrlPath, 'utf8'));

    it('updateProviderPricesFromFile вызывает validate с { requireVatPolicy: true }', () => {
        /* В коде должна быть фраза `requireVatPolicy: true` (опция в options
         * 3-го параметра validateProviderPriceJson). */
        assert.match(ctrlSrc, /requireVatPolicy\s*:\s*true/);
    });

    it('обрабатывает reason === "vat-policy-required" → openModal(\'vatPolicyChoice\')', () => {
        assert.match(ctrlSrc, /reason\s*===\s*['"]vat-policy-required['"]/);
        assert.match(ctrlSrc, /openModal\s*\(\s*['"]vatPolicyChoice['"]/);
    });

    it('applyProviderPricesWithVatPolicy экспортирован', () => {
        assert.match(ctrlSrc,
            /export\s+(?:async\s+)?function\s+applyProviderPricesWithVatPolicy/);
    });
});
