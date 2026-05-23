/**
 * Модальное окно с формулой расчёта значения.
 * Показывает: исходную формулу с подсветкой, расшифровку переменных,
 * текст справки (Markdown) и подсказку про используемые функции.
 */

import { el, trustedHtml } from '../dom.js';
import { modalShell } from './baseModal.js';
import { escapeHtml } from '../../utils/escapeHtml.js';
import { renderMarkdown } from '../../services/markdown.js';
import { getAst, isAstError } from '../../domain/formula/cache.js';
import { evaluate, collectReferences } from '../../domain/formula/evaluator.js';
import { lintFormulas } from '../../domain/validation.js';
import { STAND_IDS, STAND_LABELS, BILLING_INTERVAL_LABELS, MONTHS_PER_YEAR, DEFAULT_DAYS_PER_MONTH } from '../../utils/constants.js';
import { formatNumber, money, num } from '../../services/format.js';
import { billingIntervalToMonthlyMultiplier, buildContext, riskFactor } from '../../domain/calculator.js';
import { resolvePathValue } from '../../domain/quantityTrace.js';

export function renderFormulaModal(state, ctx) {
    const m = state.modals.formula;
    if (!m.open) return null;
    const calc = state.activeCalc;
    if (!calc) {
        // Активный расчёт исчез — закрыть модалку, чтобы не остаться в фантомном состоянии.
        ctx.closeModal('formula');
        return null;
    }
    const item = calc.dictionaries.items.find(i => i.id === m.itemId);
    if (!item) {
        ctx.closeModal('formula');
        return null;
    }
    const onClose = () => ctx.closeModal('formula');

    // Линтер формул — выявляет «висящие» ссылки на удалённые/переименованные вопросы.
    const warnings = lintFormulas([item], calc.dictionaries.questions);

    return modalShell({
        title: `Формула расчёта · ${item.name}`,
        size: 'lg',
        onClose,
        children: el('div', { class: 'formula-modal-body' },
            warnings.length > 0 && renderLintWarnings(warnings),
            renderItemSummary(item, calc),
            renderSystemFormula(item, calc),
            ...STAND_IDS.map(stand => renderStandFormula(item, stand, calc)),
            item.formulaHelp && el('div', { class: 'formula-help' },
                el('div', { class: 'formula-help-title', text: 'Справка' }),
                el('div', { class: 'formula-help-content', trustedHtml: trustedHtml(renderMarkdown(item.formulaHelp)) })
            ),
            renderReferenceHint()
        ),
        footer: el('button', {
            class: 'btn btn-primary',
            title: 'Закрыть окно формулы (Esc)',
            onClick: onClose
        }, 'Закрыть')
    });
}

function renderLintWarnings(warnings) {
    return el('div', { class: 'lint-warnings' },
        el('div', { class: 'lint-warnings-title', text: 'Замечания к формулам' }),
        el('ul', null,
            ...warnings.map(w => el('li', null,
                el('code', { text: STAND_LABELS[w.stand] || w.stand }), ' — ',
                el('span', { text: w.message })
            ))
        )
    );
}

function renderItemSummary(item, calc) {
    return el('div', { class: 'formula-summary' },
        kv('Категория', item.category),
        kv('Поставщик', item.vendor || '—'),
        kv('Единица измерения', item.unit),
        kv('Цена за единицу', money(item.pricePerUnit)),
        kv('Тариф', BILLING_INTERVAL_LABELS[item.billingInterval]),
        kv('Совместимые стенды', (item.applicableStands || []).map(s => STAND_LABELS[s]).join(', '))
    );
}

function kv(k, v) {
    return el('div', { class: 'kv-row' },
        el('span', { class: 'kv-key', text: k }),
        el('span', { class: 'kv-value', text: String(v ?? '—') })
    );
}

