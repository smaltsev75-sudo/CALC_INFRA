/**
 * Stage 18.1 Phase 2/3 (v2.13.0) — controller для модалки «План оптимизации
 * стоимости».
 *
 * Layer: controllers/ — связывает UI-события с domain-функциями и store.
 *
 * Phase 2: открытие/закрытие, switch level, toggle constraint, update / remove /
 * reset draft values. Никакой мутации activeCalc.
 *
 * Phase 3: apply / rollback / inline high-risk confirm.
 *   - applyOptimizationDraftAction:
 *       1. Если draft содержит high-risk changes — patchModal({ confirming: true })
 *          и UI рендерит inline warning. Реальный apply не выполняется до confirm.
 *       2. Иначе сразу выполняется apply pipeline (см. _runApply).
 *   - confirmOptimizationApply / cancelOptimizationApplyConfirm — две стороны
 *     inline-подтверждения.
 *   - rollbackOptimizationApply — restore из lastApplySnapshot через
 *     store.updateActiveCalc + commitActiveCalc; rebuild draft.
 *
 * Жизненный цикл draft (per Stage 18.1 спек, пункт 8б):
 *   - При первом openModal — createOptimizationDraft({ calc, level: ambitious }).
 *   - При закрытии — patchModal({ open: false }) сохраняет draft в state.modals.*.
 *   - При повторном openModal — переиспользуем сохранённый draft, recompute preview.
 *   - F5 → draft и lastApplySnapshot теряются (runtime-only, без persist).
 *
 * Семантика level/constraints — гибрид (пункт 2в): первый openModal применяет
 * defaults уровня, дальнейший switchLevel перетирает untouched-constraints и
 * сохраняет touched.
 */

import { store } from '../state/store.js';
import { commitActiveCalc } from '../services/calcPersistence.js';
import * as calcCtl from './calcController.js';
import { PERIOD_IDS, DEFAULT_PERIOD } from '../utils/constants.js';
import {
    createOptimizationDraft,
    switchOptimizationDraftLevel,
    toggleOptimizationDraftConstraint,
    updateOptimizationDraftValue as domainUpdateValue,
    removeOptimizationDraftChange as domainRemoveChange,
    resetOptimizationDraft as domainResetDraft,
    recomputeOptimizationDraft,
    applyOptimizationDraft as domainApplyDraft,
    calcFromApplySnapshot,
    draftHasHighRisk,
    groupOptimizationLevers,
    OPTIMIZATION_LEVER_GROUPS,
    DEFAULT_LEVEL
} from '../domain/costOptimizationPlanner.js';

const MODAL_NAME = 'costOptimizationPlanner';

/* ============================================================
 * Open / close
 * ============================================================ */

/**
 * Открыть модалку. Если draft уже существует (модалка закрывалась без reset)
 * — переиспользуем его и пересчитываем preview против текущего calc. Иначе
 * создаём свежий draft на уровне `ambitious`.
 */
export function openCostOptimizationPlannerModal() {
    const state = store.getState();
    const calc = state.activeCalc;
    if (!calc) return;
    const cur = state.modals[MODAL_NAME];
    let draft = cur?.draft || null;
    if (!draft) {
        draft = createOptimizationDraft({ calc, level: DEFAULT_LEVEL });
    } else {
        /* calc мог измениться, пока модалка была закрыта — обновим preview. */
        draft = recomputeOptimizationDraft(draft, calc);
    }
    /* lastApplySnapshot переиспользуется из предыдущего сеанса (Phase 3
       будет использовать для rollback). В Phase 2 — просто пробрасываем.
       viewPeriod — независимый от дашборда период отображения сумм Итога;
       при первом открытии инициализируем текущим period дашборда (если он
       задан), иначе — DEFAULT_PERIOD. */
    const initialPeriod = PERIOD_IDS.includes(cur?.viewPeriod)
        ? cur.viewPeriod
        : (PERIOD_IDS.includes(state.ui?.dashboardPeriod)
            ? state.ui.dashboardPeriod
            : DEFAULT_PERIOD);
    /* Stage 18.1.1 — accordion lever-groups. Если openGroups уже выбраны
       пользователем (reopen после patchModal(open:false)) — сохраняем выбор;
       иначе строим разумный дефолт по текущему draft: группы с changes
       или с доступными levers открыты, blocked — закрыты. */
    const initialOpenGroups = Array.isArray(cur?.openGroups)
        ? cur.openGroups.filter(id => OPTIMIZATION_LEVER_GROUPS.some(g => g.id === id))
        : _defaultOpenGroups(calc, draft);
    store.openModal(MODAL_NAME, {
        draft,
        lastApplySnapshot: cur?.lastApplySnapshot || null,
        viewPeriod: initialPeriod,
        openGroups: initialOpenGroups
    });
}

