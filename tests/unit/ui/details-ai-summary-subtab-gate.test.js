/**
 * Regression-тест: блок «Сводка AI-метрик» (qty-таблица — токены / RAG-индекс /
 * эмбеддинги / CPU агентов) должен быть виден на обеих подвкладках
 * Детализации.
 *
 * Пользовательский контракт: если в Опроснике заполнен раздел «Объём токенов»,
 * первый экран «Детализация → Бюджет (₽)» не должен визуально прятать агрегат
 * «Токены». Построчные input/output-ЭК остаются внутри категории AI / LLM, но
 * сводная строка нужна сразу, без раскрытия accordion'а.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const detailsSrc = stripJsComments(readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'details.js'),
    'utf8'
));

describe('Details: «Сводка AI-метрик» видна на cost и qty', () => {
    it('renderAiMetricsSummary вызывается без subTab-gate', () => {
        const calls = detailsSrc.match(/renderAiMetricsSummary\s*\(/g) || [];
        assert.equal(calls.length, 1,
            'renderAiMetricsSummary должен вызываться один раз в renderDetails');

        const gatedToQty =
            /subTab\s*===\s*['"]qty['"]\s*(?:&&|\?)\s*renderAiMetricsSummary\s*\(/
                .test(detailsSrc);
        assert.equal(gatedToQty, false,
            'renderAiMetricsSummary не должен быть ограничен subTab === "qty": ' +
            'иначе токены пропадают с первого экрана Детализации.');
    });

    it('summary получает hideNoBudget, чтобы «Скрыть без бюджета» синхронно скрывал пустые AI-строки', () => {
        assert.match(detailsSrc,
            /renderAiMetricsSummary\s*\([^)]*\{\s*hideNoBudget:\s*hideZero\s*\}/s,
            'AI-сводка должна получать hideNoBudget: hideZero.');
    });
});
