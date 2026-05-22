/**
 * Regression-тесты к 12.U30: согласованность визуальной иерархии в карточках
 * «Распределение по категориям» и «Вклад риск-коэффициентов».
 *
 * Пользовательское требование (1.2): обе карточки показывают одинаковый набор
 * данных (label + сумма + %), поэтому визуальная иерархия должна совпадать —
 * **сумма = акцент** (color: text + font-weight: 600), **% = приглушённый**
 * (color: text-muted + font-weight: 500).
 *
 * Раньше было ровно наоборот: в Категориях сумма приглушена / % жирный, в
 * Риск-коэф сумма жирная / % приглушён → пользователь видел один и тот же
 * набор данных в двух карточках с инвертированной иерархией.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssSource = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'dashboard.css'),
    'utf8'
);

/** Извлечь body CSS-правила по селектору. Бросает, если правило не найдено. */
function ruleBody(selector) {
    const re = new RegExp(selector.replace(/\./g, '\\.') + '\\s*\\{([^}]+)\\}');
    const m = cssSource.match(re);
    if (!m) throw new Error(`CSS-правило ${selector} не найдено в dashboard.css`);
    return m[1];
}

describe('Dashboard cards: визуальная иерархия Сумма / %', () => {
    it('.dash-category-row-value (СУММА) — акцент: color: text + font-weight: 600', () => {
        const body = ruleBody('.dash-category-row-value');
        assert.match(body, /color:\s*var\(--text\)/, 'сумма должна быть color: var(--text), не muted');
        assert.match(body, /font-weight:\s*600/, 'сумма должна быть font-weight: 600 (акцент)');
    });

    it('.dash-category-row-pct (%) — приглушённый: color: text-muted + font-weight: 500', () => {
        const body = ruleBody('.dash-category-row-pct');
        assert.match(body, /color:\s*var\(--text-muted\)/, '% должен быть приглушённым (text-muted)');
        assert.match(body, /font-weight:\s*500/, '% должен быть font-weight: 500');
    });

    it('.dash-risk-row-amount (СУММА) — акцент: color: text + font-weight: 600', () => {
        const body = ruleBody('.dash-risk-row-amount');
        assert.match(body, /color:\s*var\(--text\)/, 'сумма должна быть color: var(--text)');
        assert.match(body, /font-weight:\s*600/, 'сумма должна быть font-weight: 600');
    });

    it('.dash-risk-row-value (%) — приглушённый: color: text-muted + font-weight: 500', () => {
        const body = ruleBody('.dash-risk-row-value');
        assert.match(body, /color:\s*var\(--text-muted\)/, '% должен быть приглушённым');
        assert.match(body, /font-weight:\s*500/, '% должен быть font-weight: 500 (НЕ 600 — это контракт согласованности с категорией)');
    });

    it('обе карточки используют tabular-nums (выровненные цифры)', () => {
        for (const sel of ['.dash-category-row-value', '.dash-category-row-pct',
                           '.dash-risk-row-amount', '.dash-risk-row-value']) {
            const body = ruleBody(sel);
            assert.match(body, /font-variant-numeric:\s*tabular-nums/,
                `${sel} должен иметь font-variant-numeric: tabular-nums (выравнивание цифр в столбце)`);
        }
    });
});
