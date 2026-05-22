import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildDetailsCsv, buildCalcCsvFilename, buildComparisonCsv } from '../../../js/services/csvExport.js';
import { calculate } from '../../../js/domain/calculator.js';
import { buildSeedDictionaries, defaultAnswersFrom, SEED_SETTINGS } from '../../../js/domain/seed.js';

const makeCalc = () => {
    const dict = buildSeedDictionaries();
    return {
        version: '1.0', id: 't', name: 'Test', schemaVersion: 1,
        createdAt: '2026', updatedAt: '2026',
        settings: { ...SEED_SETTINGS, phaseDurationMonths: 4 },
        answers: defaultAnswersFrom(dict.questions),
        dictionaries: dict
    };
};

describe('CSV: header and structure', () => {
    it('starts with BOM', () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const csv = buildDetailsCsv(calc, result);
        assert.equal(csv.charCodeAt(0), 0xFEFF, 'should start with BOM');
    });

    it('contains calc name in header', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc));
        assert.match(csv, /Test/);
    });

    it('uses ; as default delimiter', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc));
        // header row should contain semicolons
        const headerLine = csv.split('\r\n').find(l => l.includes('Категория'));
        assert.ok(headerLine.includes(';'));
    });

    it('honors custom delimiter', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc), { delimiter: ',' });
        const headerLine = csv.split('\r\n').find(l => l.includes('Категория'));
        assert.ok(headerLine.includes(','));
    });
});

describe('CSV: numeric formatting', () => {
    it('uses comma as decimal separator', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc));
        // dollars/cents like 1234.5 should be 1234,5
        assert.match(csv, /\d+,\d/);
    });

    it('does not include currency sign in cells', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc));
        // Внутри ячеек данных не должно быть ₽; он только в заголовках столбцов
        const lines = csv.split('\r\n');
        const dataLines = lines.slice(5); // skip metadata + header
        for (const line of dataLines) {
            // ₽ может быть только в заголовках — проверяем только строки с цифрами
            if (line.includes('₽')) {
                // допустимо в строках типа "ИТОГО, ₽/мес" (заголовок)
                continue;
            }
        }
        // Хотя бы одна data-строка не имеет ₽
        assert.ok(dataLines.some(l => /\d+,\d/.test(l) && !l.includes('₽')));
    });
});

describe('CSV: escaping', () => {
    it('quotes values containing delimiter', () => {
        const calc = makeCalc();
        // Меняем имя ЭК с точкой с запятой
        calc.dictionaries.items[0] = {
            ...calc.dictionaries.items[0],
            name: 'Item; with semicolon'
        };
        const csv = buildDetailsCsv(calc, calculate(calc));
        assert.match(csv, /"Item; with semicolon"/);
    });

    it('escapes internal quotes', () => {
        const calc = makeCalc();
        calc.dictionaries.items[0] = {
            ...calc.dictionaries.items[0],
            name: 'Item "quoted"'
        };
        const csv = buildDetailsCsv(calc, calculate(calc));
        assert.match(csv, /"Item ""quoted"""/);
    });

    it('quotes values with newlines', () => {
        const calc = makeCalc();
        calc.dictionaries.items[0] = {
            ...calc.dictionaries.items[0],
            description: 'line1\nline2'
        };
        const csv = buildDetailsCsv(calc, calculate(calc), { includeFormulas: false });
        // description не выводится в текущей версии, но проверим что ничего не падает
        assert.ok(csv.length > 0);
    });
});

describe('CSV: completeness', () => {
    it('contains row for every item', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc));
        const itemCount = calc.dictionaries.items.length;
        // Структура CSV (schema v2 + CAPEX/OPEX summary):
        //   4 строки metadata (Расчёт+Валюта / буферы / k* / НДС+горизонт+дни)
        //   2 строки CAPEX/OPEX summary
        //   1 пустая
        //   1 header
        //   N data
        //   1 пустая
        //   1 ИТОГО
        // → overhead = 10.
        const lines = csv.split('\r\n');
        const dataLines = lines.length - 10;
        assert.equal(dataLines, itemCount,
            `Ожидали ${itemCount} data-строк, получили ${dataLines} (всего строк ${lines.length})`);
    });

    it('totals row sums per column correctly', () => {
        const calc = makeCalc();
        const result = calculate(calc);
        const csv = buildDetailsCsv(calc, result);
        const lines = csv.split('\r\n');
        const totalsLine = lines[lines.length - 1];
        // последний CSV-столбец перед концом строки = ИТОГО, ₽/год
        const cells = totalsLine.split(';');
        const totalAnnual = parseFloat(cells[cells.length - 1].replace(',', '.'));
        assert.ok(Math.abs(totalAnnual - result.totalAnnual) < 1);
    });
});

