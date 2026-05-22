/**
 * Регрессионный тест к 13.U10-fix: AI-блоки в Сравнении не должны вылезать
 * за границы своих карточек.
 *
 * Корень бага: `.comparison-ai-block` лежит в grid с `minmax(380px, 1fr)`.
 * Дефолтный `min-width: auto` для grid-items означает, что трек растёт
 * по min-content ребёнка — а ребёнок (мини-таблица 4 метрики × 5 стендов)
 * имеет `white-space: nowrap` на ячейках. После 13.U7 (per-stand AI-агенты)
 * qty-значения стали 5-6-значными (288 207 / 331 438), и итог типа
 * «827 152 млн токенов / мес» раздувал трек шире карточки соседа.
 *
 * Два инварианта:
 *   (a) `.comparison-ai-block { min-width: 0 }` — grid-item уважает 1fr-аллокацию
 *       трека, а не растёт по содержимому.
 *   (b) `.comparison-ai-block-table-wrap { overflow-x: auto }` — финальная
 *       страховка для экстремальных значений (триллионы токенов).
 *
 * `overflow` здесь безопасен: sticky-thead в мини-таблице нет
 * (sticky только в `.comparison-table-wrap`, у которого overflow намеренно
 * удалён — см. 12.U31 A.1).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleBody } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cmpCss = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'comparison.css'),
    'utf8'
);

describe('comparison-ai-block: содержимое не вылезает за карточку', () => {
    it('.comparison-ai-block имеет min-width: 0 (grid-item уважает 1fr)', () => {
        const body = ruleBody(cmpCss, '.comparison-ai-block');
        assert.match(body, /min-width\s*:\s*0\b/,
            'Без min-width:0 grid-item растёт по min-content (= ширине таблицы ' +
            'с nowrap) и пролезает в соседнюю карточку или за viewport.');
    });

    it('.comparison-ai-block-table-wrap имеет overflow-x: auto', () => {
        const body = ruleBody(cmpCss, '.comparison-ai-block-table-wrap');
        assert.match(body, /overflow-x\s*:\s*auto\b/,
            'Финальная страховка: на экстремальных значениях (триллионы ' +
            'токенов / 7-значные qty) min-width:0 + minmax(440px) могут ' +
            'оказаться недостаточны. Sticky-thead в мини-таблице нет, ' +
            'поэтому overflow безопасен (ловушка 12.U30/12.U31 неприменима).');
    });

    it('grid использует minmax не меньше 440px (ИТОГО с unit-suffix помещается)', () => {
        const body = ruleBody(cmpCss, '.comparison-ai-section-grid');
        const m = body.match(/minmax\s*\(\s*(\d+)px/);
        assert.ok(m, 'minmax(<min>px, 1fr) обязателен для auto-fit раскладки');
        const min = Number(m[1]);
        assert.ok(min >= 440,
            `minmax min = ${min}px, ожидался ≥ 440px. ` +
            `Узкий трек + nowrap-таблица = карточка лопается; см. 13.U10-fix.`);
    });
});

describe('comparison-ai-cell-total: колонка ИТОГО визуально выделена', () => {
    /* 13.U10-fix-2: тот же приём, что в Детализации (13.U10-UI):
       bg-elevated + border-left, чтобы колонка с итогами читалась как
       отдельная семантическая ось (per-stand vs ИТОГО). Класс стоит
       и на thead-th, и на tbody-td → одно правило подсвечивает
       и заголовок, и значения. */
    it('.comparison-ai-cell-total имеет background и border-left', () => {
        const body = ruleBody(cmpCss, '.comparison-ai-cell-total');
        assert.match(body, /background\s*:\s*var\(--bg-elevated\)/,
            'фон должен идти через токен --bg-elevated (работает в обеих темах)');
        assert.match(body, /border-left\s*:\s*1px\s+solid\s+var\(--border\)/,
            'border-left отделяет ИТОГО от per-stand колонок');
    });
});
