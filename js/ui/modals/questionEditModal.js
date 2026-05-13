/**
 * Модальное окно редактирования / создания вопроса.
 * Состояние формы (draft / errors) живёт в store (state.modals.questionEdit).
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { modalShell } from './baseModal.js';
import { SECTION_IDS, SECTION_LABELS, QUESTION_TYPES, QUESTION_TYPE_LABELS, VALIDATION } from '../../utils/constants.js';
import { parseNumberInput } from '../../services/format.js';

export function renderQuestionEditModal(state, ctx) {
    const m = state.modals.questionEdit;
    if (!m.open) return null;

    const draft  = m.draft;
    const errors = m.errors || [];

    if (!draft) return null;

    // Защита от исчезнувшего активного расчёта.
    if (!state.activeCalc) {
        ctx.closeModal('questionEdit');
        return null;
    }

    const onClose = () => ctx.closeModal('questionEdit');
    const onSave = () => {
        const r = ctx.saveQuestion(draft);
        if (r.ok) onClose();
        else ctx.patchModal('questionEdit', { errors: r.errors });
    };

    const isNew = !state.activeCalc.dictionaries.questions.some(q => q.id === draft.id);

    return modalShell({
        title: (isNew ? 'Создание вопроса' : 'Редактирование вопроса') + (draft.title ? ` · ${draft.title}` : ''),
        size: 'lg',
        onClose,
        children: el('div', { class: 'form-grid form-grid-question' },
            field('Раздел *', el('select', {
                class: 'input',
                value: draft.section,
                onChange: e => patchDraft(ctx, {section: e.target.value })
            }, SECTION_IDS.map(s =>
                el('option', { value: s, attrs: { selected: s === draft.section || undefined } }, SECTION_LABELS[s])
            ))),
            field('Тип ответа *', el('select', {
                class: 'input',
                value: draft.type,
                onChange: e => patchDraft(ctx, {type: e.target.value })
            }, QUESTION_TYPES.map(t =>
                el('option', { value: t, attrs: { selected: t === draft.type || undefined } }, QUESTION_TYPE_LABELS[t])
            ))),
            field('ID (для формул: Q.id) *', el('input', {
                class: 'input',
                type: 'text',
                value: draft.id,
                attrs: { maxlength: 60, pattern: '[a-z][a-z0-9_]*' },
                onInput: e => patchDraft(ctx, {id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })
            })),
            field('Порядок отображения *', el('input', {
                class: 'input',
                type: 'number',
                value: draft.order,
                attrs: { step: 10, min: 0 },
                onInput: e => {
                    const n = parseNumberInput(e.target.value);
                    patchDraft(ctx, {order: Number.isFinite(n) ? n : 0 });
                }
            })),

            el('div', { class: 'form-row form-row-wide' },
                el('span', { class: 'field-label' }, 'Заголовок вопроса *'),
                el('input', {
                    class: 'input',
                    type: 'text',
                    value: draft.title,
                    attrs: { maxlength: VALIDATION.QUESTION_TITLE_MAX },
                    onInput: e => patchDraft(ctx, {title: e.target.value })
                })
            ),
            el('div', { class: 'form-row form-row-wide' },
                el('span', { class: 'field-label' }, 'Описание / подсказка'),
                el('textarea', {
                    class: 'input',
                    attrs: { rows: 2, maxlength: 500 },
                    onInput: e => patchDraft(ctx, {description: e.target.value })
                }, draft.description || '')
            ),

            field('Подгруппа', el('input', {
                class: 'input',
                type: 'text',
                value: draft.subgroup || '',
                title: 'Необязательная подгруппа внутри раздела — для группировки родственных вопросов в опроснике.',
                attrs: { maxlength: 80 },
                onInput: e => patchDraft(ctx, {subgroup: e.target.value })
            })),

            el('div', { class: 'form-row form-row-wide' },
                el('span', { class: 'field-label' }, 'Рекомендация'),
                el('textarea', {
                    class: 'input',
                    title: 'Рекомендация для пользователя: что выбрать, на что обратить внимание. Видна как подсказка рядом с вопросом.',
                    attrs: { rows: 2, maxlength: 500 },
                    onInput: e => patchDraft(ctx, {recommendation: e.target.value })
                }, draft.recommendation || '')
            ),

            el('div', { class: 'form-row form-row-wide' },
                el('span', { class: 'field-label' }, 'Влияние на стоимость'),
                el('textarea', {
                    class: 'input',
                    title: 'Краткое описание того, как ответ на вопрос влияет на итоговую стоимость. Используется в реестре допущений.',
                    attrs: { rows: 2, maxlength: 500 },
                    onInput: e => patchDraft(ctx, {impact: e.target.value })
                }, draft.impact || '')
            ),

            ...renderTypeSpecific(draft, ctx),

            field('Разрешить «не знаю»', el('label', { class: 'switch' },
                el('input', {
                    type: 'checkbox',
                    checked: draft.allowUnknown !== false,
                    title: 'Если включено — пользователь может не отвечать на вопрос, и подставится defaultIfUnknown. Такие ответы попадут в реестр допущений.',
                    onChange: e => patchDraft(ctx, {allowUnknown: !!e.target.checked })
                }),
                el('span', { class: 'switch-track' }),
                el('span', { class: 'switch-label', text: (draft.allowUnknown !== false) ? 'Да' : 'Нет' })
            )),

            ...renderDefaultIfUnknown(draft, ctx),

            field('Риск допущения', el('select', {
                class: 'input',
                value: draft.assumptionRisk || 'low',
                title: 'Уровень риска, если пользователь оставил вопрос без ответа: low — почти не влияет на стоимость, medium — заметно, high — критично.',
                onChange: e => patchDraft(ctx, {assumptionRisk: e.target.value })
            },
                el('option', { value: 'low',    attrs: { selected: (draft.assumptionRisk || 'low') === 'low'    || undefined } }, 'Низкий'),
                el('option', { value: 'medium', attrs: { selected: draft.assumptionRisk === 'medium' || undefined } }, 'Средний'),
                el('option', { value: 'high',   attrs: { selected: draft.assumptionRisk === 'high'   || undefined } }, 'Высокий')
            )),

            errors.length > 0 && renderErrors(errors)
        ),
        footer: el('div', { class: 'modal-footer-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Отменить редактирование без сохранения (Esc)',
                onClick: onClose
            }, 'Отмена'),
            el('button', {
                class: 'btn btn-primary btn-icon-text',
                title: 'Сохранить изменения и закрыть',
                onClick: onSave
            }, icon('save', { size: 16 }), el('span', { text: 'Сохранить' }))
        )
    });
}

function patchDraft(ctx, patch) {
    ctx.patchModalDraft('questionEdit', patch);
}

/**
 * Поле «значение, подставляемое если ответ неизвестен» — тип-зависимое.
 * Возвращает массив дочерних узлов (совместимо со spread в form-grid).
 */
