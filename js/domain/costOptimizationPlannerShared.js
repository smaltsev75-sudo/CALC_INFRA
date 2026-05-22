/**
 * Shared pure helpers for Cost Optimization Planner.
 *
 * This module is intentionally UI-free: it only knows how to map lever specs
 * to calc fields and how to derive proposed numeric values.
 */

import { CATEGORY_TO_GROUP } from './costOptimizationPlannerConfig.js';

/* groupId для одного spec'а. Возвращает null если spec не имеет category или
   category не зарегистрирован (defensive — не должно случаться). */
export function getLeverGroupId(spec) {
    if (!spec || typeof spec.category !== 'string') return null;
    return CATEGORY_TO_GROUP[spec.category] || null;
}

export function cloneCalc(calc) {
    return JSON.parse(JSON.stringify(calc));
}

export function readCurrentValue(calc, spec) {
    if (spec.kind === 'settings_ratio') {
        return Number(calc?.settings?.standSizeRatio?.[spec.stand] ?? NaN);
    }
    if (spec.kind === 'settings_field' || spec.kind === 'settings_step') {
        return Number(calc?.settings?.[spec.field] ?? NaN);
    }
    return Number(calc?.answers?.[spec.field] ?? NaN);
}

export function applyToClone(clone, spec, newValue) {
    if (spec.kind === 'settings_ratio') {
        clone.settings = { ...clone.settings };
        clone.settings.standSizeRatio = { ...clone.settings.standSizeRatio, [spec.stand]: newValue };
        return;
    }
    if (spec.kind === 'settings_field' || spec.kind === 'settings_step') {
        clone.settings = { ...clone.settings, [spec.field]: newValue };
        return;
    }
    clone.answers = { ...clone.answers, [spec.field]: newValue };
}

export function computeProposedValue(spec, currentValue, tierId, constraints) {
    if (typeof spec.proposedValue === 'function') {
        return spec.proposedValue(currentValue, tierId);
    }
    if (spec.kind === 'answer_options_step') {
        const idx = spec.options.indexOf(currentValue);
        if (idx <= 0) return null;
        const stepN = spec.steps?.[tierId] || 0;
        if (stepN <= 0) return null;
        const targetIdx = Math.max(0, idx - stepN);
        let candidate = spec.options[targetIdx];
        const floor = (spec.complianceFloor != null && constraints.protectCompliance)
            ? Math.max(spec.floor ?? -Infinity, spec.complianceFloor)
            : (spec.floor ?? -Infinity);
        if (candidate < floor) {
            const allowed = spec.options.filter(v => v >= floor);
            if (allowed.length === 0) return null;
            candidate = Math.min(...allowed.filter(v => v < currentValue), currentValue);
            if (candidate >= currentValue) return null;
        }
        if (candidate >= currentValue) return null;
        return candidate;
    }

    const mult = spec.multipliers?.[tierId];
    if (!Number.isFinite(mult) || mult >= 1) return null;
    let candidate = currentValue * mult;
    const floor = spec.floor;
    if (Number.isFinite(floor) && candidate < floor) candidate = floor;
    if (candidate >= currentValue) return null;
    return candidate;
}
