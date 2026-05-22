/**
 * PDF-печать ответов опросника — компактный табличный формат.
 *
 * 12.U30-fix: группировка по КАТЕГОРИЯМ (секциям опросника), как в самом
 * опроснике (Бизнес и пользователи / Профиль нагрузки / Данные и хранение
 * / SLA / Безопасность / ...). Прежде была группировка по типу вопроса
 * (boolean/number/...) — пользователь не понимал, в каком разделе вопрос.
 *
 * Подход: создаём отдельную DOM-секцию с print-friendly разметкой,
 * включаем body-класс `printing-answers` (CSS прячет всё кроме этой
 * секции), вызываем window.print(). После закрытия диалога печати —
 * убираем класс и удаляем секцию из DOM.
 *
 * Не зависит от store — принимает calc целиком.
 */

import { el } from './dom.js';
import { formatDateTime, formatNumber, percent } from '../services/format.js';
import { activeScenarioLabelText } from './scenarioBadge.js';
import {
    SECTION_IDS, SECTION_LABELS, PRINT_TRIGGER_DELAY_MS,
    SETTINGS_DESCRIPTIONS
} from '../utils/constants.js';

const PRINT_AREA_ID = 'print-answers-area';
const PRINT_BODY_CLASS = 'printing-answers';

/**
 * Открыть диалог печати ответов опросника. Безопасно вызывать когда
 * activeCalc отсутствует — функция просто ничего не сделает.
 *
 * @param {object} calc — активный расчёт
 * @param {object} [opts]
 *   - `extended: boolean` (default false) — если true, в таблице добавляется
 *     третья колонка с пояснениями (description/recommendation/impact).
 *   - `landscape: boolean` (default true) — ориентация страницы. Если false,
 *     добавляется body-класс `printing-answers-portrait`, который переключает
 *     именованный @page на portrait в css/print.css.
 */
export function printAnswers(calc, opts = {}) {
    if (!calc) return;
    cleanup(); // на случай предыдущего незакрытого print-режима
    const extended = !!opts.extended;
    const landscape = opts.landscape !== false; // default true
    const area = buildPrintArea(calc, { extended });
    // Этап 13.U3/U4: переключаем body-классы. CSS использует их для:
    //   - extended → трёхколоночная раскладка таблицы;
    //   - portrait → именованный @page в книжной ориентации.
    document.body.appendChild(area);
    document.body.classList.add(PRINT_BODY_CLASS);
    if (extended) document.body.classList.add(PRINT_BODY_CLASS + '-extended');
    if (!landscape) document.body.classList.add(PRINT_BODY_CLASS + '-portrait');

    const restore = () => {
        cleanup();
        window.removeEventListener('afterprint', restore);
    };
    window.addEventListener('afterprint', restore);

    setTimeout(() => window.print(), PRINT_TRIGGER_DELAY_MS);
}

function cleanup() {
    document.body.classList.remove(PRINT_BODY_CLASS);
    document.body.classList.remove(PRINT_BODY_CLASS + '-extended');
    document.body.classList.remove(PRINT_BODY_CLASS + '-portrait');
    const existing = document.getElementById(PRINT_AREA_ID);
    if (existing) existing.remove();
}

/**
 * Собрать DOM-секцию для печати. Все вопросы сводятся в одну таблицу,
 * сгруппированную по СЕКЦИЯМ опросника. В extended-режиме добавляется третья
 * колонка «Пояснение» с description + recommendation + impact из seed.
 */
