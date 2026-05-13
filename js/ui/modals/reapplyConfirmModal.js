/**
 * 14.U5: Re-apply profile confirmation dialog.
 *
 * Открывается из Quick Start (mode='edit') submit когда у пользователя есть
 * manual-правки (N>0). При N=0 диалог пропускается (см. app.js openReapplyConfirm).
 *
 * Три варианта действия:
 *   1. «Сохранить ручные правки» (primary) — manual-поля остаются как есть с
 *      меткой 'manual'; остальные поля переписываются из wizard-профиля.
 *      Это безопасный default — большинство пользователей хотят сохранить
 *      то, что уже подкрутили.
 *   2. «Перезаписать все» (danger) — все поля переписываются из профиля,
 *      manual-метки удаляются. Удобно если пользователь хочет «начать заново».
 *   3. «Отмена» (ghost) — закрыть диалог, ничего не менять.
 *
 * provider и другие settings не трогаются ни в одном режиме (см. 14.U4 +
 * reapplyProfile в calcController).
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { icon } from '../icons.js';
import { getActiveScenario } from '../../domain/scenarios.js';

export function renderReapplyConfirmModal(state, ctx) {
    const m = state.modals.reapplyConfirm;
    if (!m.open) return null;

    const n = m.manualCount || 0;
    const onCancel  = () => ctx.closeModal('reapplyConfirm');
    const onPreserve = () => {
        ctx.closeModal('reapplyConfirm');
        ctx.applyReapply('preserve');
    };
    const onOverwrite = () => {
        ctx.closeModal('reapplyConfirm');
        ctx.applyReapply('overwrite');
    };

    const fieldsWord = n === 1 ? 'поле' : (n >= 2 && n <= 4 ? 'поля' : 'полей');

    /* Sprint 3.0 Stage 2: показываем label активного scenario, чтобы
       пользователь явно видел, КАКОЙ сценарий перезаписывается (важно для
       multi-profile calc'ов — Re-apply трогает только активный, остальные
       сценарии не задеваются). */
    const activeScenario = getActiveScenario(state.activeCalc);
    const scenarioLabel = activeScenario?.label;
    const introText = scenarioLabel
        ? `В сценарии «${scenarioLabel}» вы изменили ${n} ${fieldsWord} вручную. ` +
          'Что сделать с этими правками при повторном применении профиля?'
        : `Вы изменили ${n} ${fieldsWord} вручную. ` +
          'Что сделать с этими правками при повторном применении профиля?';

    return modalShell({
        title: scenarioLabel ? `Применить профиль заново · ${scenarioLabel}` : 'Применить профиль заново',
        size: 'md',
        onClose: onCancel,
        children: el('div', { class: 'reapply-confirm-body' },
            el('p', { class: 'reapply-intro' },
                el('span', { class: 'reapply-icon', attrs: { 'aria-hidden': 'true' } },
                    icon('alert-triangle', { size: 18 })),
                el('span', { text: introText })
            ),
            el('ul', { class: 'reapply-info-list' },
                el('li', { text:
                    'Параметры расчёта (НДС, инфляция, провайдер, размеры стендов) — НЕ трогаются ни в одном режиме.' }),
                el('li', { text:
                    'Manual-бейджи в Опроснике обновляются автоматически: «Вы изменили» останется только у сохранённых полей.' })
            )
        ),
        footer: el('div', { class: 'modal-footer-actions reapply-footer' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Закрыть диалог, ничего не менять (Esc)',
                onClick: onCancel
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-danger',
                title: 'Все поля будут переписаны значениями из профиля. Manual-бейджи исчезнут.',
                onClick: onOverwrite
            }, 'Перезаписать все'),
            el('button', {
                class: 'btn btn-primary',
                title: 'Manual-поля сохранят текущие значения. Остальные обновятся из профиля.',
                attrs: { 'data-autofocus': '' },
                onClick: onPreserve
            }, 'Сохранить ручные правки')
        )
    });
}
