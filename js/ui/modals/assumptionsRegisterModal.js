/**
 * Stage 15.2 — Модалка «Допущения расчёта».
 *
 * Три секции (аккордеоны):
 *   1. Источники данных   — counts + карточки по group (manual / quick_start / default).
 *   2. Рискованные допущения — только confidence='low' (CRITICAL_FIELDS + дефолт).
 *   3. Прайсы             — метаданные привязки провайдера (opaque; без дополнительных
 *                            calc.providerVersion — секция скрыта).
 *
 * Pre-filter: если m.filterFieldIds задан (cross-link из Health Check finding'а),
 * в каждой секции показываются только поля из этого списка, с плашкой-подсказкой.
 *
 * Навигация к полю: «Перейти к полю» → закрывает модалку → ctx.focusQuestion(fid)
 * или ctx.setActiveTab('questionnaire') как fallback.
 */

import { el } from '../dom.js';
import { modalShell } from './baseModal.js';
import {
    buildAssumptionsRegister,
    groupAssumptionsBySource,
    getRiskyAssumptions
} from '../../domain/assumptionsRegister.js';

/* ---------- Константы ---------- */

const SOURCE_LABELS = Object.freeze({
    manual:      'Задано вручную',
    quick_start: 'Заполнено мастером Quick Start',
    default:     'Значение по умолчанию'
});

/* ============================================================
 * Главный entry
 * ============================================================ */

export function renderAssumptionsRegisterModal(state, ctx) {
    const m = state.modals?.assumptionsRegister;
    if (!m || !m.open) return null;

    const onClose = () => ctx.closeModal('assumptionsRegister');
    const calc = state.activeCalc;
    const filterFieldIds = m.filterFieldIds || null;

    // Stage 16.1: точка входа в мастер уточнения из Реестра допущений.
    // Запускается с filterFieldIds = id рискованных допущений, чтобы мастер
    // прошёл только по ним.
    const riskyFieldIds = calc
        ? getRiskyAssumptions(buildAssumptionsRegister(calc)).map(a => a.fieldId)
        : [];
    const showGuidedBtn = calc && riskyFieldIds.length > 0
        && typeof ctx.openGuidedCompletion === 'function';

    return modalShell({
        title: 'Допущения расчёта',
        size: 'lg',
        onClose,
        children: el('div', { class: 'assumptions-register-body' },
            calc
                ? renderBody(calc, ctx, onClose, filterFieldIds)
                : renderEmpty()
        ),
        footer: el('div', { class: 'assumptions-register-footer' },
            showGuidedBtn
                ? el('button', {
                    class: 'btn btn-ghost',
                    attrs: { type: 'button' },
                    title: 'Пройти мастер уточнения только по рискованным допущениям',
                    onClick: () => {
                        onClose();
                        ctx.openGuidedCompletion(riskyFieldIds);
                    }
                }, 'Уточнить рискованные допущения →')
                : null,
            el('button', {
                class: 'btn btn-primary',
                title: 'Закрыть (Esc)',
                onClick: onClose
            }, 'Закрыть')
        )
    });
}

/* ============================================================
 * Тело модалки
 * ============================================================ */

function renderBody(calc, ctx, onClose, filterFieldIds) {
    const register = buildAssumptionsRegister(calc);
    const filtered = filterFieldIds
        ? register.filter(a => filterFieldIds.includes(a.fieldId))
        : register;

    const groups  = groupAssumptionsBySource(filtered);
    const risky   = getRiskyAssumptions(filtered);

    return el('div', null,
        filterFieldIds && filterFieldIds.length > 0
            ? el('div', { class: 'assumptions-register-filter-notice' },
                `Показаны ${filtered.length} из ${register.length} полей (из связанного нарушения)`
              )
            : null,
        renderSourcesSection(groups, ctx, onClose),
        renderRiskySection(risky, ctx, onClose),
        renderPricesSection(calc)
    );
}

/* ============================================================
 * Секция 1: Источники данных
 * ============================================================ */

