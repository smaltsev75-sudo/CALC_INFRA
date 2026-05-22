/**
 * Stage VAT-1 Phase 5: Comparison VAT chip + warning при разных ставках.
 *
 * Проверяет `js/ui/comparison.js`:
 *   - renderComparisonVatWarning возвращает null когда ставки совпадают;
 *   - возвращает warning-элемент когда уникальных rate > 1;
 *   - vatEnabled=false участвует как effective-rate=0 (несопоставимо
 *     с НДС>0);
 *   - renderComparisonVatChip показывает «НДС 22% · авто» / «без НДС».
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_PATH = join(REPO_ROOT, 'js', 'ui', 'comparison.js');
const SRC = stripJsComments(readFileSync(SRC_PATH, 'utf8'));

describe('Comparison VAT: warning над таблицей', () => {
    it('renderComparisonVatWarning определена', () => {
        assert.match(SRC, /function renderComparisonVatWarning\(/);
    });

    it('Возвращает null при calcs.length < 2', () => {
        assert.match(SRC, /if\s*\(!Array\.isArray\(calcs\)\s*\|\|\s*calcs\.length\s*<\s*2\)\s*return\s+null/);
    });

    it('Используется unique-Set на effectiveRates', () => {
        assert.match(SRC, /new\s+Set\(effectiveRates\)/);
    });

    it('Возвращает null при unique.size <= 1 (ставки одинаковы)', () => {
        assert.match(SRC, /if\s*\(unique\.size\s*<=?\s*1\)\s*return\s+null/);
    });

    it('vatEnabled=false → effectiveRate=0 (несопоставимо с НДС>0)', () => {
        assert.match(SRC,
            /if\s*\(s\.vatEnabled\s*===\s*false\)\s*return\s+0/);
    });

    it('Warning содержит ожидаемый текст', () => {
        assert.match(SRC, /Ставки НДС различаются — итоги не сопоставимы напрямую/);
    });

    it('Warning имеет role="status" + aria-live="polite"', () => {
        assert.match(SRC,
            /class:\s*'comparison-vat-warning'[\s\S]{0,200}role:\s*'status'/);
    });
});

describe('Comparison VAT: chip per calc', () => {
    it('renderComparisonVatChip определена', () => {
        assert.match(SRC, /function renderComparisonVatChip\(/);
    });

    it('vatEnabled=false → текст «без НДС»', () => {
        assert.match(SRC,
            /if\s*\(s\.vatEnabled\s*===\s*false\)[\s\S]{0,300}text:\s*'без НДС'/);
    });

    it('Текст chip формата «НДС {pct}% · {mode}»', () => {
        assert.match(SRC, /`НДС \$\{ratePct\}% · \$\{modeLabel\}`/);
    });

    it('Mode label: auto-by-date → «авто», manual → «вручную», frozen → «заморожено»', () => {
        assert.match(SRC, /'manual'\s*\?\s*'вручную'/);
        assert.match(SRC, /'frozen'\s*\?\s*'заморожено'/);
        assert.match(SRC, /'авто'/);
    });

    it('Chip встроен в шапку таблицы Сравнения после cmp-calc-baseline', () => {
        /* renderComparisonVatChip(c) вызывается в th-формировании, после
           cmp-calc-baseline. */
        assert.match(SRC, /renderComparisonVatChip\(c\)/);
    });
});

describe('Comparison VAT: warning ВКЛЮЧЁН в render-pipeline', () => {
    it('renderComparisonVatWarning(calcs) вызывается перед renderUnifiedTable', () => {
        /* Проверяем, что в comparison-content порядок: warning → renderUnifiedTable. */
        const re = /renderComparisonVatWarning\(calcs\),\s*\n\s*renderUnifiedTable\(calcs/;
        assert.match(SRC, re);
    });
});
