/**
 * Regression-тест: суммы внутри стенд-карточки (CAPEX/OPEX и категории
 * «ПО КАТЕГОРИЯМ») должны включать интервал времени (`/ мес`, `/ год`,
 * `/ день` — slash). Без него пользователь не понимает, в каком периоде
 * считается сумма, особенно когда переключает период на дашборде.
 *
 * Главное число карточки и её НДС/Риски строки уже включают slash; легенда
 * категорий + CAPEX/OPEX подытоги — нет, унифицируем.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSource = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'dashboard.js'),
    'utf8'
);

describe('Стенд-карточка: суммы с интервалом времени (12.U30 user-fix)', () => {
    /* Считаем все вхождения класса dash-stand-card-cats-legend-amount
     * и проверяем, что в каждом text: справа есть slash. */
    it('dash-stand-card-cats-legend-amount: text включает ${slash}', () => {
        // Ищем `class: 'dash-stand-card-cats-legend-amount'` и далее `text: ...`
        // в пределах ~200 символов. text должен содержать ${slash}.
        const re = /dash-stand-card-cats-legend-amount['"][\s\S]{0,250}?text:\s*([`'"])([\s\S]*?)\1/g;
        let found = 0;
        for (const m of dashboardSource.matchAll(re)) {
            found++;
            const textValue = m[2];
            assert.match(textValue, /\$\{slash\}/,
                `text для dash-stand-card-cats-legend-amount должен включать \${slash}, ` +
                `найдено: «${textValue}»`);
        }
        assert.ok(found >= 1, 'должно быть хотя бы одно вхождение dash-stand-card-cats-legend-amount');
    });

    it('dash-cost-row-amount (CAPEX/OPEX): text включает ${slash}', () => {
        const re = /dash-cost-row-amount['"][\s\S]{0,250}?text:\s*([`'"])([\s\S]*?)\1/g;
        let found = 0;
        for (const m of dashboardSource.matchAll(re)) {
            found++;
            const textValue = m[2];
            assert.match(textValue, /\$\{slash\}/,
                `text для dash-cost-row-amount должен включать \${slash} (период), ` +
                `найдено: «${textValue}»`);
        }
        assert.ok(found >= 2,
            `dash-cost-row-amount должен встречаться минимум 2 раза (Hero CAPEX/OPEX + Стенд CAPEX/OPEX), найдено ${found}`);
    });
});
