/**
 * Forcing function (2.22.2): фиксирует ВСЕ места, ранжирующие параметры через
 * sensitivity-движок (rankSensitivityDrivers), и их классификацию — чтобы новый
 * потребитель не появился молча с иным costType/categories и не создал «противоречие»
 * (разный топ-факторов в двух местах), которое сообщил пользователь 2026-06-17.
 *
 * Классификация известных потребителей:
 *   • sensitivityAnalysisModal.js — «Анализ факторов» (ЭТАЛОН): costType+categories
 *     из state.ui.sensitivityFilters.
 *   • prodPassport.js — НЕ потребитель с 2.22.5: раздел «Факторы влияния» удалён из
 *     Паспорта ПРОМ по требованию пользователя (там нужна as-is карта затрат, а не
 *     what-if sensitivity). Паспорт больше не вызывает rankSensitivityDrivers.
 *   • budgetGuardrails.js — «Причины превышения бюджета»: ДРУГОЙ вопрос (ранг по
 *     превышенной оси), сознательно НЕ привязан к UI-фильтру.
 *   • decisionMemoController.js — Decision Memo: основной список = состав стоимости
 *     (top-ЭК), sensitivity лишь косвенно через budgetGuardrails.
 *   • sensitivityAnalysis.js — определение движка (экспорт), не потребитель.
 *
 * Если файл добавился/исчез — сознательно реши: это «фактор влияния» (должен делить
 * state.ui.sensitivityFilters с эталоном) или другая метрика (документируй в EXEMPT),
 * и обнови список.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.resolve(__dirname, '../../../js');

const EXPECTED = new Set([
    'domain/sensitivityAnalysis.js',          // определение (export)
    'ui/modals/sensitivityAnalysisModal.js',  // эталон «Анализ факторов»
    'domain/budgetGuardrails.js',             // «Причины превышения» — другой вопрос (exempt)
    'controllers/decisionMemoController.js'    // Decision Memo — состав стоимости (exempt)
]);

function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('factor-influence: набор потребителей rankSensitivityDrivers зафиксирован', () => {
    it('никаких НОВЫХ/исчезнувших потребителей без сознательной классификации', () => {
        const actual = new Set();
        for (const file of walk(JS_DIR)) {
            const src = stripJsComments(readFileSync(file, 'utf8'));
            if (/\brankSensitivityDrivers\b/.test(src)) {
                actual.add(path.relative(JS_DIR, file).replace(/\\/g, '/'));
            }
        }
        const added = [...actual].filter(f => !EXPECTED.has(f));
        const removed = [...EXPECTED].filter(f => !actual.has(f));
        assert.deepEqual(added, [],
            `НОВЫЙ потребитель sensitivity-ранжирования: ${added.join(', ')}. Классифицируй: «фактор влияния» (дели state.ui.sensitivityFilters с эталоном) или другая метрика (добавь в EXEMPT с обоснованием).`);
        assert.deepEqual(removed, [],
            `Исчез потребитель: ${removed.join(', ')}. Обнови EXPECTED.`);
    });

    it('Паспорт ПРОМ НЕ вызывает rankSensitivityDrivers (раздел «Факторы влияния» удалён, 2.22.5)', () => {
        const src = stripJsComments(readFileSync(path.join(JS_DIR, 'domain/prodPassport.js'), 'utf8'));
        assert.doesNotMatch(src, /\brankSensitivityDrivers\b/,
            'prodPassport не должен использовать sensitivity — Паспорт показывает as-is карту затрат, не what-if');
        assert.doesNotMatch(src, /\bbuildSensitivityFactors\b/,
            'buildSensitivityFactors удалён вместе с разделом «Факторы влияния»');
    });
});