function _defaultOpenGroups(calc, draft) {
    const groups = groupOptimizationLevers(calc, draft);
    return groups
        .filter(g => g.changedCount > 0 || (!g.blocked && g.availableLeverCount > 0))
        .map(g => g.id);
}

/**
 * Закрыть модалку. Сохраняем draft в runtime state через patchModal — так
 * пользователь, открыв модалку повторно, продолжит с того же места (8б).
 */
export function closeCostOptimizationPlannerModal() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open) return;
    store.patchModal(MODAL_NAME, { open: false });
}

/* ============================================================
 * Editing actions — все идут через domain-функции (pure) и patchModal
 * ============================================================ */

export function setOptimizationLevel(level) {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return;
    const next = switchOptimizationDraftLevel(cur.draft, level, state.activeCalc);
    if (next === cur.draft) return;
    store.patchModal(MODAL_NAME, { draft: next });
}

export function toggleOptimizationConstraint(key, value) {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return;
    const next = toggleOptimizationDraftConstraint(cur.draft, key, !!value, state.activeCalc);
    if (next === cur.draft) return;
    store.patchModal(MODAL_NAME, { draft: next });
}

export function updateOptimizationDraftValue(fieldId, value) {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return;
    const next = domainUpdateValue(cur.draft, fieldId, value, state.activeCalc);
    if (next === cur.draft) return;
    store.patchModal(MODAL_NAME, { draft: next });
}

export function removeOptimizationDraftChange(fieldId) {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return;
    const next = domainRemoveChange(cur.draft, fieldId, state.activeCalc);
    if (next === cur.draft) return;
    store.patchModal(MODAL_NAME, { draft: next });
}

/**
 * Stage 18.1.1 — toggle accordion lever-группы. Идемпотентно: вторая команда
 * с тем же groupId сворачивает группу. Невалидный groupId — no-op.
 *
 * НЕ трогает draft / constraints / расчёт. Только UI-аккордеон.
 */
export function toggleOptimizationLeverGroup(groupId) {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open) return;
    if (!OPTIMIZATION_LEVER_GROUPS.some(g => g.id === groupId)) return;
    const open = Array.isArray(cur.openGroups) ? cur.openGroups : [];
    const next = open.includes(groupId)
        ? open.filter(id => id !== groupId)
        : [...open, groupId];
    store.patchModal(MODAL_NAME, { openGroups: next });
}

/**
 * Сменить период отображения сумм в карточках «Итог» (день / месяц / год).
 * Не влияет на draft / calc / расчёт — только на форматирование чисел.
 */
export function setOptimizationViewPeriod(period) {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open) return;
    if (!PERIOD_IDS.includes(period)) return;
    if (cur.viewPeriod === period) return;
    store.patchModal(MODAL_NAME, { viewPeriod: period });
}

export function resetOptimizationDraft() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return;
    const next = domainResetDraft(cur.draft, state.activeCalc);
    if (next === cur.draft) return;
    store.patchModal(MODAL_NAME, { draft: next, confirming: false });
}

/* ============================================================
 * Phase 3 — Apply / Rollback / Inline confirm
 * ============================================================ */

/**
 * Триггер кнопки «Применить изменения».
 *   - Если draft содержит high-risk changes — открываем inline-подтверждение
 *     (patchModal({ confirming: true })), apply откладывается.
 *   - Иначе — немедленный apply через _runApply.
 *
 * Возвращает result-объект для app.js, чтобы тот показал snackbar:
 *   { ok: true, applied: number, savingPercent: number }
 *   { ok: false, reason: 'no_changes'|'high_risk_pending'|'recompute_failed'|... }
 *
 * Idempotent: повторный вызов при confirming=true возвращает
 * { ok: false, reason: 'high_risk_pending' }.
 */
export function applyOptimizationDraftAction() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return { ok: false, reason: 'no_draft' };
    if (cur.confirming) return { ok: false, reason: 'high_risk_pending' };
    if (!cur.draft.changes || Object.keys(cur.draft.changes).length === 0) {
        return { ok: false, reason: 'no_changes' };
    }
    if (draftHasHighRisk(cur.draft)) {
        store.patchModal(MODAL_NAME, { confirming: true });
        return { ok: false, reason: 'high_risk_pending' };
    }
    return _runApply();
}

/**
 * Inline-подтверждение high-risk changes. Закрывает confirmation-panel и
 * запускает apply pipeline. Возвращает result-объект как applyOptimizationDraftAction.
 */
export function confirmOptimizationApply() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.confirming) return { ok: false, reason: 'not_confirming' };
    return _runApply();
}

/**
 * Отмена inline-подтверждения. Draft не трогаем, Apply-pipeline не запускается.
 * Возвращает true/false для логирования в app.js (snackbar обычно не нужен).
 */
export function cancelOptimizationApplyConfirm() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.confirming) return false;
    store.patchModal(MODAL_NAME, { confirming: false });
    return true;
}

