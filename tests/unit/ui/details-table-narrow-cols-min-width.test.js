/**
 * PATCH 2.7.2 hotfix: узкие колонки `.col-tariff` / `.col-unit` / `.col-price` /
 * `.col-share` / `.col-risk` / `.col-risk-amount` обязаны иметь `min-width`
 * в `tables.css` — иначе на auto-layout таблице с короткими русскими
 * заголовками («Тариф», «Ед.изм.», «Цена/ед.», «Риск, %») и общим правилом
 * `word-break: break-word` (tables.css:99) браузер сжимает th до ~30px и
 * рендерит заголовок ПО БУКВЕ ВЕРТИКАЛЬНО (Т/А/Р/И/Ф).
 *
 * Уже была закрыта `.col-cost-type` в Stage 12.U30 (`min-width: 90px` +
 * `word-break: keep-all`) — этот хотфикс распространяет тот же паттерн
 * на остальные узкие numeric-колонки.
 *
 * НЕ покрывается общим линтером `details-table-numeric-cols.test.js` (12.U31 A.2)
 * — тот проверяет отсутствие `table-layout: fixed`, не min-width на колонках.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const cssRaw = fs.readFileSync(path.join(ROOT, 'css/tables.css'), 'utf8');
const css = stripCssComments(cssRaw);

describe('PATCH 2.7.2 / details-table узкие колонки имеют min-width', () => {
    /* col-cost-type — закрыто 12.U30, дублируем как regression-protection. */
    const NARROW_COLS = [
        'col-tariff', 'col-unit', 'col-price',
        'col-share', 'col-risk', 'col-risk-amount',
        'col-cost-type'
    ];

    for (const cls of NARROW_COLS) {
        it(`.details-table .${cls} имеет min-width в CSS`, () => {
            /* Ищем правило в comma-группе или одиночное. */
            const re = new RegExp(
                String.raw`(?:^|[\s,])\.details-table\s+\.${cls}\b[^{}]*[{,]`,
                'm'
            );
            assert.match(css, re,
                `.details-table .${cls} должен быть упомянут в tables.css`);

            /* Проверяем, что в каком-либо правиле, где этот класс участвует,
               задан min-width. Comma-группы могут содержать его коллективно —
               проверяем, что хотя бы один блок с этим селектором имеет min-width. */
            const blockRe = new RegExp(
                String.raw`([^{}]*\.details-table\s+\.${cls}\b[^{}]*)\{([^}]*)\}`,
                'gm'
            );
            let foundMinWidth = false;
            let m;
            while ((m = blockRe.exec(css)) !== null) {
                if (/min-width\s*:/.test(m[2])) {
                    foundMinWidth = true;
                    break;
                }
            }
            assert.ok(foundMinWidth,
                `.details-table .${cls} обязан иметь min-width — иначе при ` +
                `auto-layout с word-break:break-word короткий русский заголовок ` +
                `(<5 chars) ломается по букве на строку. См. PATCH 2.7.2 hotfix.`);
        });
    }
});
