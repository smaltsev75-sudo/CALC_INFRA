/**
 * CRUD-операции над элементами конфигурации.
 * Изменения применяются к локальному справочнику активного расчёта;
 * глобальный справочник синхронизируется параллельно (для будущих расчётов).
 */

import { store } from '../state/store.js';
import * as persist from '../state/persistence.js';
import { uuid } from '../utils/uuid.js';
import { validateItem } from '../domain/validation.js';
import { downloadJson } from '../services/json.js';
import { dateForFilename } from '../services/format.js';
import { importJsonCollection } from '../services/jsonImport.js';
import { commitActiveCalc } from '../services/calcPersistence.js';
import { STAND_IDS, CATEGORY_IDS } from '../utils/constants.js';
import { upsertById, mergeById, removeById } from '../utils/collections.js';

/* ---------- Новый ЭК с дефолтами ---------- */

export function makeNewItem() {
    return {
        id: uuid(),
        name: '',
        unit: 'шт.',
        pricePerUnit: 0,
        category: 'HW',
        resourceClass: 'SERVICE',
        billingInterval: 'monthly',
        vendor: '',
        description: '',
        applicableStands: [...STAND_IDS],
        qtyFormulas: Object.fromEntries(STAND_IDS.map(s => [s, ''])),
        formulaHelp: ''
    };
}

/* ---------- Создание / обновление ---------- */

export function saveItem(item) {
    const errors = [];
    validateItem(item, errors);
    if (errors.length) return { ok: false, errors };

    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, errors: [{ message: 'Нет активного расчёта' }] };

    // Если цена изменилась относительно предыдущей версии — фиксируем источник = manual.
    // Если ЭК новый и цена > 0 — тоже manual (создан пользователем вручную).
    // Если только название/описание поменяли — метку не трогаем.
    const prev = calc.dictionaries.items.find(x => x.id === item.id);
    const oldPrice = Number(prev?.pricePerUnit) || 0;
    const newPrice = Number(item.pricePerUnit) || 0;
    const priceChanged = !prev
        ? (newPrice > 0)
        : Math.abs(oldPrice - newPrice) > 1e-9;
    const itemToSave = priceChanged
        ? { ...item, priceUpdatedAt: new Date().toISOString(), priceSource: 'manual' }
        : item;

    const items = upsertById(calc.dictionaries.items, itemToSave);
    const dictionaries = { ...calc.dictionaries, items };
    store.updateActiveCalc({ dictionaries });
    /* Внешний аудит #4 (2026-05-18, P1-2): раньше commitActiveCalc возврат
     * игнорировался + saveItem всегда возвращал {ok:true} → модалка
     * закрывалась как при успехе, при quota правка в storage не сохранялась,
     * после F5 терялась. Persist-banner недостаточен — пользователь его
     * мог не заметить, а закрытая форма с потерянной правкой = data loss. */
    if (!commitActiveCalc(store.getState().activeCalc)) {
        return { ok: false, errors: [{ message:
            'Не удалось сохранить элемент: превышен лимит хранилища (quota?). ' +
            'Освободите место (экспорт JSON + удаление старых расчётов) и повторите.' }] };
    }

    syncDefaultDictionary({ items: upsertById(currentDefaultItems(), itemToSave) });
    return { ok: true };
}

export function deleteItem(itemId) {
    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, reason: 'noActiveCalc' };
    /* Внешний аудит #6 (2026-05-18, P2-1): inverse pattern — попробовать
     * persist ПЕРВЫМ, только при ok мутировать store. Раньше: store сначала
     * обновлялся, потом commit; при quota пользователь получал {ok:false},
     * но элемент уже исчез в UI до F5. Теперь при persist-fail UI остаётся
     * нетронутым. Аудит #5 P2 закрыл «UNDO лжёт», но не сам порядок. */
    const items = removeById(calc.dictionaries.items, itemId);
    const newCalc = { ...calc, dictionaries: { ...calc.dictionaries, items } };
    if (!commitActiveCalc(newCalc)) {
        return { ok: false, reason: 'persist',
            message: 'Не удалось удалить элемент: превышен лимит хранилища (quota?). ' +
                     'Освободите место и повторите.' };
    }
    store.setActiveCalc(newCalc);
    syncDefaultDictionary({ items: removeById(currentDefaultItems(), itemId) });
    return { ok: true };
}

/**
 * Дублирует ЭК. Возвращает новый id.
 */