function buildPrintArea(calc, { extended = false } = {}) {
    const root = el('section', { attrs: { id: PRINT_AREA_ID, role: 'document' } });
    if (extended) root.classList.add('pa-extended');

    // Шапка
    const scenarioLabel = activeScenarioLabelText(calc);
    root.appendChild(el('header', { class: 'pa-header' },
        el('h1', { class: 'pa-title', text: 'Анкета бизнес-заказчика' }),
        el('div', { class: 'pa-meta' },
            el('div', null, el('strong', { text: 'Расчёт: ' }), el('span', { text: calc.name || '—' })),
            scenarioLabel
                ? el('div', null, el('strong', { text: 'Сценарий: ' }), el('span', { text: scenarioLabel }))
                : null,
            el('div', null, el('strong', { text: 'Дата печати: ' }), el('span', { text: formatDateTime(new Date()) })),
            calc.updatedAt && el('div', null, el('strong', { text: 'Обновлён: ' }), el('span', { text: formatDateTime(calc.updatedAt) }))
        )
    ));

    // 12.U30-fix: группируем по СЕКЦИЯМ опросника (= категориям UI:
    // «Бизнес и пользователи», «Профиль нагрузки» и т.д.). Внутри секции —
    // вопросы в порядке `q.order`.
    const questions = calc.dictionaries?.questions || [];
    const answers = calc.answers || {};
    const bySection = new Map();
    for (const q of questions) {
        const sec = q.section || 'other';
        if (!bySection.has(sec)) bySection.set(sec, []);
        bySection.get(sec).push(q);
    }
    for (const list of bySection.values()) {
        list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }

    // Таблица — один <table> на весь документ, заголовки СЕКЦИЙ через <tbody>.
    const table = el('table', { class: ['pa-table', extended && 'pa-table-extended'] });
    table.appendChild(el('thead', null,
        el('tr', null,
            el('th', { class: 'pa-th-q', text: 'Вопрос' }),
            el('th', { class: 'pa-th-a', text: 'Ответ' }),
            extended && el('th', { class: 'pa-th-x', text: 'Пояснение' })
        )
    ));

    // Порядок секций — фиксированный SECTION_IDS, потом «прочее» если есть.
    const orderedSecs = SECTION_IDS.filter(s => bySection.has(s));
    for (const sec of bySection.keys()) {
        if (!orderedSecs.includes(sec)) orderedSecs.push(sec);
    }

    for (const sec of orderedSecs) {
        const list = bySection.get(sec);
        if (!list || list.length === 0) continue;
        const label = SECTION_LABELS[sec] || sec;
        const tbody = el('tbody', { class: 'pa-tbody' });
        tbody.appendChild(el('tr', { class: 'pa-group-row' },
            el('td', { attrs: { colspan: extended ? 3 : 2 }, class: 'pa-group-label', text: label })
        ));
        for (const q of list) {
            const formatted = formatAnswer(q, answers[q.id]);
            const row = el('tr', { class: 'pa-row' },
                el('td', { class: 'pa-q-cell', text: q.title || q.id }),
                el('td', { class: 'pa-a-cell', text: formatted })
            );
            if (extended) {
                row.appendChild(el('td', { class: 'pa-x-cell', text: composeExplanation(q) }));
            }
            tbody.appendChild(row);
        }
        table.appendChild(tbody);
    }

    root.appendChild(table);

    // Параметры расчёта — в виде второй компактной таблицы.
    // Этап 13.U5: в extended-режиме добавляется третья колонка «Пояснение»
    // с описаниями из SETTINGS_DESCRIPTIONS (центральный источник для UI и PDF).
    root.appendChild(renderSettingsTable(calc.settings || {}, { extended }));

    // Подвал
    root.appendChild(el('footer', { class: 'pa-footer' },
        el('span', { text: '— документ сгенерирован Калькулятором инфраструктуры —' })
    ));

    return root;
}

function formatAnswer(q, answer) {
    if (answer === null || answer === undefined || answer === '') return '— не задано —';
    switch (q.type) {
        case 'boolean':
            return answer === true || answer === 'true' ? 'Да' : 'Нет';
        case 'number':
            return typeof answer === 'number' ? formatNumber(answer) : String(answer);
        case 'select': {
            const opt = (q.options || []).find(o => String(o.value) === String(answer));
            return opt ? opt.label : String(answer);
        }
        case 'multiselect': {
            if (!Array.isArray(answer)) return String(answer);
            if (answer.length === 0) return '—';
            return answer.map(v => {
                const opt = (q.options || []).find(o => String(o.value) === String(v));
                return opt ? opt.label : String(v);
            }).join(', ');
        }
        default:
            return String(answer);
    }
}