function renderDefaultIfUnknown(draft, ctx) {
    const out = [];
    if (draft.type === 'number') {
        out.push(field('Значение если «не знаю»', el('input', {
            class: 'input', type: 'number',
            value: draft.defaultIfUnknown ?? '',
            title: 'Какое числовое значение подставить, если пользователь не ответил. Используется при расчёте и попадает в реестр допущений.',
            attrs: { step: 'any' },
            onInput: e => patchDraft(ctx, {defaultIfUnknown: numOr(draft.defaultIfUnknown, e.target.value) })
        })));
    } else if (draft.type === 'boolean') {
        out.push(field('Значение если «не знаю»', el('label', { class: 'switch' },
            el('input', {
                type: 'checkbox',
                checked: !!draft.defaultIfUnknown,
                title: 'Какое булево значение подставить, если пользователь не ответил.',
                onChange: e => patchDraft(ctx, {defaultIfUnknown: e.target.checked })
            }),
            el('span', { class: 'switch-track' }),
            el('span', { class: 'switch-label', text: draft.defaultIfUnknown ? 'Да' : 'Нет' })
        )));
    } else if (draft.type === 'select') {
        const opts = Array.isArray(draft.options) ? draft.options : [];
        out.push(field('Значение если «не знаю»', el('select', {
            class: 'input',
            value: draft.defaultIfUnknown ?? '',
            title: 'Какой вариант подставить, если пользователь не ответил.',
            onChange: e => patchDraft(ctx, {defaultIfUnknown: e.target.value })
        },
            el('option', { value: '', attrs: { selected: (draft.defaultIfUnknown == null || draft.defaultIfUnknown === '') ? '' : undefined } }, '— не задано —'),
            ...opts.map(o => el('option', {
                value: o.value,
                attrs: { selected: String(o.value) === String(draft.defaultIfUnknown) || undefined }
            }, o.label || String(o.value)))
        )));
    } else if (draft.type === 'multiselect') {
        const opts = Array.isArray(draft.options) ? draft.options : [];
        const cur  = Array.isArray(draft.defaultIfUnknown) ? draft.defaultIfUnknown : [];
        out.push(el('div', { class: 'form-row form-row-wide' },
            el('span', { class: 'field-label' }, 'Значение если «не знаю»'),
            el('div', { class: 'multiselect' },
                opts.map(o => {
                    const isSel = cur.includes(o.value);
                    return el('label', { class: ['chip', isSel && 'chip-active'] },
                        el('input', {
                            type: 'checkbox',
                            checked: isSel,
                            onChange: e => {
                                const next = e.target.checked
                                    ? [...new Set([...cur, o.value])]
                                    : cur.filter(x => x !== o.value);
                                patchDraft(ctx, {defaultIfUnknown: next });
                            }
                        }),
                        el('span', { text: o.label || String(o.value) })
                    );
                })
            )
        ));
    }
    return out;
}

