/**
 * 12.U24-fix: бейджи в шапке стенд-карточки на дашборде должны лежать в едином
 * контейнере `.dash-stand-card-badges`, чтобы при flex-wrap они ВСЕГДА переносились
 * на отдельную (нижнюю) строку вместе, а не разъезжались в зависимости от длины
 * названия стенда / subtitle.
 *
 * Без обёртки flex-wrap раскидывает «БЕЗ РИСКОВ» и «С НДС 20%» по разным строкам
 * непредсказуемо: на одних карточках оба под названием, на других — один сверху,
 * другой снизу. UI выглядит сломанным.
 *
 * Контракт:
 *   1. В шапке стенд-карточки есть один контейнер `.dash-stand-card-badges`.
 *   2. Внутри него находятся ОБА бейджа: `.dash-stand-card-badge` (риск)
 *      и `.vat-badge`.
 *   3. CSS правило `.dash-stand-card-badges { flex-basis: 100% }` (или
 *      эквивалент) — гарантирует перенос блока целиком на новую строку.
 *
 * Тест работает на структурных utility-функциях вместо полного рендера через
 * el(), чтобы не тащить весь DOM-mock и calculator. Структуру шапки описываем
 * через grep по renderStandCard.
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
const cssSource = readFileSync(
    join(__dirname, '..', '..', '..', 'css', 'dashboard.css'),
    'utf8'
);

describe('Стенд-карточка: единый контейнер для бейджей (12.U24-fix)', () => {
    it('renderStandCard содержит обёртку класса `dash-stand-card-badges`', () => {
        // Ищем литерал класса в JS-исходнике (имя класса не должно меняться без причины).
        assert.match(dashboardSource, /['"]dash-stand-card-badges['"]/,
            'В renderStandCard должен быть контейнер .dash-stand-card-badges, ' +
            'оборачивающий риск-бейдж + VAT-бейдж — иначе flex-wrap раскидывает их ' +
            'по разным строкам непредсказуемо');
    });

    it('CSS правило для .dash-stand-card-badges существует и display: flex (для gap между бейджами)', () => {
        /* 12.U24-fix-3: `flex-basis: 100%` больше НЕ требуется — родитель header
         * стал `flex-direction: column`, бейджи и так на отдельной строке. Здесь
         * проверяем только базовое требование: контейнер должен быть flex для
         * горизонтальной раскладки бейджей с gap между ними. */
        const m = cssSource.match(/\.dash-stand-card-badges\s*\{([^}]+)\}/);
        assert.ok(m, '.dash-stand-card-badges должен быть определён в css/dashboard.css');
        const body = m[1];
        assert.match(body, /display\s*:\s*flex/,
            '.dash-stand-card-badges должен быть display:flex — чтобы оба бейджа ' +
            'стояли в ряд с gap между ними');
    });

    it('VAT-бейдж и риск-бейдж лежат внутри одной обёртки в DOM-структуре', () => {
        // Первое УПОТРЕБЛЕНИЕ обёртки в качестве class-литерала el('div', { class: 'dash-stand-card-badges' })
        // — пропускаем упоминания в комментариях, ищем именно строковый литерал.
        const m = dashboardSource.match(/['"]dash-stand-card-badges['"]/);
        assert.ok(m, 'обёртка .dash-stand-card-badges должна быть class-литералом в коде');
        const badgesIdx = m.index;
        // Достаточно широкое окно, чтобы вместить оба el('span', ...) внутри обёртки.
        const window = dashboardSource.slice(badgesIdx, badgesIdx + 2500);
        assert.match(window, /dash-stand-card-badge\s+dash-resources-badge/,
            'риск-бейдж (с классом dash-stand-card-badge) должен лежать ВНУТРИ контейнера .dash-stand-card-badges');
        assert.match(window, /renderVatBadge\s*\(/,
            'VAT-бейдж (renderVatBadge) должен лежать ВНУТРИ контейнера .dash-stand-card-badges');
    });

    /* ============================================================
     * 12.U24-fix-3: явная 2-строчная структура header'а.
     *
     * Предыдущий фикс полагался только на flex-wrap у `.dash-stand-card-header`
     * + `flex-basis: 100%` у `.dash-stand-card-badges`. Это работало для коротких
     * subtitle, но на длинных (например, ИФТ — «Интеграционно-функциональное
     * тестирование») arrow-кнопка переносилась на отдельную строку → header
     * становился 3-х строчным → numbers опускались ниже, чем у соседних карточек,
     * а бейджи визуально оказывались в середине карточки между числами.
     *
     * Правильное решение: explicit 2-row структура DOM.
     *   header
     *   ├── header-top (icon + title + arrow в одной строке)
     *   └── badges-row (бейджи на отдельной строке)
     * ============================================================ */

    it('header содержит explicit-обёртку для верхней строки (.dash-stand-card-header-top)', () => {
        assert.match(dashboardSource, /['"]dash-stand-card-header-top['"]/,
            'Header должен иметь явную обёртку .dash-stand-card-header-top для верхней строки ' +
            '(title + arrow). Без неё flex-wrap на header переносит arrow на отдельную строку ' +
            'при длинном subtitle (ИФТ-баг)');
    });

    it('arrow-кнопка лежит ВНУТРИ .dash-stand-card-header-top, не как сиблинг бейджей', () => {
        // Найти открытие header-top и проверить, что в нём есть и title-wrap, и arrow.
        const topIdx = dashboardSource.indexOf('dash-stand-card-header-top');
        assert.ok(topIdx > 0, 'header-top должен встретиться');
        const window = dashboardSource.slice(topIdx, topIdx + 1500);
        assert.match(window, /dash-stand-card-title-wrap/,
            '.dash-stand-card-title-wrap должен быть ВНУТРИ .dash-stand-card-header-top');
        assert.match(window, /dash-stand-card-link/,
            '.dash-stand-card-link (arrow) должен быть ВНУТРИ .dash-stand-card-header-top — ' +
            'иначе при flex-wrap он отрывается от title и переходит на отдельную строку');
    });

    it('CSS .dash-stand-card-header — flex-direction: column (явная вертикальная стопка)', () => {
        const m = cssSource.match(/\.dash-stand-card-header\s*\{([^}]+)\}/);
        assert.ok(m, '.dash-stand-card-header должен быть определён в css/dashboard.css');
        const body = m[1];
        assert.match(body, /flex-direction\s*:\s*column/,
            '.dash-stand-card-header должен иметь flex-direction: column — две explicit-строки ' +
            'через дочерние элементы (header-top + badges-row), а не magic flex-wrap');
        // Без flex-wrap, поскольку структура уже explicit. Проверяем отсутствие.
        assert.ok(!/flex-wrap/.test(body),
            'flex-wrap НЕ нужен на header — структура explicit через flex-direction: column ' +
            '+ дочерние ряды. Иначе любой контент-overflow создаёт нестабильный layout.');
    });

    it('CSS .dash-stand-card-header-top — flex-row, чтобы title+arrow стояли горизонтально', () => {
        const m = cssSource.match(/\.dash-stand-card-header-top\s*\{([^}]+)\}/);
        assert.ok(m, '.dash-stand-card-header-top должен быть определён в css/dashboard.css');
        const body = m[1];
        assert.match(body, /display\s*:\s*flex/,
            '.dash-stand-card-header-top должен быть display: flex (по умолчанию row)');
    });

    /* ============================================================
     * 12.U25-fix-2: сумма НДС в теле стенд-карточки.
     *
     * Hero на дашборде показывает разбивку «НДС: 5 259 313 ₽ /мес» под главной
     * суммой. На стенд-карточках был только бейдж «С НДС 20%» без суммы — то
     * есть пользователь видел СТАТУС НДС, но не видел СКОЛЬКО налога именно
     * на этом стенде. Теперь и стенд-карточки рендерят `renderVatBreakdownLine`
     * под основным числом стенда.
     * ============================================================ */

    it('renderStandCard вызывает renderVatBreakdownLine для суммы НДС в теле карточки', () => {
        // Должно быть как минимум 2 вызова renderVatBreakdownLine в dashboard.js:
        //   1) в renderHero (для итога)
        //   2) в renderStandCard (для стенда)
        const matches = dashboardSource.match(/renderVatBreakdownLine\s*\(/g) || [];
        assert.ok(matches.length >= 2,
            `renderVatBreakdownLine должен вызываться минимум в 2 местах (Hero + StandCard), ` +
            `найдено ${matches.length}`);
    });

    it('renderVatBreakdownLine в стенд-карточке использует total стенда (data.totalMonthly/Daily/Annual)', () => {
        const standCardIdx = dashboardSource.indexOf('function renderStandCard');
        assert.ok(standCardIdx > 0, 'функция renderStandCard должна существовать');
        const nextFnIdx = dashboardSource.indexOf('\nfunction ', standCardIdx + 20);
        const standCardBody = nextFnIdx > 0
            ? dashboardSource.slice(standCardIdx, nextFnIdx)
            : dashboardSource.slice(standCardIdx);
        assert.match(standCardBody, /renderVatBreakdownLine\s*\(/,
            'renderStandCard должен вызывать renderVatBreakdownLine — иначе сумма НДС ' +
            'на конкретном стенде не показывается, и пользователь видит только бейдж статуса');
    });

    /* ============================================================
     * 12.U25-fix-5: «X% от итого» — бейдж в шапке справа от VAT-бейджа.
     *
     * Раньше «52,5% от итого» жил отдельной строкой в .dash-stand-card-meta
     * под .dash-stand-card-total. Теперь он переезжает в .dash-stand-card-badges
     * как третий пилл (после С РИСКАМИ и С НДС 20%) и показывает только сам
     * процент. Полное описание «доля стоимости стенда в общей стоимости расчёта»
     * — в title-тултипе.
     * ============================================================ */

    it('renderStandCard содержит share-бейдж в .dash-stand-card-badges', () => {
        const standCardIdx = dashboardSource.indexOf('function renderStandCard');
        const nextFnIdx = dashboardSource.indexOf('\nfunction ', standCardIdx + 20);
        const body = nextFnIdx > 0 ? dashboardSource.slice(standCardIdx, nextFnIdx) : dashboardSource.slice(standCardIdx);

        // Должен быть класс share-бейджа.
        assert.match(body, /['"]dash-stand-card-share-badge['"]/,
            'renderStandCard должен содержать бейдж класса .dash-stand-card-share-badge для % от итого');
    });

    it('share-бейдж лежит ВНУТРИ .dash-stand-card-badges (рядом с VAT)', () => {
        const standCardIdx = dashboardSource.indexOf('function renderStandCard');
        const nextFnIdx = dashboardSource.indexOf('\nfunction ', standCardIdx + 20);
        const body = nextFnIdx > 0 ? dashboardSource.slice(standCardIdx, nextFnIdx) : dashboardSource.slice(standCardIdx);

        const badgesIdx = body.indexOf('dash-stand-card-badges');
        const shareIdx = body.indexOf('dash-stand-card-share-badge');
        const numbersIdx = body.indexOf('dash-stand-card-numbers');
        assert.ok(badgesIdx > 0 && shareIdx > 0 && numbersIdx > 0, 'все маркеры должны быть');
        assert.ok(shareIdx > badgesIdx && shareIdx < numbersIdx,
            'share-бейдж должен находиться ВНУТРИ блока badges (между обёрткой и началом numbers-блока)');
    });

    it('старая строка-meta «X% от итого» удалена из .dash-stand-card-numbers', () => {
        const standCardIdx = dashboardSource.indexOf('function renderStandCard');
        const nextFnIdx = dashboardSource.indexOf('\nfunction ', standCardIdx + 20);
        const body = nextFnIdx > 0 ? dashboardSource.slice(standCardIdx, nextFnIdx) : dashboardSource.slice(standCardIdx);

        // Старый класс .dash-stand-card-meta как обёртка для share не должен использоваться:
        // share переехал в badges.
        assert.ok(!/dash-stand-card-meta/.test(body),
            'класс .dash-stand-card-meta больше не используется — share переехал в бейдж');
        assert.ok(!/dash-stand-card-share\b(?!-badge)/.test(body),
            'старый класс .dash-stand-card-share (без -badge) не должен оставаться — заменён на share-badge');
    });

    it('CSS .dash-stand-card-share-badge определён', () => {
        assert.match(cssSource, /\.dash-stand-card-share-badge\s*\{[^}]+\}/,
            'CSS правило для .dash-stand-card-share-badge должно существовать в css/dashboard.css');
    });

    it('renderVatBreakdownLine стоит СРАЗУ после .dash-stand-card-total (а не в конце .dash-stand-card-numbers)', () => {
        /* По UX-запросу: сумма НДС должна быть прямо под главной суммой стенда,
         * до строки «Y тыс. ₽ /год». Иначе сумма НДС болтается в самом низу и
         * теряет связь с total. Старая проверка против .dash-stand-card-meta
         * убрана — после 12.U25-fix-5 share переехал в бейдж в шапке, отдельной
         * meta-строки в numbers больше нет. */
        const standCardIdx = dashboardSource.indexOf('function renderStandCard');
        const nextFnIdx = dashboardSource.indexOf('\nfunction ', standCardIdx + 20);
        const body = nextFnIdx > 0 ? dashboardSource.slice(standCardIdx, nextFnIdx) : dashboardSource.slice(standCardIdx);

        const totalIdx = body.indexOf('dash-stand-card-total');
        const altIdx   = body.indexOf('dash-stand-card-alt');
        const vatIdx   = body.indexOf('renderVatBreakdownLine');
        assert.ok(totalIdx > 0 && altIdx > 0 && vatIdx > 0,
            'все маркеры должны присутствовать в renderStandCard');
        assert.ok(vatIdx > totalIdx,
            'renderVatBreakdownLine должен идти ПОСЛЕ .dash-stand-card-total (под главной суммой)');
        assert.ok(vatIdx < altIdx,
            'renderVatBreakdownLine должен идти ДО .dash-stand-card-alt («Y тыс. ₽ /год»)');
    });
});
