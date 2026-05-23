import { calculate } from '../../domain/calculator.js';
import { el } from '../dom.js';
import { renderRootCauseReportContent } from '../rootCauseReport.js';
import { modalShell } from './baseModal.js';

export function renderRootCauseReportModal(state, ctx) {
    const modal = state.modals.rootCauseReport;
    if (!modal?.open) return null;

    const onClose = () => ctx.closeModal('rootCauseReport');
    const calc = state.activeCalc;

    const content = calc
        ? renderRootCauseReportContent(
            calc,
            calculate(calc, state.calcRevision),
            calc.view?.disabledStands || [],
            { limit: 8 }
        )
        : null;

    return modalShell({
        title: 'Корневые причины бюджета',
        size: 'xl',
        onClose,
        children: el('div', {
            class: 'root-cause-modal-body',
            attrs: { 'data-testid': 'root-cause-modal' }
        },
            content || el('p', {
                class: 'root-cause-empty',
                text: 'Не найдено параметров, которые дают заметное снижение бюджета при проверочном изменении.'
            })
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-primary',
                attrs: { type: 'button' },
                onClick: onClose
            }, 'Закрыть')
        )
    });
}