function renderSystemFormula(item, calc) {
    const phaseDuration = Number(calc.settings?.phaseDurationMonths) || MONTHS_PER_YEAR;
    const daysPerMonth  = Number(calc.settings?.daysPerMonth) || DEFAULT_DAYS_PER_MONTH;
    const billingIntervalMul = billingIntervalToMonthlyMultiplier(item.billingInterval, daysPerMonth, phaseDuration);
    const breakdown = riskFactor(item, 'PROD', calc.settings || {});
    const applyRisks = calc.settings?.applyRiskFactors !== false;
    const riskMul = applyRisks ? breakdown.total : 1;

    return el('div', { class: 'formula-system' },
        el('div', { class: 'formula-system-title', text: 'Системная формула стоимости' }),
        el('pre', { class: 'formula-code' },
            'costFinal(stand) = qty(stand) × pricePerUnit × billingIntervalMul × riskMul × vatMul\n' +
            `qty(stand)        — формула элемента (см. ниже по стендам)\n` +
            `pricePerUnit      = ${num(item.pricePerUnit, 4)}\n` +
            `billingIntervalMul= ${formatNumber(billingIntervalMul, { min: 6, max: 6 })} (тариф «${BILLING_INTERVAL_LABELS[item.billingInterval]}»` +
                (item.billingInterval === 'oneTime'
                    ? `, длительность фазы ${phaseDuration} мес. из S.phaseDurationMonths`
                    : item.billingInterval === 'annual'
                        ? `, ÷ ${MONTHS_PER_YEAR}`
                        : item.billingInterval === 'daily'
                            ? `, × ${daysPerMonth} дн./мес.`
                            : '') + `)\n` +
            `riskMul           = ${applyRisks ? formatNumber(riskMul, { min: 4, max: 4 }) : '1.0000'} ` +
                `(буферы ${formatNumber(breakdown.bufferFactor, { min: 4, max: 4 })}, ` +
                `инфляция ${formatNumber(breakdown.inflationMul, { min: 4, max: 4 })}, ` +
                `сезонность ${formatNumber(breakdown.seasonalMul, { min: 4, max: 4 })}, ` +
                `сдвиг сроков ${formatNumber(breakdown.scheduleMul, { min: 4, max: 4 })}, ` +
                `резерв ${formatNumber(breakdown.contingencyMul, { min: 4, max: 4 })})\n` +
            `vatMul            = ${formatNumber(breakdown.vatMul, { min: 4, max: 4 })}\n`
        )
    );
}

function renderStandFormula(item, stand, calc) {
    const formula = item.qtyFormulas?.[stand] || '';
    const isApplicable = (item.applicableStands || []).includes(stand);

    return el('div', { class: 'formula-stand' },
        el('div', { class: 'formula-stand-title' },
            el('span', { text: STAND_LABELS[stand] }),
            !isApplicable && el('span', { class: 'formula-stand-na', text: '(не применяется к стенду)' })
        ),
        formula.trim() === ''
            ? el('div', { class: 'formula-empty', text: 'Формула пуста — qty = 0.' })
            : el('div', null,
                el('pre', { class: 'formula-code', trustedHtml: trustedHtml(highlightFormula(formula)) }),
                renderResolvedRefs(formula, calc, stand, item)
            )
    );
}

/* Внешний аудит «Жёсткая проверка» (2026-05-20, P2#5): сигнатура расширена
 * параметром `item`. Раньше формула собирала raw `S: calc.settings`, что для
 * AI-ЭК (категория 'AI' / dashboardAiMetric) и hardware (dashboardResource ∈
 * CPU/GPU/RAM/SSD/HDD/S3) давало неверное значение `S.standSizeRatio.<STAND>`:
 * реальный calculator подменяет общий ratio на per-resource (12.U12) или на
 * aiStandFactor (13.U10). Теперь используем тот же `buildContext(...)` — что
 * и calculate(), — поэтому диагностика и evaluate показывают то же, что
 * реально считается в дашборде. Дополнительно: для S.<sid> в таблице
 * переменных показываем разрешённое из контекста значение, а не сырое из
 * calc.settings (иначе на AI-item «S.standSizeRatio» рисовало hardware-карту
 * без перекраски на AI-фактор). */
