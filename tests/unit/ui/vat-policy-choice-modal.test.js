/**
 * Stage VAT-2 Phase 5: модалка `vatPolicyChoiceModal.js` — 3 кнопки + cancel,
 * без default-выбора, без парсинга `priceSource`.
 *
 * Тесты — source-grep + integration: рендерим JSDom-минимум и проверяем DOM.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const MODAL_PATH = join(REPO_ROOT, 'js', 'ui', 'modals', 'vatPolicyChoiceModal.js');

const src = readFileSync(MODAL_PATH, 'utf8');
const code = stripJsComments(src);

describe('Phase 5.10: renderVatPolicyChoiceModal exports + читает state.modals.vatPolicyChoice', () => {
    it('экспортирует renderVatPolicyChoiceModal', () => {
        assert.match(src, /export\s+function\s+renderVatPolicyChoiceModal/);
    });

    it('читает state.modals.vatPolicyChoice.open и возвращает null при open=false', () => {
        assert.match(code, /state\.modals\.vatPolicyChoice/);
        assert.match(code, /if\s*\(\s*!m\.open\s*\)\s*return\s+null/);
    });
});

describe('Phase 5.11: 3 кнопки выбора политики (net / gross-20 / gross-22)', () => {
    it('содержит kebab-policy-string "net" в data-attr или onClick', () => {
        assert.match(code, /['"]net['"]/);
    });

    it('содержит "gross-20" (Российский НДС 2019-2025)', () => {
        assert.match(code, /['"]gross-20['"]/);
    });

    it('содержит "gross-22" (Российский НДС с 01.01.2026)', () => {
        assert.match(code, /['"]gross-22['"]/);
    });

    it('у каждой policy-кнопки атрибут data-vat-policy (для тестов / a11y)', () => {
        const matches = code.match(/'data-vat-policy':\s*policy/g) || [];
        assert.ok(matches.length >= 1, 'должен быть атрибут data-vat-policy');
    });
});

describe('Phase 5.12: НЕТ default-выбора (no autofocus на policy-кнопках)', () => {
    it('ни одна из 3 policy-кнопок не помечена data-autofocus', () => {
        /* Извлекаем тело функции choiceBtn — оно НЕ должно содержать
         * data-autofocus. */
        const choiceBtnMatch = code.match(/const\s+choiceBtn\s*=\s*\([^)]*\)\s*=>\s*[\s\S]*?\);/);
        assert.ok(choiceBtnMatch, 'choiceBtn helper должен существовать');
        assert.doesNotMatch(choiceBtnMatch[0], /data-autofocus/,
            'policy-кнопки НЕ должны иметь data-autofocus (нет default-выбора)');
    });
});

describe('Phase 5.13: Cancel-flow вызывает ctx.cancelVatPolicyChoice()', () => {
    it('Есть кнопка Отмена + ctx.cancelVatPolicyChoice', () => {
        assert.match(code, /cancelVatPolicyChoice/);
        assert.match(code, /Отмена/);
    });

    it('onClose модалки вызывает cancelVatPolicyChoice (Esc / клик на overlay)', () => {
        /* modalShell({ onClose, ... }) — onCancel должен звать
         * ctx.cancelVatPolicyChoice. */
        assert.match(code,
            /onClose\s*:\s*onCancel/);
    });
});

describe('Phase 5.14: НЕ парсит priceSource', () => {
    it('priceSource не упоминается в коде модалки (защита от silent VAT-policy guessing)', () => {
        assert.doesNotMatch(code, /priceSource/,
            'модалка не должна читать priceSource — пользователь делает выбор явно');
    });
});

describe('Phase 5.15: вызывает ctx.chooseVatPolicy при выборе', () => {
    it('chooseVatPolicy упомянут в коде', () => {
        assert.match(code, /chooseVatPolicy/);
    });
});
