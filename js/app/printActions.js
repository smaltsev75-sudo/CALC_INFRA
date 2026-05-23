import { loadPdfHintShown, markPdfHintShown } from '../services/storage.js';
import { printWithDetailsMode } from '../utils/printMode.js';

export const SUMMARY_FORMULA_MESSAGE =
    '«Итого по расчёту» — общая стоимость всей инфраструктуры за выбранный период ' +
    '(день / месяц / год). Период переключается кнопками вверху Дашборда.\n\n' +
    'Из чего складывается:\n' +
    '  1. Берутся все элементы конфигурации (vCPU, оперативная память, ' +
    'хранилище, лицензии, трафик, сервисы и т.д.) на всех 5 стендах ' +
    '(DEV, ИФТ, ПСИ, ПРОМ, Нагрузка).\n' +
    '  2. По каждому элементу считается базовая стоимость: ' +
    'количество × цена за единицу × длительность периода.\n' +
    '  3. Базовая стоимость умножается на пять риск-коэффициентов: ' +
    'буферы, инфляция, сезонность, сдвиг расписания, резерв на риски.\n' +
    '  4. Отдельно применяется НДС — это налог, а не риск. Он включается ' +
    'независимым переключателем в Параметрах расчёта и не входит в пилюлю «+X% от базы».\n' +
    '  5. Если включён ai_agent_mode (см. Опросник, раздел AI/LLM), стоимость токенов LLM и ' +
    'количество vCPU sandbox дополнительно умножаются на агентский множитель ×3..×45 ' +
    '(сложность пайплайна × число параллельных специалистов в multi-agent).\n' +
    '  6. Сумма всех получившихся стоимостей и есть «Итого по расчёту».\n\n' +
    'Пилюля «+X% от базы» сверху Hero — это наценка от пяти риск-коэффициентов ' +
    'вместе, без НДС. НДС показан отдельным голубым бейджем рядом.\n\n' +
    'Подробная разбивка:\n' +
    '  • По стендам — 5 карточек снизу.\n' +
    '  • По категориям (Аппаратные ресурсы / Лицензии / Сервисы и т.д.) — ' +
    'центральная карточка «Распределение по категориям ИТОГО».\n' +
    '  • По риск-коэффициентам — карточка справа «Вклад риск-коэффициентов» ' +
    '(там же — детали по каждому коэффициенту во всплывающих подсказках).\n' +
    '  • Постатейно — вкладка «Детализация» в левом меню.';

function maybeShowPdfHint(snackbar) {
    if (!loadPdfHintShown()) {
        snackbar.info('В диалоге печати выберите «Сохранить как PDF» в качестве принтера.');
        markPdfHintShown();
    }
}

export function printPdfAction({
    triggerEvent,
    store,
    snackbar,
    withLoadingButton,
    printWindow = () => window.print()
}) {
    /* 12.U26-fix: единая кнопка PDF в шапке заменяет дублирующую «Печать
       ответов (PDF)» внизу Опросника. Маршрутизация по активной вкладке:
       - questionnaire → табличный PDF опросника (printAnswers)
       - все остальные → window.print() с print.css (skрытие sidebar/topbar). */
    // 12.U31 (E.4): через storage helpers — graceful fallback в Safari Private.
    maybeShowPdfHint(snackbar);
    const activeTab = store.getState().activeTab;
    if (activeTab === 'questionnaire') {
        return printAnswersAction({ triggerEvent, store, snackbar, withLoadingButton });
    }
    if (activeTab === 'details') {
        return printDetailsAction({ triggerEvent, store, snackbar, withLoadingButton, printWindow });
    }
    printWindow();
}

export function printDetailsAction({
    triggerEvent,
    store,
    snackbar,
    withLoadingButton,
    printWindow = () => window.print()
}) {
    const calc = store.getState().activeCalc;
    if (!calc) { snackbar.warning('Нет активного расчёта'); return; }

    const run = typeof withLoadingButton === 'function'
        ? (fn) => withLoadingButton(triggerEvent, fn)
        : (fn) => fn();

    return run(async () => {
        const choice = await new Promise(resolve => {
            store.openModal('detailsPrintOptions', {
                draft: { includeQuantityCheck: true },
                onChoose: (selection) => resolve(selection),
                onCancel: () => resolve(null)
            });
        });
        if (!choice) return;
        return printWithDetailsMode(printWindow, {
            includeQuantitySummary: choice.includeQuantityCheck !== false
        });
    });
}

export function printAnswersAction({
    triggerEvent,
    store,
    snackbar,
    withLoadingButton
}) {
    const calc = store.getState().activeCalc;
    if (!calc) { snackbar.warning('Нет активного расчёта'); return; }
    maybeShowPdfHint(snackbar);
    /* Этап 13.U4: перед запуском печати спрашиваем формат и ориентацию.
       Modal возвращает { extended, landscape } или null при отмене.
       Esc/X закрывают модалку без печати. */
    return withLoadingButton(triggerEvent, async () => {
        const choice = await new Promise(resolve => {
            store.openModal('printAnswersOptions', {
                draft: { format: 'compact', landscape: true },
                onChoose: (selection) => resolve(selection),
                onCancel: () => resolve(null)  // null = пользователь отменил
            });
        });
        if (!choice) return;  // отмена — печать не запускаем
        const m = await import('../ui/printAnswers.js');
        m.printAnswers(calc, choice);
    });
}

export function openSummaryFormulaAction({ store }) {
    store.openModal('message', {
        title: 'Итого по расчёту — что это и как считается',
        message: SUMMARY_FORMULA_MESSAGE
    });
}