function renderSourcesSection(groups, ctx, onClose) {
    const total   = groups.manual.length + groups.quick_start.length + groups.default.length;
    const summary = [
        groups.manual.length      > 0 ? `${groups.manual.length} вручную`      : null,
        groups.quick_start.length > 0 ? `${groups.quick_start.length} из мастера` : null,
        groups.default.length     > 0 ? `${groups.default.length} по умолчанию`   : null
    ].filter(Boolean).join(' · ');

    return el('section', { class: 'assumptions-register-section' },
        el('h4', { class: 'assumptions-register-section-header', text: `Источники данных (${total})` }),
        total > 0
            ? el('div', { class: 'assumptions-register-section-body' },
                el('p', { class: 'assumptions-register-section-summary', text: summary }),
                ...['manual', 'quick_start', 'default'].map(src =>
                    renderSourceGroup(src, groups[src], ctx, onClose)
                )
              )
            : el('p', { class: 'assumptions-register-empty', text: 'Вопросов не найдено.' })
    );
}

function renderSourceGroup(source, items, ctx, onClose) {
    if (!items || items.length === 0) return null;
    return el('div', { class: 'assumption-source-group' },
        el('div', { class: 'assumption-source-group-header' },
            el('span', {
                class: ['assumption-source-badge', `assumption-source-badge--${source}`],
                text: SOURCE_LABELS[source] || source
            }),
            el('span', { class: 'assumption-source-group-count', text: String(items.length) })
        ),
        el('div', { class: 'assumption-source-group-cards' },
            ...items.map(a => renderAssumptionCard(a, ctx, onClose))
        )
    );
}

/* ============================================================
 * Секция 2: Рискованные допущения
 * ============================================================ */

function renderRiskySection(risky, ctx, onClose) {
    return el('section', { class: 'assumptions-register-section' },
        el('h4', { class: 'assumptions-register-section-header',
            text: `Рискованные допущения (${risky.length})` }),
        risky.length === 0
            ? el('p', { class: 'assumptions-register-empty',
                text: 'Все ключевые параметры заполнены — рискованных допущений нет.' })
            : el('div', { class: 'assumptions-register-section-body' },
                ...risky.map(a => renderAssumptionCard(a, ctx, onClose))
              )
    );
}

/* ============================================================
 * Секция 3: Прайсы
 * ============================================================ */

function renderPricesSection(calc) {
    const pv = calc?.providerVersion;
    if (!pv) return null;

    const ts = pv.timestamp
        ? new Date(pv.timestamp).toLocaleDateString('ru-RU')
        : 'неизвестно';

    return el('section', { class: 'assumptions-register-section assumptions-prices-section' },
        el('h4', { class: 'assumptions-register-section-header', text: 'Прайсы' }),
        el('div', { class: 'assumptions-register-section-body' },
            el('p', { text: `Провайдер: ${pv.id || '—'}` }),
            el('p', { text: `Версия прайса: ${pv.version || '—'}` }),
            el('p', { text: `Обновлено: ${ts}` })
        )
    );
}

/* ============================================================
 * Карточка допущения
 * ============================================================ */

function renderAssumptionCard(a, ctx, onClose) {
    const valueText = a.value == null ? 'Не задано' : String(a.value);

    return el('article', {
        class: ['assumption-card', `assumption-confidence-${a.confidence}`]
    },
        el('div', { class: 'assumption-card-label', text: a.label }),
        el('div', { class: 'assumption-card-value', text: valueText }),
        el('div', { class: 'assumption-card-reason', text: a.reason }),
        el('button', {
            class: 'btn btn-ghost assumption-card-navigate',
            attrs: { type: 'button' },
            title: 'Перейти к полю в опроснике',
            onClick: () => {
                onClose();
                if (typeof ctx.focusQuestion === 'function') ctx.focusQuestion(a.fieldId);
                else if (typeof ctx.setActiveTab === 'function') ctx.setActiveTab('questionnaire');
            }
        }, 'Перейти к полю →')
    );
}

/* ============================================================
 * Empty state (нет активного расчёта)
 * ============================================================ */

function renderEmpty() {
    return el('div', { class: 'assumptions-register-empty' },
        el('p', { text: 'Откройте расчёт, чтобы увидеть список допущений.' })
    );
}
