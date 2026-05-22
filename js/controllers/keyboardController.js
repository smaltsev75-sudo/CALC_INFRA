/**
 * Глобальный обработчик горячих клавиш.
 * Сопоставляет события клавиатуры с действиями приложения.
 */

import { HOTKEYS, TAB_IDS } from '../utils/constants.js';
import { store } from '../state/store.js';
import { loadPdfHintShown, markPdfHintShown } from '../services/storage.js';
import { printWithDetailsMode } from '../utils/printMode.js';
import * as calcList from './calcListController.js';
import * as itemCtl from './itemController.js';
import * as questionCtl from './questionController.js';

/**
 * Парсинг строки горячей клавиши в флаги.
 * Пример: 'Ctrl+Alt+N' → { ctrl, alt, key: 'N' }, 'F1' → { key: 'F1' }, 'Escape' → { key: 'Escape' }
 */
function parseKey(spec) {
    const parts = spec.split('+').map(p => p.trim());
    const out = { ctrl: false, alt: false, shift: false, meta: false, key: null };
    for (const p of parts) {
        const lower = p.toLowerCase();
        if (lower === 'ctrl') out.ctrl = true;
        else if (lower === 'alt') out.alt = true;
        else if (lower === 'shift') out.shift = true;
        else if (lower === 'meta' || lower === 'cmd') out.meta = true;
        else out.key = p;
    }
    return out;
}

const _parsed = HOTKEYS.map(h => ({ ...h, parsed: parseKey(h.keys) }));

function isInputElement(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
}

function eventMatches(e, parsed) {
    // На macOS Cmd/Ctrl эквивалентны для нашей схемы.
    const ctrlOrMeta = e.ctrlKey || e.metaKey;
    const wantCtrl = parsed.ctrl || parsed.meta;
    if (wantCtrl !== ctrlOrMeta) return false;
    if (parsed.alt !== e.altKey) return false;
    if (parsed.shift !== e.shiftKey) return false;
    if (parsed.key.length === 1 && /^[A-Za-z]$/.test(parsed.key)) {
        // Для буквенных хоткеев используем e.code — независит от раскладки клавиатуры
        // (`KeyN` для физической клавиши N независимо от того, RU или EN раскладка).
        return e.code === `Key${parsed.key.toUpperCase()}`;
    }
    if (parsed.key.length === 1 && /^[0-9]$/.test(parsed.key)) {
        return e.code === `Digit${parsed.key}`;
    }
    return e.key === parsed.key;
}

/**
 * Реакции на действия. Можно расширять при росте сценариев.
 */