export function duplicateItem(itemId) {
    const calc = store.getState().activeCalc;
    if (!calc) return null;
    const src = calc.dictionaries.items.find(x => x.id === itemId);
    if (!src) return null;
    const copy = JSON.parse(JSON.stringify(src));
    copy.id = uuid();
    copy.name = `${src.name} (копия)`;
    saveItem(copy);
    return copy.id;
}

/* ---------- Импорт/экспорт справочника ЭК ---------- */

export function exportItems() {
    const calc = store.getState().activeCalc;
    const items = calc?.dictionaries?.items
        ?? store.getState().defaultDictionary?.items
        ?? [];
    downloadJson(`items-${dateForFilename()}.json`, { items });
}

export async function importItems({ replace = false } = {}) {
    return importJsonCollection({
        pluralKey: 'items',
        validator: validateItem,
        onAccepted: (accepted) => {
            const calc = store.getState().activeCalc;
            if (calc) {
                const baseItems = replace ? [] : [...calc.dictionaries.items];
                const merged = mergeById(baseItems, accepted);
                store.updateActiveCalc({ dictionaries: { ...calc.dictionaries, items: merged } });
                /* Внешний аудит #5 (2026-05-18, P2): commit-fail
                 * пробрасываем как persist-reason — UI покажет error-snackbar
                 * вместо лживого «Импортировано N». */
                if (!commitActiveCalc(store.getState().activeCalc)) {
                    return { ok: false, reason: 'persist',
                        message: 'Импорт не сохранён в хранилище (quota?).' };
                }
            }
            const defBase = replace ? [] : currentDefaultItems();
            syncDefaultDictionary({ items: mergeById(defBase, accepted) });
            return { ok: true };
        }
    });
}

/* ---------- CSV-импорт/экспорт ЦЕН (только pricePerUnit) ---------- */

/**
 * Экспортировать прайс ЭК активного расчёта в CSV-файл.
 * Если активного расчёта нет — берёт глобальный справочник.
 */
export function exportItemPrices() {
    const calc = store.getState().activeCalc;
    const items = calc?.dictionaries?.items
        ?? store.getState().defaultDictionary?.items
        ?? [];
    if (items.length === 0) return { ok: false, reason: 'empty' };
    return import('../services/csvExport.js').then(csvMod => {
        const content = csvMod.buildPricesCsv(items);
        csvMod.downloadCsv(csvMod.buildPricesCsvFilename(), content);
        return { ok: true, count: items.length };
    });
}

/**
 * Загрузить CSV с ценами и применить обновления к активному расчёту.
 * Меняет ТОЛЬКО pricePerUnit; структура, формулы, applicableStands не трогаются.
 *
 * После Этапа 11.2.1 «безопасные» обновления (изменение цены меньше чем в 10×)
 * применяются сразу. «Аномальные» (рост/падение ≥ 10×) — только после явного
 * подтверждения пользователем через `confirmAnomalies(anomalies) → Promise<boolean>`.
 * Если confirm-функция не передана или вернула false — аномалии не применяются.
 *
 * @param {Object} [opts]
 * @param {(anomalies: Array) => Promise<boolean>} [opts.confirmAnomalies]
 *        Колбэк, который должен показать пользователю список аномалий и
 *        вернуть Promise<true> при подтверждении, Promise<false> при отказе.
 *        По умолчанию (нет колбэка) аномалии НЕ применяются.
 *
 * Возвращает {
 *   ok, updatesCount, anomaliesApplied, unchanged, rejected,
 *   anomalies, costTypeChanges, costTypeRejected, fileName
 * } или { ok:false, reason, message }.
 */
