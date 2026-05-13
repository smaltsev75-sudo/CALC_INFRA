/**
 * Компактный ряд chip-кнопок для временного отключения стендов из ИТОГО.
 *
 * Используется в toolbar дашборда и детализации. Клик по чипу переключает
 * стенд между «учтён» (aria-pressed=true) и «исключён» (aria-pressed=false).
 *
 * UI текст — русский, ID — английские (STAND_IDS).
 */

import { el } from './dom.js';
import { STAND_IDS, STAND_LABELS, STAND_DESCRIPTIONS } from '../utils/constants.js';

const TOGGLE_HINT = 'Исключить стенд из ИТОГО — стенд останется в детализации, ' +
    'но его суммы не войдут в общую цифру и графики';

export function renderStandToggles(disabledStands, ctx) {
    const disabled = Array.isArray(disabledStands) ? disabledStands : [];
    return el('div', { class: 'stand-toggles', attrs: { role: 'group', 'aria-label': 'Включённые стенды' } },
        el('span', { class: 'stand-toggles-label', text: 'Стенды:' }),
        ...STAND_IDS.map(sid => {
            const isOn = !disabled.includes(sid);
            return el('button', {
                class: 'stand-toggle',
                attrs: { 'aria-pressed': isOn ? 'true' : 'false', 'data-stand': sid },
                title: `${STAND_LABELS[sid]} — ${STAND_DESCRIPTIONS[sid] || ''}\n\n${TOGGLE_HINT}`,
                onClick: () => ctx.toggleStand?.(sid)
            }, STAND_LABELS[sid]);
        })
    );
}