function dispatch(actionId) {
    switch (actionId) {
        case 'quickStart': {
            // Stage 4.9/4.14 → Stage 17.2: Ctrl+Alt+N → Quick Start. Прежняя modal
            // newCalc удалена, пустой расчёт создаётся через ctx.createCalc(name, null).
            // Хоткей сохранён («N» = New) для muscle memory.
            store.openModal('quickStart');
            break;
        }
        case 'saveJson': {
            const ok = calcList.exportActiveCalc();
            if (!ok) showInfo('Нет активного расчёта для экспорта');
            break;
        }
        case 'openJson': {
            calcList.importCalcFromFile().then(res => {
                if (res?.ok) store.setActiveTab('questionnaire');
                else if (res?.reason && res.reason !== 'cancelled') {
                    showInfo('Ошибка импорта: ' + (res.message || res.reason));
                }
            });
            break;
        }
        case 'focusSearch': {
            const input = document.querySelector('[data-role="search-input"]');
            if (input) input.focus();
            break;
        }
        case 'print': {
            // Подсказка для первого использования (см. app.ctx.printPdf).
            // 12.U31 (E.4): через storage helpers (graceful fallback).
            if (!loadPdfHintShown()) {
                // Устанавливаем флаг до открытия диалога — снэкбар на этом пути не выведем,
                // т.к. модальный диалог печати его перекроет. Достаточно одного срабатывания.
                markPdfHintShown();
            }
            if (store.getState().activeTab === 'details') {
                printWithDetailsMode(() => window.print());
            } else {
                window.print();
            }
            break;
        }
        case 'help': {
            store.openModal('help');
            break;
        }
        case 'closeModal': {
            const state = store.getState();
            // Закрываем верхнюю открытую модалку. Список модалок берём ДИНАМИЧЕСКИ
            // из Object.keys(state.modals) — раньше был hardcoded whitelist из 8 имён,
            // и каждая новая модалка (quickStart, costOptimizationPlanner,
            // vatPolicyChoice, calculationHealth и т.д.) тихо «забывалась» и не
            // закрывалась по Esc.
            //
            // SECONDARY_FIRST — это модалки, которые могут открываться ПОВЕРХ
            // основной (подтверждение, сообщение, ввод, выбор политики). Esc должен
            // закрывать сначала их, потом основную.
            const SECONDARY_FIRST = ['confirm', 'message', 'input', 'reset',
                                     'duplicateImport', 'reapplyConfirm', 'vatPolicyChoice'];
            const allModalNames = Object.keys(state.modals);
            const ordered = [
                ...SECONDARY_FIRST.filter(n => allModalNames.includes(n)),
                ...allModalNames.filter(n => !SECONDARY_FIRST.includes(n))
            ];
            for (const name of ordered) {
                if (state.modals[name]?.open) { store.closeModal(name); return; }
            }
            break;
        }
        case 'deleteEntity': {
            // Реализуется отдельно во вкладках, через выделение.
            break;
        }
        case 'exportCsv': {
            // Триггерим экспорт CSV если есть активный расчёт.
            const state = store.getState();
            if (!state.activeCalc) { showInfo('Создайте расчёт для экспорта'); return; }
            Promise.all([
                import('../domain/calculator.js'),
                import('../services/csvExport.js')
            ]).then(([{ calculate }, csvMod]) => {
                const result = calculate(state.activeCalc, state.calcRevision);
                const content = csvMod.buildDetailsCsv(state.activeCalc, result);
                csvMod.downloadCsv(csvMod.buildCalcCsvFilename(state.activeCalc), content);
            });
            break;
        }
        case 'newItem': {
            if (!store.getState().activeCalc) { showInfo('Создайте расчёт'); return; }
            store.setActiveTab('items');
            itemCtl.openItemEditor(null);
            break;
        }
        case 'newQuestion': {
            if (!store.getState().activeCalc) { showInfo('Создайте расчёт'); return; }
            store.setActiveTab('questions');
            questionCtl.openQuestionEditor(null);
            break;
        }
        // Навигация по вкладкам
        case 'tab1': switchToTab('calculations'); break;
        case 'tab2': switchToTab('questionnaire'); break;
        case 'tab3': switchToTab('dashboard'); break;
        case 'tab4': switchToTab('details'); break;
        case 'tab5': switchToTab('comparison'); break;
        case 'tab6': switchToTab('items'); break;
        case 'tab7': switchToTab('questions'); break;
    }
}

function switchToTab(id) {
    if (!TAB_IDS.includes(id)) return;
    const state = store.getState();
    const requiresActive = id === 'questionnaire' || id === 'dashboard' ||
                           id === 'details' || id === 'items' || id === 'questions';
    if (!state.activeCalc && requiresActive) {
        showInfo('Создайте или откройте расчёт, чтобы открыть эту вкладку');
        return;
    }
    // Stage 17.2 Phase 3c: «Элементы» / «Вопросы» — admin-tabs, доступны
    // только при включённом режиме «Расширенные настройки» (Sidebar →
    // «Администрирование»). Хоткей блокируется тем же гейтом.
    const isAdminTab = id === 'items' || id === 'questions';
    if (isAdminTab && !state.ui?.advancedModeEnabled) {
        showInfo('Включите «Расширенные настройки» в боковой панели, чтобы открыть эту вкладку');
        return;
    }
    store.setActiveTab(id);
}

function showInfo(message) {
    store.openModal('message', { title: 'Информация', message });
}

export function bindHotkeys(target = window) {
    target.addEventListener('keydown', e => {
        const inputFocused = isInputElement(document.activeElement);
        for (const hk of _parsed) {
            if (!hk.whenInInput && inputFocused) continue;
            if (eventMatches(e, hk.parsed)) {
                e.preventDefault();
                dispatch(hk.id);
                return;
            }
        }
    });
}
