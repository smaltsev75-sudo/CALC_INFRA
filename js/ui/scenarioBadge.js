/**
 * Бейдж активного сценария — единая визуальная единица для всех views.
 *
 * Куда подключается:
 *   - Дашборд (tab-title справа от h2 «Дэшборд»)
 *   - Детализация (внутри «Детализация · <name>»)
 *   - Сравнение расчётов (рядом с h2)
 *   - Опросник (рядом с h2)
 *   - PDF опросника (header-line)
 *
 * Цель: пользователь, не глядя в полосу вкладок наверху TopBar'а, понимает,
 * в каком сценарии сейчас находится — критично для PDF-экспорта и для случаев,
 * когда полоса вкладок скрыта на узких экранах.
 *
 * Контракт:
 *   - Если у calc нет сценариев и нет wizard'а (мёртвый legacy без миграции) —
 *     return null. Не загромождаем UI бессмысленным бейджем «Базовый» для пустого
 *     расчёта.
 *   - Иначе — возвращаем <span class="scenario-name-badge"> с текстом
 *     «Сценарий: <label>» (label обрезается до 40 символов).
 */

import { el } from './dom.js';
import { getActiveScenario } from '../domain/scenarios.js';

const MAX_LABEL_LEN = 40;

/**
 * Текстовое имя активного сценария или null.
 * Безопасно для PDF (string-only path: см. activeScenarioLabelText).
 */
export function activeScenarioLabelText(calc) {
    if (!calc) return null;
    const scenarios = Array.isArray(calc.scenarios) ? calc.scenarios : null;
    /* Не показываем бейдж если расчёт «голый» — нет ни scenarios[], ни wizard'а
       (нечего идентифицировать). */
    if ((!scenarios || scenarios.length === 0) && !calc.wizard) return null;
    const s = getActiveScenario(calc);
    if (!s || !s.label) return null;
    const label = String(s.label).trim();
    if (!label) return null;
    return label.length > MAX_LABEL_LEN
        ? label.slice(0, MAX_LABEL_LEN - 1) + '…'
        : label;
}

/**
 * Inline DOM-бейдж рядом с tab-title. Возвращает null, если сценария нет.
 */
export function renderScenarioBadge(calc) {
    const label = activeScenarioLabelText(calc);
    if (!label) return null;
    return el('span', {
        class: 'scenario-name-badge',
        attrs: {
            title: `Активный сценарий: ${label}. Переключить — в полосе вкладок сверху.`,
            'aria-label': `Сценарий ${label}`
        }
    },
        el('span', { class: 'scenario-name-badge-prefix', text: 'Сценарий' }),
        el('span', { class: 'scenario-name-badge-text', text: label })
    );
}
