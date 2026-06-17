/**
 * Вкладка «Элементы конфигурации» — таблица + кнопки управления.
 *
 * 12.U29: группировка ЭК по категориям + accordion. По умолчанию ВСЕ категории
 * свёрнуты — пользователь явно раскрывает интересующие. Шапка таблицы
 * (`<thead>`) — sticky-top, чтобы при скролле длинной развёрнутой категории
 * пользователь видел названия колонок.
 */

import { el } from './dom.js';
import { icon } from './icons.js';
import { CATEGORY_IDS, CATEGORY_LABELS, CATEGORY_COLORS, BILLING_INTERVAL_LABELS, STAND_LABELS } from '../utils/constants.js';
import { money, formatDate, formatDateTime } from '../services/format.js';

/* Кол-во колонок в items-table — синхронно с <thead> ниже. Используется в
   colspan'е category-row. 12.U30-fix: было 9 (с колонкой «Категория»), убрана
   как дубль cat-row → 8 колонок. */
const ITEMS_TABLE_COLSPAN = 8;

/**
 * Категория свёрнута, если она:
 *   - присутствует в state.ui.itemsCollapsedCats (массив явно записан), ИЛИ
 *   - массива нет (null) — дефолт «всё свёрнуто».
 */
function isCategoryCollapsed(catId, state) {
    const collapsed = state.ui?.itemsCollapsedCats;
    if (collapsed === null || collapsed === undefined) return true;
    return collapsed.includes(catId);
}

