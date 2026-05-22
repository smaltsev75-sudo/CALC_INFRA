export function focusQuestionAction({
    questionId,
    store,
    snackbar,
    requestAnimationFrameImpl = globalThis.requestAnimationFrame,
    documentRef = globalThis.document
}) {
    if (!questionId || typeof questionId !== 'string') return;
    const calc = store.getState().activeCalc;
    if (!calc) return;
    store.setActiveTab('questionnaire');
    const q = (calc.dictionaries?.questions || []).find(x => x.id === questionId);
    if (q?.section) {
        const cur = store.getState().ui.questionnaireOpenSections || [];
        if (!cur.includes(q.section)) {
            store.setUi({ questionnaireOpenSections: [...cur, q.section] });
        }
    }
    store.setUi({ recentlyChangedKey: `answer:${questionId}` });
    // Прокрутка и фокус после рендера. Двойной rAF: первый дожидается
    // scheduleRender(), второй гарантирует, что DOM уже обновлён.
    //
    // Фокус-семантика «Перейти к полю» — это НАВИГАЦИЯ, не мутация:
    //   1) editable input → курсор в input.
    //   2) поле в режиме «Не знаю» (input disabled) → фокус на кнопку
    //      «Не знаю» + info-подсказка. Никакого автоклика — пользователь
    //      сам Enter/Space разблокирует ввод. Иначе навигация молча
    //      меняла бы answer (null → defaultValue) и source расчёта.
    if (typeof requestAnimationFrameImpl === 'function') {
        requestAnimationFrameImpl(() => requestAnimationFrameImpl(() => {
            const node = documentRef.getElementById(`field-${questionId}`);
            if (!node) return;
            try {
                node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } catch { /* старые браузеры без smooth scroll — игнорируем */ }
            const editable = node.querySelector(
                'input:not([disabled]):not([type="hidden"]):not([type="checkbox"]),' +
                'select:not([disabled]),textarea:not([disabled])'
            );
            if (editable) {
                try { editable.focus({ preventScroll: true }); } catch {}
                return;
            }
            const unknownToggle = node.querySelector('.field-unknown-toggle');
            if (unknownToggle) {
                try { unknownToggle.focus({ preventScroll: true }); } catch {}
                snackbar.info('Нажмите «Не знаю», чтобы включить ручной ввод');
            }
        }));
    }
}
