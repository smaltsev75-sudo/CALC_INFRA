/**
 * Пользователь (2026-05-18): tooltip на кнопке «+ Сценарий» был абстрактным
 * («альтернативные настройки и сравнить разные варианты внутри одного
 * калькулятора»). Пользователь просит конкретный пример, чтобы сразу понять
 * пользу функциональности — что именно он может сделать.
 *
 * Контракт:
 *   - Tooltip содержит слово «Пример» (явный пример сценария).
 *   - Tooltip упоминает несколько контрастных вариантов (хотя бы 2 имени
 *     сценариев в кавычках), чтобы пользователь видел сравнение.
 *   - Tooltip объясняет ЗАЧЕМ (сравнение / стоимость) — не пропадает основная
 *     польза от изменения.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tabsSrc = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'scenarioTabs.js'),
    'utf8'
);

/* Извлекаем title-строку из renderAddButton. Поддерживает многострочный
 * string-concat (`'a' + 'b' + 'c'`) — собирает все литералы до запятой/конца
 * объявления. Простая heuristic: найти `title:` с последующим '...'+'...'-цепочкой
 * до первой запятой/закрывающей скобки/}. */
function getAddButtonTitle() {
    /* Ищем именно tooltip кнопки «+ Сценарий» — она в renderAddButton.
     * Сужаем scope до этой функции, затем находим title:. */
    const fnStart = tabsSrc.indexOf('function renderAddButton');
    if (fnStart === -1) return '';
    const fnSrc = tabsSrc.slice(fnStart, fnStart + 2000);
    const block = fnSrc.match(/title:\s*((?:'[^']*'(?:\s*\+\s*)?)+)/);
    if (!block) return '';
    const literals = [...block[1].matchAll(/'([^']*)'/g)].map(m => m[1]);
    return literals.join('');
}

describe('scenario «+ Сценарий» tooltip: содержит конкретный пример (2026-05-18)', () => {
    const title = getAddButtonTitle();

    it('tooltip упоминает «Пример» — пользователь видит конкретику', () => {
        assert.ok(
            /пример/i.test(title),
            `Tooltip должен содержать слово «Пример». Текущий: «${title}»`
        );
    });

    it('tooltip содержит минимум 2 названия сценариев в кавычках', () => {
        /* «Базовый» / «С GPU» / «Эконом» / «×5 нагрузка» — любые две пары
         * «…». Кавычки могут быть «» (елочки) или " (нем. лапки). */
        const quotedNames = [...title.matchAll(/[«""][^»""]{2,}[»""]/g)];
        assert.ok(
            quotedNames.length >= 2,
            `Tooltip должен показать минимум 2 примера сценариев в кавычках. ` +
            `Найдено: ${quotedNames.length}. Текущий: «${title}»`
        );
    });

    it('tooltip объясняет ЗАЧЕМ — упоминает сравнение или стоимость', () => {
        assert.ok(
            /сравн|стоимост|итог/i.test(title),
            `Tooltip должен объяснять пользу (сравнение вариантов / итоговая стоимость). ` +
            `Текущий: «${title}»`
        );
    });

    it('tooltip объясняет масштаб «внутри одного расчёта» (а не нового калькулятора)', () => {
        assert.ok(
            /внутри|одного расч|в этом расч/i.test(title),
            `Tooltip должен явно сказать, что сценарии — внутри ОДНОГО расчёта ` +
            `(иначе путается с созданием нового расчёта). Текущий: «${title}»`
        );
    });
});