function renderResolvedRefs(formula, calc, stand, item) {
    const ast = getAst(formula);
    if (ast === null) return null;
    if (isAstError(ast)) {
        return el('div', { class: 'formula-error', text: `Ошибка парсинга: ${ast.__error.message}` });
    }
    const refs = collectReferences(ast);

    const questionDefaults = Object.fromEntries(
        (calc.dictionaries.questions || []).map(q => [q.id, q.defaultValue])
    );
    const ctx = buildContext(
        calc.answers || {},
        calc.settings || {},
        questionDefaults,
        stand,
        item || null
    );

    const rows = [];
    for (const qid of refs.questions) {
        const q = calc.dictionaries.questions.find(x => x.id === qid);
        const hasAnswer = Object.prototype.hasOwnProperty.call(calc.answers || {}, qid);
        const hasDefault = Object.prototype.hasOwnProperty.call(questionDefaults, qid);
        const v = hasAnswer ? calc.answers[qid] : hasDefault ? questionDefaults[qid] : 0;
        rows.push(el('tr', null,
            el('td', null, el('code', { text: 'Q.' + qid })),
            el('td', { text: q?.title || '(вопрос не найден)' }),
            el('td', null, el('code', { text: JSON.stringify(v) }))
        ));
    }
    for (const sid of refs.settings) {
        const resolved = resolvePathValue(ctx.S, sid);
        const v = resolved.exists ? resolved.value : 0;
        rows.push(el('tr', null,
            el('td', null, el('code', { text: 'S.' + sid })),
            el('td', { text: 'Параметр настроек (с учётом per-item override)' }),
            el('td', null, el('code', { text: JSON.stringify(v) }))
        ));
    }

    let resultText;
    try {
        const r = evaluate(ast, ctx);
        resultText = `qty = ${typeof r === 'boolean' ? (r ? 1 : 0) : Number(r)}`;
    } catch (e) {
        resultText = `Ошибка: ${e.message}`;
    }

    return el('div', { class: 'formula-resolved' },
        rows.length > 0 && el('table', { class: 'formula-refs' },
            el('thead', null, el('tr', null,
                el('th', { text: 'Переменная' }),
                el('th', { text: 'Описание' }),
                el('th', { text: 'Значение' })
            )),
            el('tbody', null, ...rows)
        ),
        refs.usesStand && el('div', { class: 'formula-stand-note', text: `STAND = '${stand}'` }),
        el('div', { class: 'formula-result', text: resultText })
    );
}

function highlightFormula(src) {
    let s = escapeHtml(src);
    // Q.xxx
    s = s.replace(/\bQ\.([A-Za-z_][A-Za-z0-9_]*)/g, '<span class="tok-q">Q.$1</span>');
    // S.xxx
    s = s.replace(/\bS\.([A-Za-z_][A-Za-z0-9_]*)/g, '<span class="tok-s">S.$1</span>');
    // STAND
    s = s.replace(/\bSTAND\b/g, '<span class="tok-stand">STAND</span>');
    // Функции (idn перед '(')
    s = s.replace(/\b(min|max|round|ceil|floor|abs|clamp|if)\b(?=\()/g, '<span class="tok-fn">$1</span>');
    // bool
    s = s.replace(/\b(true|false)\b/g, '<span class="tok-bool">$1</span>');
    // числа
    s = s.replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="tok-num">$1</span>');
    return s;
}

function renderReferenceHint() {
    return el('details', { class: 'formula-reference' },
        el('summary', null, 'Справка по языку формул'),
        el('div', { class: 'formula-reference-content' },
            el('p', null,
                'Поддерживаются арифметика (+ − × ÷ %), сравнения (< ≤ > ≥ == !=), логика (&& || !), ',
                el('code', { text: 'if(cond, a, b)' }), ', функции ',
                el('code', { text: 'min, max, round, ceil, floor, abs, clamp' }), '.'
            ),
            el('p', null,
                'Идентификаторы: ',
                el('code', { text: 'Q.<id_вопроса>' }), ' — ответ; ',
                el('code', { text: 'S.<id_настройки>' }), ' — параметр расчёта; ',
                el('code', { text: 'STAND' }), ' — текущий стенд (строка).'
            ),
            el('p', { text: 'Пример: if(Q.pcu >= 100, ceil(Q.pcu / 30), 5)' })
        )
    );
}
