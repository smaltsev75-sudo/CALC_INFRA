/**
 * Тесты CSV-парсера и diff'а цен ЭК.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseCsv, parseNumber, diffPricesFromCsv, ANOMALY_MULTIPLIER
} from '../../../js/services/csvImport.js';

describe('parseNumber: толерантность к форматам', () => {
    it('целые', () => assert.equal(parseNumber('100'), 100));
    it('точка как разделитель', () => assert.equal(parseNumber('14.2'), 14.2));
    it('запятая как разделитель (RU)', () => assert.equal(parseNumber('14,2'), 14.2));
    it('пробелы внутри числа', () => assert.equal(parseNumber('1 234 567,89'), 1234567.89));
    it('пустая строка → NaN', () => assert.ok(Number.isNaN(parseNumber(''))));
    it('null/undefined → NaN', () => {
        assert.ok(Number.isNaN(parseNumber(null)));
        assert.ok(Number.isNaN(parseNumber(undefined)));
    });
    it('число — пропускается как есть', () => assert.equal(parseNumber(42), 42));
    it('текст не-число → NaN', () => assert.ok(Number.isNaN(parseNumber('abc'))));
});

describe('parseCsv: разделители и заголовки', () => {
    it('детектит ; (RU Excel)', () => {
        const { rows, delimiter } = parseCsv('id;price\na;100\nb;200\n');
        assert.equal(delimiter, ';');
        assert.equal(rows.length, 2);
        assert.equal(rows[0].id, 'a');
        assert.equal(rows[1].price, '200');
    });
    it('детектит , если ; нет', () => {
        const { delimiter, rows } = parseCsv('id,price\na,100\n');
        assert.equal(delimiter, ',');
        assert.equal(rows[0].id, 'a');
    });
    it('пустые строки игнорируются', () => {
        const { rows } = parseCsv('id;p\n\n\nx;1\n\n');
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, 'x');
    });
    it('обрабатывает CRLF', () => {
        const { rows } = parseCsv('id;p\r\nx;1\r\ny;2\r\n');
        assert.equal(rows.length, 2);
    });
    it('пустой текст бросает ошибку', () => {
        assert.throws(() => parseCsv(''));
        assert.throws(() => parseCsv('   '));
    });
});

describe('parseCsv: кавычки и экранирование', () => {
    it('значение в кавычках с разделителем', () => {
        const { rows } = parseCsv('id;name\n1;"a;b;c"\n');
        assert.equal(rows[0].name, 'a;b;c');
    });
    it('удвоенные кавычки внутри', () => {
        const { rows } = parseCsv('id;name\n1;"He said ""hi"""\n');
        assert.equal(rows[0].name, 'He said "hi"');
    });
    it('перевод строки внутри кавычек', () => {
        const { rows } = parseCsv('id;name\n1;"line1\nline2"\n');
        assert.equal(rows[0].name, 'line1\nline2');
    });
});

describe('diffPricesFromCsv: матчинг по id', () => {
    const items = () => [
        { id: 'a', name: 'A', pricePerUnit: 100 },
        { id: 'b', name: 'B', pricePerUnit: 200 }
    ];

    it('обновляет цены по совпадению id', () => {
        const rows = [
            { id: 'a', pricePerUnit: '150' },
            { id: 'b', pricePerUnit: '250' }
        ];
        const diff = diffPricesFromCsv(rows, items());
        assert.equal(diff.safeUpdates.length, 2);
        assert.equal(diff.safeUpdates[0].oldPrice, 100);
        assert.equal(diff.safeUpdates[0].newPrice, 150);
    });

    it('rejected: id не найден', () => {
        const rows = [{ id: 'unknown', pricePerUnit: '99' }];
        const diff = diffPricesFromCsv(rows, items());
        assert.equal(diff.safeUpdates.length, 0);
        assert.equal(diff.rejected.length, 1);
        assert.match(diff.rejected[0].reason, /Нет ЭК с id="unknown"/);
    });

    it('rejected: пустой id', () => {
        const rows = [{ id: '', pricePerUnit: '99' }];
        const diff = diffPricesFromCsv(rows, items());
        assert.equal(diff.rejected.length, 1);
        assert.match(diff.rejected[0].reason, /Пустой id/);
    });

    it('unchanged: цена совпадает', () => {
        const rows = [{ id: 'a', pricePerUnit: '100' }];
        const diff = diffPricesFromCsv(rows, items());
        assert.equal(diff.unchanged, 1);
        assert.equal(diff.safeUpdates.length, 0);
    });
});

describe('diffPricesFromCsv: валидация', () => {
    const items = () => [{ id: 'a', name: 'A', pricePerUnit: 100 }];

    it('rejected: некорректное число', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: 'abc' }], items());
        assert.equal(diff.rejected.length, 1);
        assert.match(diff.rejected[0].reason, /Некорректная цена/);
    });
    it('rejected: отрицательная цена (< PRICE_MIN)', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '-5' }], items());
        assert.equal(diff.rejected.length, 1);
        assert.match(diff.rejected[0].reason, /< 0/);
    });
    it('rejected: цена > PRICE_MAX (1e12)', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '999999999999999' }], items());
        assert.equal(diff.rejected.length, 1);
        assert.match(diff.rejected[0].reason, /> .*максимум/);
    });
    it('принимает цену = 0 (минимум)', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '0' }], items());
        assert.equal(diff.rejected.length, 0);
        assert.equal(diff.safeUpdates[0].newPrice, 0);
    });
});

describe('diffPricesFromCsv: эвристика аномалий', () => {
    const items = () => [{ id: 'a', name: 'A', pricePerUnit: 100 }];

    it('помечает как аномалию рост в 10× и более (НЕ попадает в safeUpdates)', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '1500' }], items());
        assert.equal(diff.safeUpdates.length, 0, 'аномалия НЕ в safeUpdates (Этап 11.2.1)');
        assert.equal(diff.anomalies.length, 1);
        assert.match(diff.anomalies[0].reason, /выросла в 15/);
    });

    it('помечает как аномалию падение в 10× и более', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '5' }], items());
        assert.equal(diff.safeUpdates.length, 0);
        assert.equal(diff.anomalies.length, 1);
        assert.match(diff.anomalies[0].reason, /упала в 20/);
    });

    it('изменение в 5× — не аномалия', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '500' }], items());
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.anomalies.length, 0);
    });

    it('старая цена 0 → ratio неопределён, аномалии нет даже при огромной новой', () => {
        const noPriceItems = [{ id: 'a', pricePerUnit: 0 }];
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '1000000' }], noPriceItems);
        assert.equal(diff.anomalies.length, 0);
        assert.equal(diff.safeUpdates.length, 1);
    });

    it('константа ANOMALY_MULTIPLIER = 10', () => {
        assert.equal(ANOMALY_MULTIPLIER, 10);
    });
});

describe('diffPricesFromCsv: контракт API после Этапа 11.2.1', () => {
    it('возвращает safeUpdates и anomalies как массивы (даже на пустом входе)', () => {
        const diff = diffPricesFromCsv([], [{ id: 'a', name: 'A', pricePerUnit: 100 }]);
        assert.ok(Array.isArray(diff.safeUpdates), 'safeUpdates — массив');
        assert.ok(Array.isArray(diff.anomalies), 'anomalies — массив');
        assert.equal(diff.safeUpdates.length, 0);
        assert.equal(diff.anomalies.length, 0);
        // Старое поле updates не должно существовать — это breaking change.
        assert.equal(diff.updates, undefined, 'updates удалено в пользу safeUpdates');
    });

    it('некорректный input (rows не массив) → safeUpdates/anomalies пустые массивы', () => {
        const diff = diffPricesFromCsv(null, []);
        assert.ok(Array.isArray(diff.safeUpdates));
        assert.ok(Array.isArray(diff.anomalies));
        assert.equal(diff.safeUpdates.length, 0);
        assert.equal(diff.anomalies.length, 0);
        assert.equal(diff.rejected.length, 1);
    });

    it('аномалия и безопасное обновление одновременно — НЕ дублируются', () => {
        const items = [
            { id: 'safe', name: 'Safe', pricePerUnit: 100 },     // → ×2 (safe)
            { id: 'anom', name: 'Anom', pricePerUnit: 100 }      // → ×20 (anomaly)
        ];
        const rows = [
            { id: 'safe', pricePerUnit: '200' },
            { id: 'anom', pricePerUnit: '2000' }
        ];
        const diff = diffPricesFromCsv(rows, items);
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.safeUpdates[0].id, 'safe');
        assert.equal(diff.anomalies.length, 1);
        assert.equal(diff.anomalies[0].id, 'anom');
        // Главное: 'anom' НЕ в safeUpdates.
        assert.ok(
            !diff.safeUpdates.some(u => u.id === 'anom'),
            'аномалия не должна дублироваться в safeUpdates'
        );
    });
});

describe('diffPricesFromCsv: костType (CAPEX/OPEX)', () => {
    const items = () => [
        { id: 'a', name: 'A', pricePerUnit: 100, billingInterval: 'monthly' },
        { id: 'b', name: 'B', pricePerUnit: 200, billingInterval: 'oneTime', costType: 'capex' }
    ];

    it('costType="capex" применяется к ЭК (был без явного типа)', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '100', costType: 'capex' }], items());
        assert.equal(diff.unchanged, 0);
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.safeUpdates[0].newCostType, 'capex');
        assert.equal(diff.costTypeChanges, 1);
    });

    it('costType="opex" применяется к ЭК (был capex)', () => {
        const diff = diffPricesFromCsv([{ id: 'b', pricePerUnit: '200', costType: 'opex' }], items());
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.safeUpdates[0].newCostType, 'opex');
        assert.equal(diff.safeUpdates[0].oldCostType, 'capex');
        assert.equal(diff.costTypeChanges, 1);
    });

    it('пустой costType — не меняет тип', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '100', costType: '' }], items());
        assert.equal(diff.unchanged, 1);
        assert.equal(diff.costTypeChanges, 0);
    });

    it('одинаковый costType + одинаковая цена → unchanged', () => {
        const diff = diffPricesFromCsv([{ id: 'b', pricePerUnit: '200', costType: 'capex' }], items());
        assert.equal(diff.unchanged, 1);
        assert.equal(diff.costTypeChanges, 0);
    });

    it('некорректный costType → costTypeRejected, цена всё равно применяется', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '150', costType: 'WRONG' }], items());
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.safeUpdates[0].newPrice, 150);
        assert.equal(diff.costTypeRejected.length, 1);
        assert.equal(diff.costTypeRejected[0].id, 'a');
        assert.equal(diff.costTypeChanges, 0);
    });

    it('костType регистронезависимо: "CAPEX" принимается', () => {
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '100', costType: 'CAPEX' }], items());
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.safeUpdates[0].newCostType, 'capex');
        assert.equal(diff.costTypeChanges, 1);
    });

    it('изменение только costType без изменения цены — попадает в safeUpdates', () => {
        // ЭК "a" уже без явного costType, цена 100; задаём явный capex без правки цены.
        const diff = diffPricesFromCsv([{ id: 'a', pricePerUnit: '100', costType: 'capex' }], items());
        assert.equal(diff.safeUpdates.length, 1);
        assert.equal(diff.safeUpdates[0].oldPrice, 100);
        assert.equal(diff.safeUpdates[0].newPrice, 100);
        assert.equal(diff.safeUpdates[0].newCostType, 'capex');
        assert.equal(diff.costTypeChanges, 1);
    });
});

describe('diffPricesFromCsv: смешанные сценарии', () => {
    it('файл с обновлениями, аномалиями, отклонениями и дублями', () => {
        const items = [
            { id: 'a', name: 'A', pricePerUnit: 100 },
            { id: 'b', name: 'B', pricePerUnit: 200 },
            { id: 'c', name: 'C', pricePerUnit: 300 }
        ];
        const rows = [
            { id: 'a', pricePerUnit: '150' },          // нормальное обновление → safeUpdates
            { id: 'b', pricePerUnit: '200' },          // unchanged
            { id: 'c', pricePerUnit: '5000' },         // аномалия (16.7×) → anomalies, НЕ safeUpdates
            { id: 'unknown', pricePerUnit: '50' },     // rejected (no match)
            { id: '', pricePerUnit: '99' },            // rejected (empty id)
            { id: 'a', pricePerUnit: 'NaN' }           // rejected (parse)
        ];
        const diff = diffPricesFromCsv(rows, items);
        assert.equal(diff.safeUpdates.length, 1, 'только a — c теперь в anomalies');
        assert.equal(diff.safeUpdates[0].id, 'a');
        assert.equal(diff.anomalies.length, 1);
        assert.equal(diff.anomalies[0].id, 'c');
        assert.equal(diff.unchanged, 1);
        assert.equal(diff.rejected.length, 3);
    });
});
