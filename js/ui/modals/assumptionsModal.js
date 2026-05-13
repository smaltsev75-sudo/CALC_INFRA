/**
 * Модальное окно «Реестр допущений».
 *
 * Показывает список вопросов, ответ на которые трактуется как допущение
 * (нет ответа / ответ совпадает с defaultIfUnknown / ответ отсутствует, но
 * вопрос помечен assumptionRisk). Карточки сгруппированы по уровню риска
 * (high → medium → low) и снабжены кнопкой «Перейти к вопросу», которая
 * переключает вкладку на опросник и фокусирует поле ответа (через ctx).
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import { SECTION_LABELS } from '../../utils/constants.js';

/* ---------- Константы для отображения уровней риска ---------- */

const RISK_ORDER  = ['high', 'medium', 'low'];
const RISK_LABELS = { high: 'Высокий', medium: 'Средний', low: 'Низкий' };

/* ---------- Главный entry-point ---------- */

export function renderAssumptionsModal(state, ctx) {
    const m = state.modals.assumptions;
    if (!m || !m.open) return null;

    const onClose = () => ctx.closeModal('assumptions');
    const calc = state.activeCalc;

    return modalShell({
        title: 'Реестр допущений',
        size: 'lg',
        onClose,
        children: el('div', { class: 'assumptions-body' },
            calc ? renderBody(calc, ctx, onClose) : renderEmpty()
        ),
        footer: el('button', {
            class: 'btn btn-primary',
            title: 'Закрыть (Esc)',
            onClick: onClose
        }, 'Закрыть')
    });
}

/* ---------- Пустое состояние ---------- */

function renderEmpty() {
    return el('div', { class: 'assumptions-empty' },
        el('p', { text: 'Создайте или откройте расчёт, чтобы увидеть список допущений.' })
    );
}

/* ---------- Тело: список карточек по группам ---------- */

function renderBody(calc, ctx, onClose) {
    const questions = calc.dictionaries?.questions || [];
    const answers   = calc.answers || {};

    const all = [];
    for (const q of questions) {
        if (isAssumption(q, answers[q.id])) {
            all.push({ q, value: pickAssumedValue(q, answers[q.id]) });
        }
    }

    if (all.length === 0) {
        return el('div', { class: 'assumptions-empty' },
            el('p', { text: 'Нет ни одного допущения — все вопросы заполнены явно.' })
        );
    }

    const grouped = { high: [], medium: [], low: [] };
    for (const entry of all) {
        const risk = RISK_LABELS[entry.q.assumptionRisk] ? entry.q.assumptionRisk : 'low';
        grouped[risk].push(entry);
    }

    const blocks = [];
    blocks.push(el('div', { class: 'assumptions-summary' },
        el('span', { text: `Всего допущений: ${all.length}` }),
        ' · ',
        el('span', { class: 'risk-pill risk-pill-high',   text: `высокий: ${grouped.high.length}` }),
        ' ',
        el('span', { class: 'risk-pill risk-pill-medium', text: `средний: ${grouped.medium.length}` }),
        ' ',
        el('span', { class: 'risk-pill risk-pill-low',    text: `низкий: ${grouped.low.length}` })
    ));

    for (const risk of RISK_ORDER) {
        const list = grouped[risk];
        if (list.length === 0) continue;
        blocks.push(el('section', { class: 'assumptions-group' },
            el('h4', { class: ['assumptions-group-title', `risk-${risk}`] },
                `${RISK_LABELS[risk]} риск (${list.length})`
            ),
            ...list.map(entry => renderCard(entry, ctx, onClose))
        ));
    }

    return el('div', null, ...blocks);
}

/* ---------- Карточка одного допущения ---------- */

function renderCard({ q, value }, ctx, onClose) {
    const risk = RISK_LABELS[q.assumptionRisk] ? q.assumptionRisk : 'low';
    return el('article', { class: ['assumption-card', `assumption-card-${risk}`] },
        el('header', { class: 'assumption-card-header' },
            el('span', { class: ['risk-dot', `risk-dot-${risk}`], attrs: { 'aria-label': `Риск: ${RISK_LABELS[risk]}` } }),
            el('h5', { class: 'assumption-card-title', text: q.title || q.id })
        ),
        el('div', { class: 'assumption-card-meta' },
            kv('Раздел', SECTION_LABELS[q.section] || q.section || '—'),
            q.subgroup && kv('Подгруппа', q.subgroup),
            kv('Подставлено', formatValue(value)),
            kv('Риск', RISK_LABELS[risk])
        ),
        q.impact && el('div', { class: 'assumption-card-impact' },
            el('span', { class: 'assumption-card-impact-label', text: 'Влияние: ' }),
            el('span', { text: q.impact })
        ),
        q.recommendation && el('div', { class: 'assumption-card-recommendation' },
            el('span', { class: 'assumption-card-recommendation-label', text: 'Рекомендация: ' }),
            el('span', { text: q.recommendation })
        ),
        el('footer', { class: 'assumption-card-actions' },
            el('button', {
                class: 'btn btn-ghost',
                title: 'Перейти к этому вопросу в опроснике',
                onClick: () => {
                    onClose();
                    if (ctx && typeof ctx.focusQuestion === 'function') {
                        ctx.focusQuestion(q.id);
                    } else if (ctx && typeof ctx.setActiveTab === 'function') {
                        ctx.setActiveTab('questionnaire');
                    }
                }
            }, 'Перейти к вопросу →')
        )
    );
}

function kv(label, value) {
    return el('div', { class: 'kv-row' },
        el('span', { class: 'kv-key', text: label }),
        el('span', { class: 'kv-value', text: String(value ?? '—') })
    );
}

/* ---------- Логика: считается ли ответ допущением ---------- */

/**
 * Считается допущением, если:
 *   - ответ === null или undefined;
 *   - ответ строго равен q.defaultIfUnknown (точное равенство по типу);
 *   - вопрос помечен assumptionRisk и ответ равен q.defaultValue.
 *
 * Multiselect: ответ-массив сравнивается покомпонентно (порядок и состав).
 */
function isAssumption(q, answer) {
    if (answer === null || answer === undefined) return true;
    if (q.defaultIfUnknown !== undefined && q.defaultIfUnknown !== null && deepEqual(answer, q.defaultIfUnknown)) return true;
    if (q.assumptionRisk && q.defaultValue !== undefined && q.defaultValue !== null && deepEqual(answer, q.defaultValue)) return true;
    return false;
}

function pickAssumedValue(q, answer) {
    if (answer !== null && answer !== undefined) return answer;
    if (q.defaultIfUnknown !== undefined && q.defaultIfUnknown !== null) return q.defaultIfUnknown;
    return q.defaultValue;
}

function deepEqual(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
        return true;
    }
    return false;
}

function formatValue(v) {
    if (v === null || v === undefined) return '—';
    if (Array.isArray(v)) return v.length ? v.join(', ') : '—';
    if (typeof v === 'boolean') return v ? 'Да' : 'Нет';
    return String(v);
}
