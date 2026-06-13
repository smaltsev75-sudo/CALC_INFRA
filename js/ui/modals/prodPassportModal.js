import { calculate } from '../../domain/calculator.js';
import { el } from '../dom.js';
import { renderProdPassportReport } from '../prodPassportReport.js';
import { modalShell } from './baseModal.js';

export function renderProdPassportModal(state, ctx) {
    const modal = state.modals.prodPassport;
    if (!modal?.open) return null;

    const onClose = () => ctx.closeModal('prodPassport');
    const calc = state.activeCalc;
    const content = calc
        ? renderProdPassportReport(
            calc,
            calculate(calc, state.calcRevision),
            modal,
            ctx
        )
        : el('div', { class: 'prod-passport-empty', text: 'Нет активного расчёта.' });

    return modalShell({
        title: 'Паспорт ПРОМ',
        size: 'analytics',
        onClose,
        children: content,
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Закрыть')
        )
    });
}