export function renderItemsTab(state, ctx) {
    const calc = state.activeCalc;
    if (!calc) return el('div', { class: 'tab-pane' }, el('p', { text: 'Создайте расчёт во вкладке «Расчёты».' }));

    const search = (state.ui.searchByTab?.items || '').toLowerCase();
    const items = [...calc.dictionaries.items];
    items.sort((a, b) => {
        if (a.category !== b.category) return CATEGORY_IDS.indexOf(a.category) - CATEGORY_IDS.indexOf(b.category);
        return a.name.localeCompare(b.name, 'ru');
    });
    const filtered = search
        ? items.filter(it =>
            (it.name || '').toLowerCase().includes(search) ||
            (it.vendor || '').toLowerCase().includes(search) ||
            (it.description || '').toLowerCase().includes(search))
        : items;

    // Группируем по категориям + список присутствующих cat-id (нужен для
    // toggleItemsCategory: при первой инициализации из null UI должен «знать»
    // полный список категорий, чтобы посчитать «всё кроме раскрытой»).
    const byCat = {};
    for (const it of filtered) {
        (byCat[it.category] ||= []).push(it);
    }
    const presentCats = CATEGORY_IDS.filter(c => (byCat[c] || []).length > 0);

    return el('section', { class: 'tab-pane' },
        el('div', { class: 'tab-toolbar' },
            el('h2', { class: 'tab-title', text: 'Элементы конфигурации' }),
            el('div', { class: 'tab-toolbar-actions' },
                el('input', {
                    class: 'input search-input',
                    type: 'text',
                    placeholder: 'Поиск по названию, поставщику, описанию (Ctrl+Alt+F)',
                    value: state.ui.searchByTab?.items || '',
                    title: 'Фильтрация списка элементов. Поиск по названию, поставщику и описанию',
                    attrs: { 'data-role': 'search-input', 'data-focus-key': 'search:items' },
                    onInput: e => ctx.setSearch('items', e.target.value)
                }),
                /* 12.U31 (E.1): visible labels отличаются для импорта/экспорта.
                   Раньше две пары кнопок имели одинаковый текст «JSON» / «Цены CSV»
                   — пользователь рисковал нажать Import вместо Export и перезаписать
                   данные. Принцип #3: семантические дубли = критическая UX-ошибка. */
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Сохранить весь список элементов в JSON-файл (структура + формулы + цены).',
                    onClick: (e) => ctx.exportItems(e)
                },
                    icon('download', { size: 16 }),
                    el('span', { text: 'Экспорт JSON' })
                ),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Загрузить список элементов из JSON-файла. Существующие элементы с тем же ID будут обновлены.',
                    onClick: (e) => ctx.importItems(e)
                },
                    icon('folder-open', { size: 16 }),
                    el('span', { text: 'Импорт JSON' })
                ),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Выгрузить только цены элементов конфигурации в CSV — для правки в Excel и обратной загрузки.',
                    onClick: (e) => ctx.exportItemPrices(e)
                },
                    icon('download', { size: 16 }),
                    el('span', { text: 'Экспорт цен CSV' })
                ),
                el('button', {
                    class: 'btn btn-ghost btn-icon-text',
                    title: 'Загрузить цены из CSV-файла. Цена обновится для тех элементов, у которых идентификатор совпал. Формат файла — как у выгрузки.',
                    onClick: (e) => ctx.importItemPrices(e)
                },
                    icon('folder-open', { size: 16 }),
                    el('span', { text: 'Импорт цен CSV' })
                ),
                el('button', {
                    class: 'btn btn-primary btn-icon-text',
                    title: 'Добавить новый элемент конфигурации (например, сервер, лицензия, услуга) (Ctrl+Alt+I)',
                    onClick: () => ctx.openItemEditor(null)
                },
                    icon('plus', { size: 16 }),
                    el('span', { text: 'Добавить ЭК' })
                )
            )
        ),

        filtered.length === 0
            ? el('div', { class: 'empty-state empty-state-compact' },
                el('div', { class: 'empty-state-icon' }, icon('puzzle', { size: 48 })),
                el('div', { class: 'empty-state-title', text: search ? 'Ничего не найдено' : 'Справочник пуст' }),
                el('div', { class: 'empty-state-subtitle',
                    text: search ? 'Попробуйте изменить поисковый запрос.' : 'Добавьте первый элемент или импортируйте JSON.' }))

            : el('div', { class: 'items-table-wrap' },
                el('table', { class: 'items-table' },
                    /* 12.U30-fix: убрана колонка «Категория» — она дублирует
                       заголовок аккордеона cat-row (которая теперь видна всегда). */
                    el('thead', null, el('tr', null,
                        el('th', { text: 'Название' }),
                        el('th', { text: 'Поставщик' }),
                        el('th', { text: 'Ед.изм.' }),
                        el('th', { text: 'Цена/ед.' }),
                        el('th', { text: 'Источник', title: 'Откуда последний раз обновлена цена и когда' }),
                        el('th', { text: 'Тариф' }),
                        el('th', { text: 'Стенды' }),
                        el('th', { text: 'Действия' })
                    )),
                    el('tbody', null,
                        ...presentCats.flatMap(cat => {
                            const list = byCat[cat] || [];
                            const collapsed = isCategoryCollapsed(cat, state);
                            const rows = [renderItemsCategoryRow(cat, list, collapsed, ctx, presentCats)];
                            if (!collapsed) {
                                for (const it of list) rows.push(renderRow(it, calc, state, ctx));
                            }
                            return rows;
                        })
                    )
                )
            )
    );
}

/**
 * Строка-заголовок категории — clickable аккордеон. По нажатию ctx.toggleItemsCategory
 * переключает наличие cat-id в массиве свёрнутых.
 */
function renderItemsCategoryRow(cat, list, collapsed, ctx, presentCats) {
    const chevron = icon(collapsed ? 'chevron-right' : 'chevron-down', { size: 14 });
    const label = CATEGORY_LABELS[cat] || cat;
    return el('tr', {
        class: ['items-cat-row', !collapsed && 'items-cat-row-expanded'],
        attrs: {
            'aria-expanded': collapsed ? 'false' : 'true',
            'data-category': cat,
            tabindex: '0',
            role: 'button',
            title: collapsed ? `Раскрыть категорию «${label}»` : `Свернуть категорию «${label}»`
        },
        onClick: () => ctx?.toggleItemsCategory?.(cat, presentCats),
        onKeyDown: (e) => {
            if (e.code === 'Enter' || e.code === 'Space') {
                e.preventDefault();
                ctx?.toggleItemsCategory?.(cat, presentCats);
            }
        }
    },
        el('td', { attrs: { colspan: ITEMS_TABLE_COLSPAN } },
            el('span', { class: 'items-cat-chevron' }, chevron),
            el('span', { class: 'items-cat-dot', style: { background: CATEGORY_COLORS[cat] } }),
            el('span', { class: 'items-cat-name', text: label }),
            el('span', { class: 'items-cat-count', text: ` · ${list.length}` })
        )
    );
}