function renderTypeSpecific(draft, ctx) {
    const out = [];
    if (draft.type === 'number') {
        out.push(field('min', el('input', {
            class: 'input', type: 'number',
            value: draft.min ?? '',
            onInput: e => patchDraft(ctx, {min: numOr(draft.min, e.target.value) })
        })));
        out.push(field('max', el('input', {
            class: 'input', type: 'number',
            value: draft.max ?? '',
            onInput: e => patchDraft(ctx, {max: numOr(draft.max, e.target.value) })
        })));
        out.push(field('step', el('input', {
            class: 'input', type: 'number',
            value: draft.step ?? '',
            attrs: { step: 'any' },
            onInput: e => patchDraft(ctx, {step: numOr(draft.step, e.target.value) })
        })));
        out.push(field('Значение по умолчанию', el('input', {
            class: 'input', type: 'number',
            value: draft.defaultValue ?? '',
            onInput: e => patchDraft(ctx, {defaultValue: numOr(draft.defaultValue, e.target.value) })
        })));
    } else if (draft.type === 'boolean') {
        out.push(field('Значение по умолчанию', el('label', { class: 'switch' },
            el('input', {
                type: 'checkbox',
                checked: !!draft.defaultValue,
                onChange: e => patchDraft(ctx, {defaultValue: e.target.checked })
            }),
            el('span', { class: 'switch-track' }),
            el('span', { class: 'switch-label', text: draft.defaultValue ? 'Да' : 'Нет' })
        )));
    } else if (draft.type === 'select' || draft.type === 'multiselect') {
        out.push(el('div', { class: 'form-row form-row-wide' },
            el('span', { class: 'field-label' }, 'Опции'),
            renderOptions(draft, ctx)
        ));
        if (draft.type === 'select') {
            out.push(field('Значение по умолчанию', el('input', {
                class: 'input', type: 'text',
                value: draft.defaultValue ?? '',
                onInput: e => patchDraft(ctx, {defaultValue: e.target.value })
            })));
        }
    }
    return out;
}

function renderOptions(draft, ctx) {
    const opts = Array.isArray(draft.options) ? draft.options : [];
    return el('div', { class: 'options-editor' },
        ...opts.map((o, i) => el('div', { class: 'option-row' },
            el('input', {
                class: 'input', type: 'text', placeholder: 'value',
                value: o.value,
                onInput: e => {
                    const next = [...opts]; next[i] = { ...next[i], value: e.target.value };
                    patchDraft(ctx, {options: next });
                }
            }),
            el('input', {
                class: 'input', type: 'text', placeholder: 'label',
                value: o.label,
                onInput: e => {
                    const next = [...opts]; next[i] = { ...next[i], label: e.target.value };
                    patchDraft(ctx, {options: next });
                }
            }),
            el('button', {
                class: 'btn-icon btn-icon-danger',
                title: 'Удалить этот вариант ответа',
                attrs: { type: 'button' },
                onClick: () => patchDraft(ctx, {options: opts.filter((_, j) => j !== i) })
            }, icon('trash', { size: 14 }))
        )),
        el('button', {
            class: 'btn btn-ghost btn-icon-text',
            title: 'Добавить ещё один вариант ответа (значение и его подпись)',
            attrs: { type: 'button' },
            onClick: () => patchDraft(ctx, {options: [...opts, { value: '', label: '' }] })
        },
            icon('plus', { size: 14 }),
            el('span', { text: 'Опция' })
        )
    );
}

function numOr(prev, raw) {
    if (raw === '' || raw === null || raw === undefined) return undefined;
    const n = parseNumberInput(raw);
    return Number.isFinite(n) ? n : prev;
}

function renderErrors(errors) {
    return el('div', { class: 'form-errors', attrs: { role: 'alert' } },
        el('div', { class: 'form-errors-title', text: 'Исправьте ошибки:' }),
        el('ul', null,
            ...errors.map(e => el('li', null,
                e.path && el('code', { text: e.path }), ' ',
                el('span', { text: e.message })
            ))
        )
    );
}

function field(label, input) {
    return el('label', { class: 'form-row field' },
        el('span', { class: 'field-label', text: label }),
        input
    );
}
