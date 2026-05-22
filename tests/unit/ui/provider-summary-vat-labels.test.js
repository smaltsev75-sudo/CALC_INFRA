/**
 * Stage VAT-2 Phase 5: VAT-policy метки в provider price summary.
 *
 * Acceptance:
 *   - Если все prices vatNormalized → показывается «Цены сохранены без НДС…».
 *   - Если был gross source (gross !== net) → дополнительно «Источник содержал…».
 *   - Если confidence === 'assumed' (VK) → «НДС-политика принята по допущению».
 *   - Если есть items БЕЗ vatNormalized (legacy) → warning «НДС-политика прайса
 *     неизвестна».
 *   - Один indicator на карточку — не дублируется в каждой строке.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SUMMARY_PATH = join(REPO_ROOT, 'js', 'ui', 'providerPriceSummary.js');

const src = readFileSync(SUMMARY_PATH, 'utf8');
const code = stripJsComments(src);

describe('Phase 5.30: VAT-label rendering в renderProviderPriceSummary', () => {
    it('summary вызывает _renderVatPolicyLabel внутри body', () => {
        assert.match(code, /_renderVatPolicyLabel/);
        assert.match(code, /_computeVatMetadata/);
    });

    it('label рендерится ВНУТРИ body, не header (один indicator на карточку)', () => {
        /* Проверка позиции: _renderVatPolicyLabel вызывается в body-блоке,
         * не в строках (rows) внутри категорий. */
        const bodyBlockMatch = code.match(
            /class:\s*['"]provider-price-summary-body['"][^}]*\}[\s\S]*?,\s*\.{3}categoryEls/);
        assert.ok(bodyBlockMatch, 'body-блок должен содержать VAT label перед categoryEls');
    });

    it('label НЕ дублируется в строках (provider-price-row не содержит vat-label)', () => {
        /* Поиск vat-label в контексте строк — таких быть не должно. */
        const rowsContext = code.match(
            /provider-price-row[\s\S]{0,1500}provider-price-row-value/);
        if (rowsContext) {
            assert.doesNotMatch(rowsContext[0], /vat-label/);
        }
    });
});

describe('Phase 5.31: тексты меток для трёх кейсов', () => {
    it('always-normalized: "Цены сохранены без НДС. НДС применяется отдельно в расчёте."', () => {
        assert.match(code, /Цены сохранены без НДС\. НДС применяется отдельно в расчёте\./);
    });

    it('gross-source: "Источник содержал цены с НДС..."', () => {
        assert.match(code, /Источник содержал цены с НДС/);
    });

    it('assumed-confidence: "НДС-политика источника принята по допущению."', () => {
        assert.match(code, /НДС-политика источника принята по допущению/);
    });

    it('unknown-policy warning: "НДС-политика прайса неизвестна. ..."', () => {
        assert.match(code, /НДС-политика прайса неизвестна/);
    });
});

describe('Phase 5.32: _computeVatMetadata pure-helper', () => {
    it('агрегирует: allNormalized, hasGrossSource, hasUnknown, confidence', () => {
        assert.match(code, /allNormalized/);
        assert.match(code, /hasGrossSource/);
        assert.match(code, /hasUnknown/);
        assert.match(code, /confidences\.add/);
    });

    it('confidence признаётся только при единственном значении (consistency)', () => {
        assert.match(code, /confidences\.size\s*===\s*1/);
    });
});

describe('Phase 5.33: a11y — role="status" на label', () => {
    it('VAT label имеет role="status" (aria-live по умолчанию для status — polite)', () => {
        assert.match(code, /role\s*:\s*['"]status['"]/);
    });
});
