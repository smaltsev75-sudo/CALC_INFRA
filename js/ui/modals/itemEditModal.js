/**
 * Модальное окно редактирования / создания элемента конфигурации.
 * Состояние формы (draft / errors / activeSubTab) живёт в store
 * (state.modals.itemEdit), что обеспечивает single-source-of-truth.
 *
 * 3 sub-таба: «Основное» / «Формулы количества» / «Справка».
 */

import { el } from '../dom.js';
import { icon } from '../icons.js';
import { modalShell } from './baseModal.js';
import { STAND_IDS, STAND_LABELS, CATEGORY_IDS, CATEGORY_LABELS, BILLING_INTERVAL_IDS, BILLING_INTERVAL_LABELS, RESOURCE_CLASS_IDS, RESOURCE_CLASS_LABELS, COST_TYPE_IDS, COST_TYPE_LABELS } from '../../utils/constants.js';
import { getCostType } from '../../domain/costType.js';
import { parseNumberInput } from '../../services/format.js';
import { DECIMAL_INPUT_TYPE, decimalInputAttrs, formatDecimalInputValue } from '../decimalInput.js';
import { getAst } from '../../domain/formula/cache.js';
import { collectReferences } from '../../domain/formula/evaluator.js';

export function renderItemEditModal(state, ctx) {
    const m = state.modals.itemEdit;
    if (!m.open) return null;

    const draft        = m.draft;
    const errors       = m.errors || [];
    const activeSubTab = m.activeSubTab || 'main';

    if (!draft) return null;

    // Защита от рассинхрона: если активный расчёт исчез (сброс / переключение),
    // молча закрываем модалку, чтобы не уронить рендер.
    if (!state.activeCalc) {
        ctx.closeModal('itemEdit');
        return null;
    }

    const questions = state.activeCalc.dictionaries.questions || [];

    const onClose = () => ctx.closeModal('itemEdit');
    const onSave = () => {
        const result = ctx.saveItem(draft);
        if (result.ok) onClose();
        else ctx.patchModal('itemEdit', { errors: result.errors });
    };

    const isNew = !state.activeCalc.dictionaries.items.some(i => i.id === draft.id);

    return modalShell({
        title: (isNew ? 'Создание элемента' : 'Редактирование элемента') + (draft.name ? ` · ${draft.name}` : ''),
        size: 'xl',
        onClose,
        children: el('div', { class: 'item-edit' },
            renderSubTabs(activeSubTab, ctx),
            activeSubTab === 'main'     ? renderMain(draft, ctx) :
            activeSubTab === 'formulas' ? renderFormulas(draft, ctx, questions) :
                                           renderHelp(draft, ctx),
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

/* ---------- Хелпер: патч draft через ctx ---------- */

function patchDraft(ctx, patch) {
    ctx.patchModalDraft('itemEdit', patch);
}

function setSubTab(ctx, id) {
    ctx.patchModal('itemEdit', { activeSubTab: id });
}

/* ---------- Sub-tabs ---------- */

function renderSubTabs(activeSubTab, ctx) {
    const tabs = [
        { id: 'main',     label: 'Основное',          title: 'Название, цена, единица измерения, категория, тариф, поставщик' },
        { id: 'formulas', label: 'Формулы количества', title: 'Сколько штук этого элемента нужно на каждом стенде. Можно задать формулу через ответы пользователя.' },
        { id: 'help',     label: 'Справка',            title: 'Текст-объяснение для пользователя — что это за элемент и как он считается' }
    ];
    return el('nav', { class: 'sub-tabs' },
        ...tabs.map(t => el('button', {
            class: ['sub-tab', activeSubTab === t.id && 'sub-tab-active'],
            title: t.title,
            onClick: () => setSubTab(ctx, t.id)
        }, t.label))
    );
}

/* ---------- Sub-tab: Основное ---------- */

function renderMain(draft, ctx) {
    return el('div', { class: 'form-grid' },
        field('Название *', el('input', {
            class: 'input',
            type: 'text',
            value: draft.name,
            title: 'Понятное название элемента — будет видно в опроснике, дэшборде и детализации. Например: «Сервер промышленного уровня».',
            attrs: { maxlength: 120, 'data-focus-key': 'item-edit:name', 'data-autofocus': '' },
            onInput: e => patchDraft(ctx, {name: e.target.value })
        })),
        field('Единица измерения *', el('input', {
            class: 'input',
            type: 'text',
            value: draft.unit,
            title: 'Единица учёта количества: шт., кластер, ТБ, 1 млн токенов, мин. аудио и т.п.',
            attrs: { maxlength: 40, 'data-focus-key': 'item-edit:unit' },
            onInput: e => patchDraft(ctx, {unit: e.target.value })
        })),
        field('Цена за единицу *', el('input', {
            class: 'input',
            type: DECIMAL_INPUT_TYPE,
            value: formatDecimalInputValue(draft.pricePerUnit),
            title: 'Стоимость одной единицы измерения в текущей валюте расчёта',
            attrs: decimalInputAttrs({ 'data-focus-key': 'item-edit:pricePerUnit' }),
            onInput: e => {
                const n = parseNumberInput(e.target.value);
                if (Number.isFinite(n)) patchDraft(ctx, {pricePerUnit: n });
            }
        })),
        field('Категория *', el('select', {
            class: 'input',
            value: draft.category,
            title: 'Категория для группировки в дэшборде: оборудование, лицензии, услуги, трафик или резерв',
            attrs: { 'data-focus-key': 'item-edit:category' },
            onChange: e => patchDraft(ctx, {category: e.target.value })
        }, CATEGORY_IDS.map(c =>
            el('option', { value: c, attrs: { selected: c === draft.category || undefined } }, CATEGORY_LABELS[c])
        ))),
        field('Класс ресурса *', el('select', {
            class: 'input',
            value: draft.resourceClass || '',
            title: 'Класс ресурса определяет, какие риск-коэффициенты к нему применяются. Например, сезонный множитель действует только на сеть, трафик, внешние сервисы и токены AI/LLM — а на железо и лицензии нет.',
            attrs: { 'data-focus-key': 'item-edit:resourceClass' },
            onChange: e => patchDraft(ctx, {resourceClass: e.target.value })
        }, RESOURCE_CLASS_IDS.map(rc =>
            el('option', { value: rc, attrs: { selected: rc === draft.resourceClass || undefined } }, RESOURCE_CLASS_LABELS[rc])
        ))),
        field('Тариф *', el('select', {
            class: 'input',
            value: draft.billingInterval,
            title: 'Как тарифицируется стоимость: ежедневно, ежемесячно, ежегодно или разово (с распределением на длительность этапа)',
            attrs: { 'data-focus-key': 'item-edit:billingInterval' },
            onChange: e => patchDraft(ctx, {billingInterval: e.target.value })
        }, BILLING_INTERVAL_IDS.map(t =>
            el('option', { value: t, attrs: { selected: t === draft.billingInterval || undefined } }, BILLING_INTERVAL_LABELS[t])
        ))),
        field('Поставщик', el('input', {
            class: 'input',
            type: 'text',
            value: draft.vendor || '',
            title: 'Название провайдера или вендора. Не обязательно — служит подсказкой при выборе.',
            attrs: { maxlength: 80, 'data-focus-key': 'item-edit:vendor' },
            onInput: e => patchDraft(ctx, {vendor: e.target.value })
        })),
        renderCostTypeField(draft, ctx),

        el('div', { class: 'form-row form-row-wide' },
            el('span', { class: 'field-label' }, 'Описание'),
            el('textarea', {
                class: 'input',
                title: 'Краткое описание элемента: что это, для чего нужно, какие особенности. Видно в детализации и в модалке формулы.',
                attrs: { rows: 2, maxlength: 500, 'data-focus-key': 'item-edit:description' },
                onInput: e => patchDraft(ctx, {description: e.target.value })
            }, draft.description || '')
        ),

        el('div', { class: 'form-row form-row-wide' },
            el('span', { class: 'field-label' }, 'Применимо к стендам'),
            el('div', { class: 'multiselect' },
                STAND_IDS.map(s => {
                    const isSel = draft.applicableStands.includes(s);
                    return el('label', { class: ['chip', isSel && 'chip-active'] },
                        el('input', {
                            type: 'checkbox',
                            checked: isSel,
                            onChange: e => {
                                const next = e.target.checked
                                    ? [...new Set([...draft.applicableStands, s])]
                                    : draft.applicableStands.filter(x => x !== s);
                                patchDraft(ctx, {applicableStands: next });
                            }
                        }),
                        el('span', { text: STAND_LABELS[s] })
                    );
                })
            )
        )
    );
}

/* ---------- Поле «Тип расхода (CAPEX / OPEX)» ---------- */

/**
 * Селектор типа расхода. Значение `''` = «Авто» — поле costType не сохраняется,
 * тип определяется по billingInterval (oneTime → capex, иначе → opex).
 * Явный выбор (capex / opex) позволяет пользователю переопределить
 * для нестандартных случаев (например, годовая лицензия → CAPEX).
 */
function renderCostTypeField(draft, ctx) {
    const explicit = draft.costType === 'capex' || draft.costType === 'opex' ? draft.costType : '';
    const auto = getCostType({ ...draft, costType: undefined });
    const autoLabel = COST_TYPE_LABELS[auto];
    return el('label', { class: 'form-row field' },
        el('span', { class: 'field-label', text: 'Тип расхода' }),
        el('div', { class: 'cost-type-field' },
            el('select', {
                class: 'input',
                value: explicit,
                title: 'CAPEX — капитальные (разовые); OPEX — операционные (регулярные). По умолчанию: разовые → CAPEX, остальные → OPEX. Явный выбор переопределяет автоматику.',
                attrs: { 'data-focus-key': 'item-edit:costType' },
                onChange: e => {
                    const v = e.target.value;
                    if (v === 'capex' || v === 'opex') patchDraft(ctx, {costType: v });
                    else patchDraft(ctx, {costType: undefined });
                }
            },
                el('option', { value: '', attrs: { selected: explicit === '' || undefined } },
                    `Авто — ${autoLabel}`),
                ...COST_TYPE_IDS.map(t =>
                    el('option', { value: t, attrs: { selected: t === explicit || undefined } },
                        COST_TYPE_LABELS[t])
                )
            ),
            el('div', { class: 'cost-type-hint',
                text: 'По умолчанию: разовые → CAPEX, остальные → OPEX. Можно переопределить вручную для нестандартных случаев.'
            })
        )
    );
}

/* ---------- Sub-tab: Формулы количества ---------- */

function renderFormulas(draft, ctx, questions) {
    return el('div', { class: 'formulas-grid' },
        el('div', { class: 'formulas-grid-hint' },
            'Каждая формула возвращает количество элементов на стенде. Поддерживаются переменные ',
            el('code', { text: 'Q.<id_вопроса>' }), ', ', el('code', { text: 'S.<param>' }), ', ',
            el('code', { text: 'STAND' }), ', функции ', el('code', { text: 'min, max, round, ceil, floor, abs, clamp, if' }), '.',
            ' Пустая формула = qty = 0.'
        ),
        // datalist для подсказок Q.<id> при наборе формулы
        renderQuestionIdDatalist(questions),
        ...STAND_IDS.map(s => {
            const isApplicable = draft.applicableStands.includes(s);
            return el('div', { class: ['formula-row', !isApplicable && 'formula-row-na'] },
                el('div', { class: 'formula-row-label' },
                    STAND_LABELS[s],
                    !isApplicable && el('span', { class: 'formula-row-na-mark', text: ' (не применяется)' })
                ),
                el('textarea', {
                    class: 'input formula-input',
                    title: `Формула расчёта количества для стенда «${STAND_LABELS[s]}». Может ссылаться на ответы пользователя через Q.<id_вопроса> и параметры расчёта через S.<имя>. Пустая формула = 0 единиц.`,
                    attrs: {
                        rows: 2, maxlength: 1000, spellcheck: false,
                        'data-focus-key': `item-edit:formula:${s}`,
                        list: 'formula-question-ids'
                    },
                    placeholder: 'например: if(Q.pcu >= 100, 7, 5)',
                    onInput: e => {
                        const next = { ...draft.qtyFormulas, [s]: e.target.value };
                        patchDraft(ctx, {qtyFormulas: next });
                    }
                }, draft.qtyFormulas[s] || ''),
                renderFormulaLint(draft.qtyFormulas[s] || '', s, questions)
            );
        })
    );
}

/* ---------- Sub-tab: Справка ---------- */

function renderHelp(draft, ctx) {
    return el('div', { class: 'help-edit' },
        el('span', { class: 'field-label' }, 'Текст-объяснение для пользователя'),
        el('textarea', {
            class: 'input',
            title: 'Текст-пояснение, который пользователь увидит при клике на иконку-подсказку рядом со значением этого элемента в детализации. Поддерживается простое форматирование (заголовки, списки, выделение).',
            attrs: { rows: 10, maxlength: 4000 },
            placeholder: '# Заголовок\n\nКраткое описание для пользователя — что это и как считается...',
            onInput: e => patchDraft(ctx, {formulaHelp: e.target.value })
        }, draft.formulaHelp || '')
    );
}

/* ---------- Ошибки ---------- */

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

/* ---------- Live-линтер формулы: parse + collectReferences ---------- */

function renderFormulaLint(source, stand, questions) {
    if (!source || !source.trim()) return null;
    const ast = getAst(source);
    if (!ast) return null;
    if (ast.__error) {
        return el('div', { class: 'formula-lint formula-lint-error', attrs: { role: 'alert' } },
            `Ошибка: ${ast.__error.message}`);
    }
    const refs = collectReferences(ast);
    const knownQuestions = new Set((questions || []).map(q => q.id));
    const knownSettings = new Set(['bufferTask','bufferProject','kInflation','period','phaseDurationMonths']);
    const unknown = [];
    for (const qid of refs.questions) if (!knownQuestions.has(qid)) unknown.push(`Q.${qid}`);
    for (const sid of refs.settings)  if (!knownSettings.has(sid))  unknown.push(`S.${sid}`);
    if (unknown.length > 0) {
        return el('div', { class: 'formula-lint formula-lint-warn' },
            `Неизвестные ссылки: ${unknown.join(', ')}`);
    }
    return el('div', { class: 'formula-lint formula-lint-ok' },
        icon('check', { size: 14 }),
        el('span', { text: 'Формула корректна' })
    );
}

/* ---------- Datalist для автодополнения Q.<id> ---------- */

function renderQuestionIdDatalist(questions) {
    return el('datalist', { id: 'formula-question-ids' },
        ...(questions || []).map(q => el('option', { value: `Q.${q.id}`, attrs: { label: q.title } }))
    );
}