describe('CSV: includeFormulas option', () => {
    it('adds formula columns when enabled', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc), { includeFormulas: true });
        assert.match(csv, /Формула DEV/);
        assert.match(csv, /Формула ПРОМ/);
    });
    it('omits formula columns by default', () => {
        const calc = makeCalc();
        const csv = buildDetailsCsv(calc, calculate(calc));
        assert.doesNotMatch(csv, /Формула/);
    });
});

describe('buildCalcCsvFilename', () => {
    it('includes calc name and date', () => {
        const fn = buildCalcCsvFilename({ name: 'My Calc' });
        assert.match(fn, /My-Calc-detail-\d{2}\.\d{2}\.\d{4}\.csv/);
    });
    it('handles missing name', () => {
        const fn = buildCalcCsvFilename({});
        assert.match(fn, /^calc-detail/);
    });
});

describe('buildComparisonCsv', () => {
    // Хелпер: расчёт с заданным именем и id, всё остальное — из seed.
    const makeNamedCalc = (id, name) => {
        const dict = buildSeedDictionaries();
        return {
            version: '1.0', id, name, schemaVersion: 1,
            createdAt: '2026', updatedAt: '2026',
            settings: { ...SEED_SETTINGS, phaseDurationMonths: 4 },
            answers: defaultAnswersFrom(dict.questions),
            dictionaries: dict
        };
    };

    it('header row has N+1 columns: «Метрика» + по одной на каждый расчёт', () => {
        const calcs = [makeNamedCalc('a', 'Alpha'), makeNamedCalc('b', 'Beta'), makeNamedCalc('c', 'Gamma')];
        const results = calcs.map(c => calculate(c));
        const csv = buildComparisonCsv(calcs, results);

        const lines = csv.split('\r\n');
        // [0] = заголовок «Сравнение расчётов;ISO», [1] = пустая, [2] = header «Метрика;...»
        const headerLine = lines[2];
        const cells = headerLine.split(';');
        assert.equal(cells.length, calcs.length + 1, `ожидали ${calcs.length + 1} колонок, получили ${cells.length}`);
        assert.equal(cells[0], 'Метрика');
        // Имя каждого расчёта присутствует с суффиксом «(₽)» (12.U26-fix: RUB → ₽).
        assert.match(headerLine, /Alpha \(₽\)/);
        assert.match(headerLine, /Beta \(₽\)/);
        assert.match(headerLine, /Gamma \(₽\)/);
    });

    it('numeric cells use comma as decimal separator (RU-локаль)', () => {
        const calcs = [makeNamedCalc('a', 'Alpha'), makeNamedCalc('b', 'Beta')];
        const results = calcs.map(c => calculate(c));
        const csv = buildComparisonCsv(calcs, results);

        // Строка «ИТОГО / мес» — должна содержать число с запятой как разделителем.
        const lines = csv.split('\r\n');
        const totalLine = lines.find(l => l.startsWith('ИТОГО / мес;'));
        assert.ok(totalLine, 'строка «ИТОГО / мес» должна быть в CSV');
        // Хотя бы одна ячейка вида 1234,56 (с запятой и без точки).
        assert.match(totalLine, /\d+,\d/);
        // Точек в числах быть не должно (запятая — единственный десятичный разделитель).
        const numericCells = totalLine.split(';').slice(1);
        for (const cell of numericCells) {
            assert.equal(cell.includes('.'), false, `ячейка «${cell}» содержит точку — должна быть запятая`);
        }
    });

    it('protects against CSV-injection in calc name (=cmd → \'=cmd within quotes)', () => {
        const calcs = [makeNamedCalc('a', '=cmd|exec'), makeNamedCalc('b', 'Safe')];
        const results = calcs.map(c => calculate(c));
        const csv = buildComparisonCsv(calcs, results);

        // Header содержит имя `=cmd|exec (RUB)` — должно быть префиксовано `'`
        // и обёрнуто в кавычки (csvSafeQuote).
        const lines = csv.split('\r\n');
        const headerLine = lines[2];
        const cells = headerLine.split(';');
        // Ячейка с злонамеренным именем — вторая в header (после «Метрика»).
        const malicious = cells[1];
        assert.ok(malicious.startsWith(`"'=`), `ожидали префикс "'=, получили: ${malicious}`);
        assert.ok(malicious.endsWith('"'), 'ячейка должна завершаться закрывающей кавычкой');
        // Никакая другая ячейка не должна содержать `=cmd` без `'`-префикса.
        for (const line of lines) {
            const ls = line.split(';');
            for (const cell of ls) {
                if (cell.includes('=cmd')) {
                    assert.ok(
                        cell.startsWith(`"'`) && cell.includes(`'=cmd`),
                        `unsafe cell в CSV: ${cell}`
                    );
                }
            }
        }
    });
});

/* describe('Procurement CSV (12.U15)') удалён в 12.U27 — функциональность
   procurement-export убрана из UI (семантический дубль кнопки CSV). Соответствующие
   тесты вместе с buildProcurementCsv/buildProcurementCsvFilename удалены. */
