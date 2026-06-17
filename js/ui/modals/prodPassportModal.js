import { calculate } from '../../domain/calculator.js';
import { el, trustedHtml } from '../dom.js';
import {
    renderProdPassportReport,
    buildProdPassportCsvModel,
    exportProdPassportCsv
} from '../prodPassportReport.js';

let _titleIdSeq = 0;

const HEAD_BADGE_SVG =
    '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3 3h7v7H3z"/><path d="M14 3h7v4h-7z"/><path d="M14 11h7v10h-7z"/><path d="M3 14h7v7H3z"/></svg>';

const CSV_SVG =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

const CLOSE_SVG =
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';

/**
 * Паспорт ПРОМ — кастомная модалка из драфта: иконка + «Паспорт» + бейдж «ПРОМ»
 * + подзаголовок + кнопка CSV + ✕ в шапке, БЕЗ футера. Backdrop-клик и ✕
 * закрывают окно. Esc обрабатывается глобальным keyboardController'ом
 * (закрывает верхнюю открытую модалку), поэтому здесь не дублируется.
 */
export function renderProdPassportModal(state, ctx) {
    const modal = state.modals.prodPassport;
    if (!modal?.open) return null;

    const onClose = () => ctx.closeModal('prodPassport');
    const calc = state.activeCalc;
    const titleId = `modal-title-${++_titleIdSeq}`;

    if (!calc) {
        return overlayShell(titleId, onClose, null,
            el('div', { class: 'pp-empty', text: 'Нет активного расчёта.' })
        );
    }

    const result = calculate(calc, state.calcRevision);
    /* «Факторы влияния» Паспорта читают тот же фильтр, что «Анализ факторов»
       (state.ui.sensitivityFilters) → одинаковый топ-1 и числа в обеих панелях. */
    const content = renderProdPassportReport(calc, result, modal, ctx, state.ui?.sensitivityFilters || null);

    const csvButton = el('button', {
        class: ['pp-head-btn', 'pp-head-btn-csv'],
        attrs: { type: 'button', 'data-testid': 'prod-passport-export-csv', 'aria-label': 'Скачать CSV' },
        onClick: () => {
            /* CSV — документ всего Паспорта ПРОМ: фильтр поиска игнорируется
             * (иначе активный фильтр молча терял строки в выгрузке). */
            const model = buildProdPassportCsvModel(calc, result);
            exportProdPassportCsv(model, calc.name);
        }
    },
        el('span', { class: 'pp-svg', attrs: { 'aria-hidden': 'true' }, trustedHtml: trustedHtml(CSV_SVG) }),
        el('span', { text: 'CSV' })
    );

    return overlayShell(titleId, onClose, csvButton, content);
}

/**
 * Каркас overlay с кастомной шапкой драфта. Класс `modal-overlay` сохраняет
 * связку с js/ui/index.js (анимация появления, scrollTop-снапшот) и общим
 * backdrop-стилем; внутренняя разметка кастомная (pp-modal).
 */
function overlayShell(titleId, onClose, headerAction, content) {
    const overlay = el('div', {
        class: 'modal-overlay pp-overlay',
        attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
        onClick: e => { if (e.target === overlay) onClose(); }
    },
        el('div', { class: 'pp-modal' },
            el('header', { class: 'pp-head' },
                el('span', {
                    class: 'pp-head-badge',
                    attrs: { 'aria-hidden': 'true' },
                    trustedHtml: trustedHtml(HEAD_BADGE_SVG)
                }),
                el('div', { class: 'pp-head-title' },
                    el('h1', { id: titleId },
                        el('span', { text: 'Паспорт' }),
                        el('span', { class: 'pp-head-env', text: 'ПРОМ' })
                    ),
                    el('div', { class: 'pp-head-sub', text: 'Карта бюджета и расчёт количества и стоимости каждой статьи' })
                ),
                el('div', { class: 'pp-head-actions' },
                    headerAction,
                    el('button', {
                        class: ['pp-head-btn', 'pp-head-btn-icon', 'pp-head-btn-close'],
                        attrs: { type: 'button', 'aria-label': 'Закрыть' },
                        onClick: onClose,
                        trustedHtml: trustedHtml(CLOSE_SVG)
                    })
                )
            ),
            el('div', { class: 'pp-modal-body' }, content)
        )
    );
    return overlay;
}
