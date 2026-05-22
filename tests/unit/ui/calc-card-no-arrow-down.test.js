/**
 * Regression-тест: sub-метрика карточки расчёта на вкладке «Расчёты» НЕ
 * содержит иконку `arrow-down` и tooltip-подсказку «Месячная стоимость =
 * годовая / 12». Пользователь явно попросил их убрать — текст «X тыс. ₽ / мес»
 * сам по себе понятен.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const calcListSource = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'calcList.js'),
    'utf8'
);

describe('Карточка расчёта: sub-метрика без arrow-down (12.U30 user-fix)', () => {
    it("calcList.js НЕ вызывает icon('arrow-down')", () => {
        assert.doesNotMatch(calcListSource, /icon\(['"]arrow-down['"]/,
            "Иконка стрелки вниз убрана из sub-метрики (карточка расчёта на вкладке «Расчёты»)");
    });

    it("title «Месячная стоимость = годовая / 12» удалён", () => {
        assert.doesNotMatch(calcListSource, /Месячная стоимость\s*=\s*годовая\s*\/\s*12/,
            "tooltip про деление годовой на 12 удалён — пользователь не нуждается в подсказке");
    });
});