export async function importItemPrices(opts = {}) {
    const csvImport = await import('../services/csvImport.js');
    const result = await csvImport.pickAndParsePricesCsv();
    if (!result.ok) return result;

    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, reason: 'noActiveCalc', message: 'Сначала откройте расчёт' };

    const diff = csvImport.diffPricesFromCsv(result.rows, calc.dictionaries.items);
    const safeUpdates = diff.safeUpdates || [];
    const anomalies = diff.anomalies || [];

    // Применяем безопасные обновления сразу.
    // Внешний аудит #5 (2026-05-18, P2): applyPriceUpdates теперь возвращает
    // {ok, reason} — при quota обновления в store применены, но persist
    // провален → возвращаем {ok:false} до начала аномалий, чтобы UI показал
    // правильный summary (что НЕ сохранено).
    let persistFail = null;
    if (safeUpdates.length > 0) {
        const r = applyPriceUpdates(safeUpdates);
        if (r && r.ok === false) persistFail = r;
    }

    // Аномалии — только после явного подтверждения пользователем.
    let anomaliesApplied = 0;
    if (anomalies.length > 0 && typeof opts.confirmAnomalies === 'function') {
        const approved = await opts.confirmAnomalies(anomalies);
        if (approved === true) {
            const r = applyPriceUpdates(anomalies);
            if (r && r.ok === false) persistFail = persistFail || r;
            anomaliesApplied = anomalies.length;
        }
    }

    if (persistFail) {
        return {
            ok: false,
            reason: 'persist',
            message: persistFail.message
                || 'Цены применены в текущей сессии, но не сохранены в хранилище (quota?). После перезагрузки страницы изменения исчезнут.',
            updatesCount: safeUpdates.length + anomaliesApplied,
            safeUpdatesCount: safeUpdates.length,
            anomaliesApplied,
            unchanged: diff.unchanged,
            rejected: diff.rejected,
            anomalies,
            costTypeChanges: diff.costTypeChanges || 0,
            costTypeRejected: diff.costTypeRejected || [],
            safeUpdates,
            fileName: result.fileName
        };
    }

    return {
        ok: true,
        updatesCount: safeUpdates.length + anomaliesApplied,
        safeUpdatesCount: safeUpdates.length,
        anomaliesApplied,
        unchanged: diff.unchanged,
        rejected: diff.rejected,
        anomalies,
        costTypeChanges: diff.costTypeChanges || 0,
        costTypeRejected: diff.costTypeRejected || [],
        safeUpdates,
        fileName: result.fileName
    };
}

/**
 * Применить набор обновлений (safeUpdates ИЛИ anomalies — структура одинакова) к
 * активному расчёту и синхронизировать default-словарь. Каждый update должен
 * содержать { id, newPrice, newCostType? }.
 *
 * Внутренняя функция; не экспортируется наружу.
 */
function applyPriceUpdates(updates) {
    if (!Array.isArray(updates) || updates.length === 0) return { ok: true };
    const calc = store.getState().activeCalc;
    if (!calc) return { ok: false, reason: 'noActiveCalc' };

    const now = new Date().toISOString();
    const byId = new Map(updates.map(u => [u.id, u]));
    const stamp = it => {
        const u = byId.get(it.id);
        const next = {
            ...it,
            pricePerUnit: u.newPrice,
            priceUpdatedAt: now,
            priceSource: 'csv'
        };
        if (u.newCostType === 'capex' || u.newCostType === 'opex') {
            next.costType = u.newCostType;
        }
        return next;
    };
    const newItems = calc.dictionaries.items.map(it => byId.has(it.id) ? stamp(it) : it);

    store.updateActiveCalc({ dictionaries: { ...calc.dictionaries, items: newItems } });
    /* Внешний аудит #5 (2026-05-18, P2): commit-fail возвращается caller'у. */
    const persisted = commitActiveCalc(store.getState().activeCalc);

    // Синхронизируем default-словарь — чтобы новые расчёты видели обновлённые цены.
    const defItems = currentDefaultItems();
    const defNew = defItems.map(it => byId.has(it.id) ? stamp(it) : it);
    syncDefaultDictionary({ items: defNew });

    if (!persisted) {
        return { ok: false, reason: 'persist',
            message: 'Цены применены в текущей сессии, но не сохранены (quota?).' };
    }
    return { ok: true };
}

/* ---------- Открыть форму ---------- */

export function openItemEditor(itemOrNull) {
    const draft = itemOrNull ?? makeNewItem();
    store.openModal('itemEdit', { draft, errors: [], activeSubTab: 'main' });
}
export function closeItemEditor() {
    store.closeModal('itemEdit');
}

/* ---------- Утилиты ---------- */

export const KNOWN_CATEGORIES = CATEGORY_IDS;

function currentDefaultItems() {
    const def = persist.loadDefaultDictionary() || { items: [], questions: [] };
    return [...(def.items || [])];
}

function syncDefaultDictionary({ items, questions }) {
    const def = persist.loadDefaultDictionary() || { items: [], questions: [] };
    const next = {
        ...def,
        ...(items !== undefined ? { items } : {}),
        ...(questions !== undefined ? { questions } : {})
    };
    /* Внешний аудит #2 (2026-05-18, P3-1): раньше saveDefaultDictionary false
     * игнорировался → store обновлялся (UI показывает новую цену), а calc.defaultDictionary
     * в storage оставался старым → F5 = откат изменений без банера. Теперь
     * persistStatus='error' поднимается явно. */
    if (!persist.saveDefaultDictionary(next)) {
        store.setPersistStatus('error', 'Не удалось сохранить справочник ЭК (quota?)');
    }
    store.setDefaultDictionary(next);
}
