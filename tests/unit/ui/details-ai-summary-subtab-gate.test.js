/**
 * Regression-тест: блок «Сводка AI-метрик» (qty-таблица — токены / RAG-индекс /
 * эмбеддинги / CPU агентов) появляется в Детализации ТОЛЬКО на подвкладке
 * «Объём» (subTab === 'qty'), но НЕ на «Бюджет» (subTab === 'cost').
 *
 * Семантика подвкладок:
 *   - 'cost'  — деньги (₽). Все таблицы — финансовые срезы.
 *   - 'qty'   — capacity (vCPU, ГБ, токены, шт.). Все таблицы — объёмные.
 *
 * Сводка AI-метрик показывает qty (517 млн токенов, 20 ГБ RAG, …). Это
 * capacity-разрез, ему не место в режиме «Бюджет» — там пользователь
 * ожидает только рубли.
 *
 * Баг до фикса: renderAiMetricsSummary(...) вызывался безусловно после
 * subTab-switcher'а в renderDetails, и qty-таблица появлялась под
 * cost-таблицей при 'Бюджет'.
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

describe('Details: «Сводка AI-метрик» гейтится по subTab === "qty"', () => {
    it('renderAiMetricsSummary вызывается под guard\'ом subTab === "qty"', () => {
        const calls = detailsSrc.match(/renderAiMetricsSummary\s*\(/g) || [];
        assert.ok(calls.length >= 1,
            'renderAiMetricsSummary должен вызываться хотя бы один раз в renderDetails');

        // Ожидаем шаблон вида `subTab === 'qty' && renderAiMetricsSummary(...)`
        // (краткая запись, чтобы не писать тернарник с null). Допускаем любые
        // одинарные/двойные кавычки и whitespace.
        const guardedShortCircuit =
            /subTab\s*===\s*['"]qty['"]\s*&&\s*renderAiMetricsSummary\s*\(/
                .test(detailsSrc);

        // Альтернативный валидный шаблон: тернарник
        // `subTab === 'qty' ? renderAiMetricsSummary(...) : null`.
        const guardedTernary =
            /subTab\s*===\s*['"]qty['"]\s*\?\s*renderAiMetricsSummary\s*\(/
                .test(detailsSrc);

        assert.ok(guardedShortCircuit || guardedTernary,
            'renderAiMetricsSummary должен вызываться под условием subTab === "qty" ' +
            '(`subTab === "qty" && renderAiMetricsSummary(...)` или тернарник). ' +
            'Иначе qty-сводка появляется в режиме «Бюджет».');
    });

    it('нет безусловного вызова renderAiMetricsSummary в JSX-подобном дереве renderDetails', () => {
        // Безусловный вызов выглядит как `,\s*renderAiMetricsSummary(` —
        // элемент массива/детей el(...) без тернарника/&&. Если такой найден —
        // это и есть тот баг, который мы зафиксировали.
        // Проверяем, что СРАЗУ перед вызовом нет «голой» запятой (без guard'а).
        const naked = /[)\]}]\s*,\s*renderAiMetricsSummary\s*\(/.test(detailsSrc);
        assert.equal(naked, false,
            'найден безусловный вызов renderAiMetricsSummary как ребёнка в дереве — ' +
            'обязательно должен быть guard subTab === "qty"');
    });
});
