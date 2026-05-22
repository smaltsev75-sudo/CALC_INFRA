/**
 * Stage VAT-2 Phase 5: модалка выбора НДС-политики при импорте legacy v1 JSON.
 *
 * Открывается из `updateProviderPricesFromFile` когда validator возвращает
 * `vat-policy-required` (v1 JSON без `vatPolicy` metadata). Пользователь
 * выбирает один из 3 вариантов; нет default-выбора (пользователь должен явно
 * объявить семантику цен в файле).
 *
 * Вызовы:
 *   - `ctx.chooseVatPolicy('net' | 'gross-20' | 'gross-22')`:
 *       повторно вызывает validator с `{ userVatPolicy }`, сохраняет, закрывает.
 *   - `ctx.cancelVatPolicyChoice()`:
 *       закрывает без изменений provider prices.
 *
 * НИКАКОГО парсинга `priceSource` — пользователь сам выбирает (защита от
 * tichy import legacy-файла с неоднозначной НДС-семантикой).
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';

export function renderVatPolicyChoiceModal(state, ctx) {
    const m = state.modals.vatPolicyChoice;
    if (!m.open) return null;

    const onCancel = () => {
        ctx.cancelVatPolicyChoice();
    };

    const choose = (policy) => () => {
        ctx.chooseVatPolicy(policy);
    };

    /* Кнопка-вариант: одинаковая визуально, без `data-autofocus` ни на одной —
     * это и есть «нет default'а» (см. acceptance criterion: «No default»). */
    const choiceBtn = (label, policy, title) =>
        el('button', {
            class: 'btn btn-secondary vat-policy-choice-btn',
            attrs: {
                type: 'button',
                title,
                'data-vat-policy': policy,
                'data-testid': `vat-policy-${policy}`
            },
            onClick: choose(policy)
        }, label);

    const body = el('div', {
        class: 'vat-policy-choice-body',
        attrs: { 'data-testid': 'vat-policy-choice-modal' }
    },
        el('p', { class: 'vat-policy-choice-question',
            text: 'Какая политика НДС в этом файле?' }),
        el('p', { class: 'vat-policy-choice-hint',
            text: 'Файл не содержит явной vatPolicy — укажите, как трактовать цены, ' +
                  'чтобы калькулятор не учёл НДС дважды.' }),
        el('div', { class: 'vat-policy-choice-options' },
            choiceBtn('Цены без НДС', 'net',
                'Цены в файле — net. Калькулятор применит НДС поверх (один раз).'),
            choiceBtn('Цены с НДС 20%', 'gross-20',
                'Цены в файле gross 20% (период 2019–2025). Net = цена / 1.20.'),
            choiceBtn('Цены с НДС 22%', 'gross-22',
                'Цены в файле gross 22% (с 01.01.2026). Net = цена / 1.22.')
        )
    );

    return modalShell({
        title: 'НДС-политика прайса',
        onClose: onCancel,
        children: body,
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                attrs: {
                    type: 'button',
                    title: 'Отменить импорт без применения прайса (Esc)',
                    'data-testid': 'vat-policy-cancel'
                },
                onClick: onCancel
            }, 'Отмена')
        )
    });
}
