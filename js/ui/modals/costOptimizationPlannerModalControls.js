import { el } from './../dom.js';
import {
    PLAN_TIERS,
    DEFAULT_LEVEL
} from '../../domain/costOptimizationPlanner.js';
import { CONSTRAINT_TOGGLES } from './costOptimizationPlannerModalFormat.js';

/* ============================================================
 * Level tabs
 * ============================================================ */

export function renderLevelTabs(draft, ctx) {
    const currentLevel = draft.level || DEFAULT_LEVEL;
    return el('section', { class: 'cop-modal-section cop-modal-levels',
        attrs: { 'aria-label': 'Уровень оптимизации' } },
        el('h4', { class: 'cop-modal-section-title', text: 'Уровень оптимизации' }),
        el('div', { class: 'cop-level-tabs', attrs: { role: 'tablist' } },
            ...PLAN_TIERS.map(tier => renderLevelTab(tier, currentLevel, ctx))
        )
    );
}

function renderLevelTab(tier, currentLevel, ctx) {
    const isActive = tier.id === currentLevel;
    const rangeStr = `${tier.range.minPercent}–${tier.range.maxPercent}%`;
    return el('button', {
        class: ['cop-level-tab', isActive && 'is-active', `cop-level-${tier.id}`],
        attrs: {
            type: 'button',
            role: 'tab',
            'aria-selected': isActive ? 'true' : 'false',
            title: `${tier.title} — экономия ${rangeStr}. ${tier.description}`
        },
        onClick: () => { if (!isActive) ctx.setOptimizationLevel(tier.id); }
    },
        el('span', { class: 'cop-level-tab-title', text: tier.title }),
        el('span', { class: 'cop-level-tab-range', text: rangeStr })
    );
}

/* ============================================================
 * Constraints
 * ============================================================ */

export function renderConstraintsBlock(draft, ctx) {
    const constraints = draft.constraints || {};
    const touched = draft.touchedConstraints || {};
    return el('section', { class: 'cop-modal-section cop-modal-constraints',
        attrs: { 'aria-label': 'Ограничения' } },
        el('h4', { class: 'cop-modal-section-title', text: 'Ограничения' }),
        el('p', { class: 'cop-modal-section-hint',
            text: 'Уровень задаёт начальный набор. Ваши изменения сохраняются при переключении уровня.' }),
        el('div', { class: 'cop-modal-constraints-grid' },
            ...CONSTRAINT_TOGGLES.map(c =>
                renderConstraintToggle(c, !!constraints[c.key], !!touched[c.key], ctx)
            )
        )
    );
}

function renderConstraintToggle(c, value, isTouched, ctx) {
    return el('label', {
        class: ['cop-modal-constraint', value && 'cop-modal-constraint-on'],
        attrs: { title: c.hint }
    },
        el('input', {
            type: 'checkbox',
            checked: value,
            attrs: { 'data-focus-key': `cop-constraint-${c.key}` },
            onChange: e => ctx.toggleOptimizationConstraint(c.key, !!e.target.checked)
        }),
        el('span', { class: 'cop-modal-constraint-label', text: c.label }),
        isTouched
            ? el('span', { class: 'cop-modal-constraint-touched',
                attrs: { title: 'Вы явно выбрали этот вариант — переключение уровня его не перетрёт' },
                text: '·' })
            : null
    );
}
