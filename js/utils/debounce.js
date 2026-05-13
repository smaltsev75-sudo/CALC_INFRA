/**
 * Debounce: откладывает вызов fn до тех пор, пока не пройдёт wait мс
 * без новых вызовов. Используется для пересчёта при вводе.
 *
 * Возвращаемая функция дополнительно несёт два метода:
 *   - .flush()  — если есть отложенный вызов, выполнить его НЕМЕДЛЕННО
 *                 с последними переданными аргументами и сбросить таймер.
 *                 Если pending-вызова нет — no-op.
 *   - .cancel() — отменить отложенный вызов без исполнения. Сбрасывает таймер.
 *
 * Применение `.flush()` (Этап 11.1.3): на `beforeunload` нужно гарантированно
 * сбросить незавершённый автосейв расчёта, чтобы пользователь не потерял
 * последние правки при закрытии вкладки.
 */
export function debounce(fn, wait) {
    let timer = null;
    let lastArgs = null;
    let lastThis = null;

    function debounced(...args) {
        lastArgs = args;
        lastThis = this;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            const callArgs = lastArgs;
            const callThis = lastThis;
            // Аргументы храним до фактического вызова — на случай, если
            // .flush() сработает между установкой и срабатыванием таймера.
            fn.apply(callThis, callArgs);
        }, wait);
    }

    debounced.flush = function flush() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
            const callArgs = lastArgs;
            const callThis = lastThis;
            // lastArgs гарантированно установлены, если timer был активен,
            // но дополнительная защита не повредит.
            if (callArgs) fn.apply(callThis, callArgs);
        }
    };

    debounced.cancel = function cancel() {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return debounced;
}