function renderSettingsTable(settings, { extended = false } = {}) {
    // Каждая запись: [label, value, settingsDescriptionsKey].
    // Ключ ссылается на SETTINGS_DESCRIPTIONS — единый источник пояснений.
    // Для НДС используем ключ vatEnabled (мастер-переключатель — там же ставка).
    const items = [
        ['Длительность фазы (мес)',     settings.phaseDurationMonths ?? 12, 'phaseDurationMonths'],
        ['Дней в месяце',               settings.daysPerMonth ?? 30,        'daysPerMonth'],
        ['Горизонт планирования (лет)', settings.planningHorizonYears ?? 1, 'planningHorizonYears'],
        ['Задачный буфер',              fmtPct(settings.bufferTask),        'bufferTask'],
        ['Проектный буфер',             fmtPct(settings.bufferProject),     'bufferProject'],
        ['Инфляция (год)',              fmtPct(settings.kInflation),        'kInflation'],
        ['Сезонный коэф.',              fmtPct(settings.kSeasonal),         'kSeasonal'],
        ['Сдвиг расписания',            fmtPct(settings.kScheduleShift),    'kScheduleShift'],
        ['Резерв на риски',             fmtPct(settings.kContingency),      'kContingency'],
        ['НДС', settings.vatEnabled ? fmtPct(settings.vatRate) : 'выключен', 'vatEnabled'],
    ];
    const ratios = settings.standSizeRatio || {};
    const ratiosText = Object.entries(ratios)
        .map(([k, v]) => `${k}: ${percent(v)}`)
        .join(', ');
    items.push(['Размеры стендов (% от ПРОМ)', ratiosText || '—', 'standSizeRatio']);

    const colCount = extended ? 3 : 2;
    const table = el('table', { class: 'pa-table pa-settings-table' });
    table.appendChild(el('thead', null,
        el('tr', null,
            el('th', { attrs: { colspan: colCount }, class: 'pa-settings-title', text: 'Параметры расчёта' })
        )
    ));
    const tbody = el('tbody');
    for (const [label, value, descKey] of items) {
        const row = el('tr', { class: 'pa-row' },
            el('td', { class: 'pa-q-cell', text: label }),
            el('td', { class: 'pa-a-cell', text: String(value) })
        );
        if (extended) {
            row.appendChild(el('td', { class: 'pa-x-cell', text: SETTINGS_DESCRIPTIONS[descKey] || '—' }));
        }
        tbody.appendChild(row);
    }
    table.appendChild(tbody);
    return table;
}

function fmtPct(v) {
    if (v === undefined || v === null || Number.isNaN(Number(v))) return '—';
    return percent(Number(v));
}

/**
 * Этап 13.U3: текст для третьей колонки в extended-режиме.
 * Собирается из доступных полей вопроса:
 *   - description — что вообще означает поле и edge-cases;
 *   - recommendation — как выбрать значение по типам бизнеса/задачи;
 *   - impact — на что влияет в расчёте.
 * Между секциями — пустая строка для читаемости. Если все поля пусты —
 * возвращается «—» (не оставляем колонку с пустыми ячейками).
 */
function composeExplanation(q) {
    const parts = [];
    if (q.description)    parts.push(String(q.description).trim());
    if (q.recommendation) parts.push('Рекомендация: ' + String(q.recommendation).trim());
    if (q.impact)         parts.push('Влияние: ' + String(q.impact).trim());
    if (parts.length === 0) return '—';
    return parts.join('\n\n');
}
