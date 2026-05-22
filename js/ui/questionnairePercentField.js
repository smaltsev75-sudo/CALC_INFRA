import { el } from './dom.js';
import { UI_TOOLTIPS_SHORT } from '../utils/constants.js';
import { parseNumberInput } from '../services/format.js';
import { DECIMAL_INPUT_TYPE, applyDecimalInputPrecision, decimalInputAttrs, formatDecimalInputValue } from './decimalInput.js';

export function renderPercentField(label, value, onChange, hint, key, disabled = false, shortHint = null) {
    // 12.U2: добавлен slider-companion 0..100% для быстрой грубой оценки.
    // Number-input оставлен для точности и значений >100% или <0%.
    // Slider синхронизируется с input двусторонне через общий onChange.
    // Stage 5.3.A: shortHint — видимый <span class="field-description"> под полем.
    // Если null — берём из UI_TOOLTIPS_SHORT по setting-key (без префикса 'setting:').
    const pct = (value ?? 0) * 100;
    const sliderValue = Math.max(0, Math.min(100, pct));
    const settingKey = typeof key === 'string' ? key.replace(/^setting:/, '') : null;
    const testId = settingKey ? `setting-${settingKey}`.replace(/[^a-zA-Z0-9_-]/g, '-') : null;
    const resolvedShort = shortHint ?? (settingKey && UI_TOOLTIPS_SHORT[settingKey]) ?? null;

    return el('label', {
        class: ['field', 'field-percent', disabled && 'field-disabled'],
        attrs: testId ? { 'data-testid': `${testId}-field` } : undefined
    },
        el('span', { class: 'field-label', text: label }),
        el('div', { class: 'percent-input-row' },
            el('div', { class: 'percent-input' },
                el('input', {
                    class: 'input',
                    type: DECIMAL_INPUT_TYPE,
                    value: formatDecimalInputValue(pct),
                    title: disabled
                        ? hint + '\n\nПоле неактивно: в Опроснике выключен переключатель «Учитывать риск-коэффициенты в бюджете».'
                        : hint,
                    disabled,
                    attrs: decimalInputAttrs({
                        'data-focus-key': key,
                        ...(testId ? { 'data-testid': testId } : {})
                    }),
                    onInput: e => {
                        const n = parseNumberInput(applyDecimalInputPrecision(e.target));
                        if (Number.isFinite(n)) {
                            onChange(n / 100);
                            // Оптимистичный sync slider'а до перерендера, чтобы не было визуального лага.
                            const slider = e.target.closest('.percent-input-row')?.querySelector('input[type="range"]');
                            if (slider) slider.value = String(Math.max(0, Math.min(100, n)));
                        }
                    }
                }),
                el('span', { class: 'percent-input-suffix', text: '%' })
            ),
            el('input', {
                class: 'percent-slider',
                type: 'range',
                value: String(sliderValue),
                title: hint + '\n\nДвиньте слайдер для быстрой грубой оценки. Точное значение можно ввести числом слева.',
                disabled,
                attrs: {
                    min: 0, max: 100, step: 1,
                    ...(testId ? { 'data-testid': `${testId}-slider` } : {}),
                    'aria-label': `${label} — слайдер 0..100%`
                },
                /* Drag-state slider'а. Каждое движение мыши на 1px вызывает
                   `input`-событие; если в нём коммитить значение в store,
                   subscriber планирует rAF-render → DOM полностью пересоздаётся
                   через el(...) → старый <input type=range> заменяется новым →
                   pointer-capture теряется → drag прерывается уже на первом
                   mousemove. Пользователь видит «слайдер не двигается».
                   Решение: на `input` (живой drag) — только визуальный sync
                   number-input'а, без commit. На `change` (mouseup/keyup) —
                   собственно commit; render произойдёт один раз в конце drag'а. */
                onInput: e => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    const numInput = e.target.closest('.percent-input-row')?.querySelector('.percent-input input');
                    if (numInput) numInput.value = String(n).replace('.', ',');
                },
                onChange: e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChange(n / 100);
                }
            })
        ),
        /* Stage 5.3.A: tooltipShort под полем (видимый, ≤100 симв). hint выше остаётся
           в title (полный текст с диапазонами и примерами). resolvedShort = null →
           field-description не рендерится (legacy-вызов до Stage 5.3.A). */
        resolvedShort && el('span', { class: 'field-description', text: resolvedShort })
    );
}