function renderRow(it, calc, state, ctx) {
    const stands = (it.applicableStands || [])
        .map(s => STAND_LABELS[s])
        .filter(Boolean)
        .join(', ');

    return el('tr', { class: 'item-row' },
        el('td', null,
            el('div', { class: 'item-name', text: it.name || '—' }),
            it.description && el('div', { class: 'item-description', text: it.description })
        ),
        el('td', { text: it.vendor || '—' }),
        el('td', { text: it.unit }),
        el('td', { class: 'col-price', text: money(it.pricePerUnit) }),
        el('td', { class: 'col-price-source' }, renderPriceSource(it)),
        el('td', { text: BILLING_INTERVAL_LABELS[it.billingInterval] || it.billingInterval }),
        el('td', { class: 'col-stands', text: stands || '—' }),
        el('td', { class: 'col-actions' },
            el('button', { class: 'btn-icon', title: 'Изменить параметры этого элемента', onClick: () => ctx.openItemEditor(it) }, icon('edit', { size: 16 })),
            el('button', { class: 'btn-icon', title: 'Создать копию с похожими параметрами', onClick: () => ctx.duplicateItem(it.id) }, icon('copy', { size: 16 })),
            el('button', {
                class: 'btn-icon btn-icon-danger',
                title: 'Удалить элемент. После удаления появится возможность отменить в течение нескольких секунд.',
                onClick: () => ctx.confirm({
                    title: 'Удалить элемент',
                    message: `Удалить «${it.name}»? После удаления вы сможете нажать «Отменить» в уведомлении внизу экрана.`,
                    confirmLabel: 'Удалить',
                    onConfirm: () => ctx.deleteItem(it.id)
                })
            }, icon('trash', { size: 16 }))
        )
    );
}

/**
 * Колонка «Источник» для строки ЭК — показывает где/когда последний раз
 * обновлена цена (manual / csv / auto / seed). Обращает внимание на
 * нерасчётные цены через визуальный индикатор.
 */
function renderPriceSource(it) {
    const source = it.priceSource || 'seed';
    const labels = {
        manual: { iconName: 'edit',           text: 'Вручную',     hint: 'Цена изменена вручную через форму редактирования' },
        csv:    { iconName: 'file-spreadsheet', text: 'CSV-импорт',  hint: 'Цена обновлена через массовую загрузку CSV-файла' },
        auto:   { iconName: 'package',        text: 'Авто',         hint: 'Цена получена автоматически (парсинг web-источника)' },
        seed:   { iconName: 'clipboard-list', text: 'Из каталога', hint: 'Исходная цена из seed-каталога; не обновлялась пользователем' }
    };
    const meta = labels[source] || labels.seed;
    const dt = it.priceUpdatedAt ? formatRelativeTime(it.priceUpdatedAt) : '—';
    // Полная дата в title нужна, чтобы при наведении пользователь видел точное
    // время обновления, а не только относительное «3 ч назад».
    const fullTitle = `${meta.hint}\n${it.priceUpdatedAt ? `Обновлено: ${formatDateTime(it.priceUpdatedAt)}` : 'Не обновлялось пользователем'}`;
    return el('div', { class: 'price-source', title: fullTitle },
        el('span', { class: 'price-source-icon' }, icon(meta.iconName, { size: 14 })),
        el('span', { class: 'price-source-text', text: meta.text }),
        it.priceUpdatedAt && el('span', { class: 'price-source-date', text: dt })
    );
}

/** «5 мин назад», «3 ч назад», «5 дн назад», иначе ISO-дата. */
function formatRelativeTime(iso) {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '—';
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return `${sec} сек назад`;
    if (sec < 3600) return `${Math.round(sec / 60)} мин назад`;
    if (sec < 86400) return `${Math.round(sec / 3600)} ч назад`;
    if (sec < 86400 * 30) return `${Math.round(sec / 86400)} дн назад`;
    return formatDate(t);
}