/**
 * Откатить последнее применение. Восстанавливает settings/answers/answersMeta
 * из lastApplySnapshot, persist'ит через commitActiveCalc, обнуляет snapshot.
 *
 * Возвращает { ok: true } или { ok: false, reason } — app.js покажет snackbar.
 *
 * Rollback — session-only (4а): после F5 snapshot теряется (live в
 * state.modals.*, не в localStorage).
 */
export function rollbackOptimizationApply() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open) return { ok: false, reason: 'modal_closed' };
    const snapshot = cur.lastApplySnapshot;
    if (!snapshot) return { ok: false, reason: 'no_snapshot' };

    const calc = state.activeCalc;
    if (!calc) return { ok: false, reason: 'no_calc' };

    /* Восстанавливаем mutable-поля calc одним апдейтом — обходим
       setSetting/setAnswer (они вызывают cascade / answersMeta-логику, что для
       rollback нежелательно). Это допустимо потому что snapshot заведомо
       был валидным состоянием (apply уже его пропустил через calculate). */
    const restored = calcFromApplySnapshot(calc, snapshot);
    store.updateActiveCalc({
        settings:    restored.settings,
        answers:     restored.answers,
        answersMeta: restored.answersMeta
    });
    const persisted = store.getState().activeCalc;
    if (persisted) commitActiveCalc(persisted);

    /* Пересоздаём свежий draft на восстановленном calc (baseSnapshot должен
       отражать актуальное состояние). Сохраняем level и touched-constraints —
       пользователь не должен заново их выбирать. */
    const prevDraft = cur.draft;
    const newDraft = createOptimizationDraft({
        calc: persisted || calc,
        level: prevDraft?.level || DEFAULT_LEVEL,
        constraintsOverride: prevDraft?.constraints || null,
        touchedConstraints: prevDraft?.touchedConstraints || {}
    });

    store.patchModal(MODAL_NAME, {
        draft: newDraft,
        lastApplySnapshot: null,
        confirming: false
    });

    return { ok: true };
}

/* ============================================================
 * Internals
 * ============================================================ */

/**
 * Прогнать draft через apply-pipeline. Pure-domain функция строит patches +
 * snapshot и валидирует через clone+calculate. Если ok — диспатчим patches
 * через стандартные сеттеры (per Stage 18.1 спек, пункт 11а), сохраняем
 * snapshot в state.modals.* для rollback.
 *
 * Каждый patch идёт через setSetting / setAnswer (calcController) — то есть
 * через debounced commit + scenario mirror, как любые ручные правки.
 */
function _runApply() {
    const state = store.getState();
    const cur = state.modals[MODAL_NAME];
    if (!cur?.open || !cur.draft) return;
    const calc = state.activeCalc;
    if (!calc) return;

    const result = domainApplyDraft(cur.draft, calc);
    if (!result.ok) {
        store.patchModal(MODAL_NAME, { confirming: false });
        return { ok: false, reason: result.reason, error: result.error };
    }

    /* Дисппатчим patches через стандартные setters. Они commit-ят через
       debounce, поэтому в localStorage окажется финальное состояние. */
    const summary = _dispatchPatches(result.patches);

    /* Сохраняем snapshot для rollback, очищаем draft.changes (они теперь
       применены), пересчитываем preview против нового состояния calc.
       Level/constraints/touched — оставляем. */
    const updatedCalc = store.getState().activeCalc;
    const clearedDraft = recomputeOptimizationDraft(
        domainResetDraft(cur.draft, updatedCalc),
        updatedCalc
    );

    store.patchModal(MODAL_NAME, {
        draft: clearedDraft,
        lastApplySnapshot: result.snapshot,
        confirming: false
    });

    return {
        ok: true,
        applied: summary.applied,
        failed:  summary.failed,
        savingPercent: result.preview?.savingPercent ?? 0
    };
}

/**
 * Развести patch-list по setSetting / setAnswer. Возвращает summary для
 * snackbar. Каждый сеттер commit-ит сам (debounced).
 *
 * Для kind='setting_path' собираем вложенный объект через current state.
 */
function _dispatchPatches(patches) {
    let applied = 0;
    let failed = 0;
    for (const p of patches) {
        try {
            if (p.kind === 'setting') {
                calcCtl.setSetting(p.key, p.value);
                applied++;
            } else if (p.kind === 'setting_path') {
                const segs = p.key.split('.');
                if (segs.length !== 2) { failed++; continue; }
                const [rootKey, subKey] = segs;
                const cur = store.getState().activeCalc?.settings?.[rootKey];
                const merged = { ...(cur && typeof cur === 'object' ? cur : {}), [subKey]: p.value };
                calcCtl.setSetting(rootKey, merged);
                applied++;
            } else if (p.kind === 'answer') {
                calcCtl.setAnswer(p.key, p.value);
                applied++;
            } else {
                failed++;
            }
        } catch (_e) {
            failed++;
        }
    }
    return { applied, failed };
}

