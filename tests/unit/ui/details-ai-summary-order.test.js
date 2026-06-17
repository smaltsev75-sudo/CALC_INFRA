/**
 * Фикс 2026-06-17: в PDF Детализации «Сводка AI-метрик» уезжала в конец листа,
 * хотя в UI идёт сразу под таблицей. Причина — блок «Почему столько?»
 * (details-quantity-print-summary, print-only) рендерился МЕЖДУ таблицей и
 * AI-сводкой: на экране он скрыт (AI-сводка под таблицей), а в печати —
 * виден и отталкивает AI-сводку вниз.
 *
 * Фикс: AI-сводка рендерится ДО print-summary → и в UI, и в PDF она сразу под
 * таблицей.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = stripJsComments(
    readFileSync(path.resolve(__dirname, '../../../js/ui/details.js'), 'utf8')
);

describe('details — порядок: AI-сводка перед print-summary «Почему столько?»', () => {
    it('renderAiMetricsSummary вызывается раньше renderDetailsQuantityPrintSummary', () => {
        const aiCall = SRC.indexOf('renderAiMetricsSummary(');
        const printCall = SRC.indexOf('renderDetailsQuantityPrintSummary(');
        assert.ok(aiCall > 0, 'renderAiMetricsSummary должен вызываться');
        assert.ok(printCall > 0, 'renderDetailsQuantityPrintSummary должен вызываться');
        assert.ok(aiCall < printCall,
            'AI-сводка должна идти ДО print-summary, иначе в PDF уезжает в конец');
    });
});
