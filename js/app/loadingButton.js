import { setButtonLoading } from '../ui/dom.js';

/**
 * Helper для длительных async-операций (импорт/экспорт/печать).
 * Если onClick прокинул Event как первый аргумент, currentTarget получает
 * .btn-loading на время выполнения. По завершении состояние снимается.
 */
export async function withLoadingButton(triggerEvent, asyncFn) {
    const target = triggerEvent && typeof triggerEvent === 'object'
        ? triggerEvent.currentTarget : null;
    const btn = target && typeof target.classList !== 'undefined' &&
                target.tagName === 'BUTTON'
                ? target : null;
    if (btn) setButtonLoading(btn, true);
    try {
        return await asyncFn();
    } finally {
        if (btn) setButtonLoading(btn, false);
    }
}
