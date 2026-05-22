/**
 * Stage 18.1 — Cost Optimization Planner.
 *
 * Pure-domain модуль: получает calc + constraints, возвращает 3 готовых плана
 * оптимизации (Консервативный / Амбициозный / Экстремальный) с lever'ами,
 * экономией, рисками, последствиями и переходами к полям.
 *
 * Принципы:
 *   - НЕ мутирует calc. Все «что было бы, если» — через clone + calculate(clone, null).
 *   - НЕ применяет изменения. Levers содержат предлагаемые `from → to`, но
 *     пользователь сам идёт в Опросник через ctx.focusQuestion.
 *   - Гибок к схеме: каждый lever имеет appliesIf check; если поля нет — пропуск,
 *     не падение. Lever НЕ показывается, если master-toggle (ai_llm_used /
 *     rag_needed) выключен.
 *   - Constraints как фильтры: пользователь может запретить категорию (SLA,
 *     non-prod, AI и т.п.); такие levers не предлагаются.
 *   - SLA НЕ входит в conservative — он не «безболезненный» рычаг.
 *
 * Layer: pure domain. Не импортирует ui/ controllers/ state/ services/.
 */

import { calculate } from './calculator.js';
import { SETTINGS_DESCRIPTIONS } from '../utils/constants.js';
import {
    PLAN_TIERS,
    DEFAULT_CONSTRAINTS,
    LEVEL_DEFAULT_CONSTRAINTS,
    DEFAULT_LEVEL,
    OPTIMIZATION_LEVER_GROUPS,
    HIGH_RISK_LEVER_SPEC_IDS,
    LEVER_SPECS
} from './costOptimizationPlannerConfig.js';
import {
    cloneCalc,
    computeProposedValue,
    getLeverGroupId
} from './costOptimizationPlannerShared.js';

export {
    PLAN_IDS,
    PLAN_TIERS,
    DEFAULT_CONSTRAINTS,
    LEVEL_DEFAULT_CONSTRAINTS,
    DEFAULT_LEVEL,
    OPTIMIZATION_LEVER_GROUPS,
    HIGH_RISK_LEVER_SPEC_IDS,
    RECOMPUTE_DEBOUNCE_MS
} from './costOptimizationPlannerConfig.js';

/* Config is imported/re-exported from costOptimizationPlannerConfig.js. */
export { getLeverGroupId } from './costOptimizationPlannerShared.js';
export {
    buildOptimizationLevers,
    buildOptimizationPlans,
    rankOptimizationPlans,
    summarizeOptimizationPlan,
    getOptimizationFeasibility
} from './costOptimizationPlannerPlans.js';
/* ============================================================
 * Stage 18.1 (v2.13.0) — Draft API
 *
 * Pure-domain draft мутаций: пользователь редактирует значения в модалке,
 * domain считает preview через clone+calculate. НИ ОДНА функция здесь не
 * мутирует исходный calc — applyOptimizationDraft возвращает patch-list,
 * который controller-слой превращает в setSetting/setAnswer.
 *
 * Соглашение fieldId: '<kind>:<path>', где kind ∈ {'setting','answer'}:
 *   'setting:standSizeRatio.LOAD'  → calc.settings.standSizeRatio.LOAD
 *   'setting:bufferTask'           → calc.settings.bufferTask
 *   'answer:sla_target'            → calc.answers.sla_target
 * ============================================================ */

/* ---------- fieldId <-> spec helpers ---------- */

const LEVER_SPECS_BY_ID = (() => {
    const m = new Map();
    for (const s of LEVER_SPECS) m.set(s.id, s);
    return m;
})();

function specFromFieldId(fieldId) {
    if (!fieldId) return null;
    for (const s of LEVER_SPECS) {
        if (s.focusFieldId === fieldId) return s;
    }
    return null;
}

function applyFieldIdToClone(clone, fieldId, value) {
    if (!fieldId || !clone) return clone;
    if (fieldId.startsWith('setting:')) {
        const path = fieldId.slice('setting:'.length);
        const segs = path.split('.');
        clone.settings = { ...(clone.settings || {}) };
        if (segs.length === 1) {
            clone.settings[segs[0]] = value;
        } else if (segs.length === 2) {
            clone.settings[segs[0]] = { ...(clone.settings[segs[0]] || {}), [segs[1]]: value };
        } else {
            /* >2 уровней не используется текущими LEVER_SPECS, но defensive: deep-set */
            let node = clone.settings;
            for (let i = 0; i < segs.length - 1; i++) {
                node[segs[i]] = { ...(node[segs[i]] || {}) };
                node = node[segs[i]];
            }
            node[segs[segs.length - 1]] = value;
        }
        return clone;
    }
    if (fieldId.startsWith('answer:')) {
        const id = fieldId.slice('answer:'.length);
        clone.answers = { ...(clone.answers || {}), [id]: value };
        return clone;
    }
    return clone;
}

function readFieldIdFromCalc(calc, fieldId) {
    if (!calc || !fieldId) return undefined;
    if (fieldId.startsWith('setting:')) {
        const path = fieldId.slice('setting:'.length).split('.');
        let node = calc.settings;
        for (const seg of path) {
            if (node == null) return undefined;
            node = node[seg];
        }
        return node;
    }
    if (fieldId.startsWith('answer:')) {
        return calc.answers?.[fieldId.slice('answer:'.length)];
    }
    return undefined;
}

/**
 * SLA-options из активного словаря (Q.sla_target). Спек запрещает hardcode —
 * если вопрос отсутствует или его options некорректны, SLA-lever скрывается.
 *
 * @returns {number[]|null} sorted ascending или null
 */
export function getSlaOptionsFromCalc(calc) {
    const q = (calc?.dictionaries?.questions || []).find(x => x?.id === 'sla_target');
    if (!q || !Array.isArray(q.options) || q.options.length === 0) return null;
    const nums = q.options
        .map(o => (typeof o === 'object' ? Number(o.value) : Number(o)))
        .filter(v => Number.isFinite(v));
    if (nums.length === 0) return null;
    return [...nums].sort((a, b) => a - b);
}

function targetRangeOfLevel(level) {
    const t = PLAN_TIERS.find(x => x.id === level);
    return t ? { ...t.range } : { minPercent: 0, maxPercent: 0 };
}

function snapshotCalc(calc) {
    /* Снимок частей, которые меняются apply-pipeline'ом: settings, answers,
       answersMeta. Прочие поля (dictionaries, view, scenarios) draft не
       трогает, поэтому в snapshot не входят — экономим память. */
    if (!calc) return null;
    return {
        settings:    JSON.parse(JSON.stringify(calc.settings || {})),
        answers:     JSON.parse(JSON.stringify(calc.answers || {})),
        answersMeta: JSON.parse(JSON.stringify(calc.answersMeta || {}))
    };
}

/* ---------- Constraint cleanup ---------- */

/**
 * Удалить из draft.changes те fieldId, чьи levers больше не доступны при
 * текущих constraints или level. Вызывается при toggle constraint и при
 * switch level.
 */
function pruneChangesForGating(changes, level, constraints) {
    const out = {};
    for (const [fieldId, change] of Object.entries(changes || {})) {
        const spec = LEVER_SPECS_BY_ID.get(change.leverSpecId) || specFromFieldId(fieldId);
        if (!spec) {
            /* Spec пропал из реестра — сохраняем (защитно), но это бы значило
               программную ошибку. */
            out[fieldId] = change;
            continue;
        }
        /* Constraint-gate */
        if (spec.constraintKey && !constraints[spec.constraintKey]) continue;
        /* skipInTiers */
        if (Array.isArray(spec.skipInTiers) && spec.skipInTiers.includes(level)) continue;
        out[fieldId] = change;
    }
    return out;
}

/* ---------- Editable lever building (для редактора в модалке) ---------- */

/**
 * Текущее значение поля с учётом drafted changes: если в draft есть change для
 * этого fieldId — берём draft.value; иначе — из calc.
 */
function effectiveValue(calc, draft, fieldId) {
    const change = draft?.changes?.[fieldId];
    if (change && Number.isFinite(change.to)) return change.to;
    const raw = readFieldIdFromCalc(calc, fieldId);
    return Number.isFinite(Number(raw)) ? Number(raw) : NaN;
}

function deriveStepForSpec(spec) {
    if (spec.kind === 'settings_ratio') return 0.05;
    if (spec.kind === 'settings_field') return 0.01;
    if (spec.kind === 'settings_step')  return 1;       // planning_horizon
    if (spec.field === 'ai_avg_output_tokens')   return 50;
    if (spec.field === 'rag_corpus_size_gb')     return 1;
    if (spec.field === 'rag_embeddings_million') return 0.1;
    return 1;
}

function buildEditorMeta(spec, calc, baseSnapshotValue, currentValue, constraints) {
    /* baseSnapshotValue — значение НА МОМЕНТ создания draft (для max-limit:
       мы не позволяем оптимизатору УВЕЛИЧИВАТЬ значения, только уменьшать,
       поэтому max = baseSnapshotValue, а не текущее editingValue — иначе
       пользователь, уменьшив до 50%, не сможет вернуть до 80%). */
    const step = deriveStepForSpec(spec);
    if (spec.kind === 'answer_options_step') {
        if (spec.field === 'sla_target') {
            const all = getSlaOptionsFromCalc(calc) || [];
            const opts = all.filter(v => v <= baseSnapshotValue);
            return { editorType: 'enum', options: opts, step: null, min: opts[0] ?? null, max: baseSnapshotValue };
        }
        /* backup_retention: complianceFloor если protectCompliance */
        const allowedFloor = spec.complianceFloor != null && constraints.protectCompliance
            ? Math.max(spec.floor ?? -Infinity, spec.complianceFloor)
            : (spec.floor ?? -Infinity);
        const opts = (spec.options || []).filter(v => v >= allowedFloor && v <= baseSnapshotValue);
        return { editorType: 'enum', options: opts, step: null, min: opts[0] ?? null, max: baseSnapshotValue };
    }
    if (spec.kind === 'settings_step') {
        return { editorType: 'number_int', min: 3, max: baseSnapshotValue, step: 1, options: null };
    }
    if (spec.kind === 'settings_ratio') {
        return { editorType: 'percent', min: spec.floor ?? 0, max: baseSnapshotValue, step, options: null };
    }
    if (spec.kind === 'settings_field') {
        return { editorType: 'percent', min: spec.floor ?? 0, max: baseSnapshotValue, step, options: null };
    }
    if (spec.kind === 'answer_field') {
        const isInt = spec.field === 'ai_avg_output_tokens';
        return {
            editorType: isInt ? 'number_int' : 'number_float',
            min: spec.floor ?? 0,
            max: baseSnapshotValue,
            step,
            options: null
        };
    }
    return { editorType: 'number_float', min: 0, max: baseSnapshotValue, step: 1, options: null };
}

function suggestedValueForSpec(spec, currentValue, level, constraints) {
    /* Использует уже существующий computeProposedValue — он применяет multipliers
       или options-step, с учётом complianceFloor. */
    return computeProposedValue(spec, currentValue, level, constraints);
}

/* ---------- Stage 18.2.x / PATCH 2.14.17: description + unit для рычагов ----------
 *
 * Источник правды для description — metadata модели (SETTINGS_DESCRIPTIONS из
 * constants.js для settings; calc.dictionaries.questions[].description для
 * answers). LEVER_SPECS.description — fallback, если metadata недоступна.
 * Это устраняет дубликат текстов («буфер задачи» описывался бы в двух местах
 * с риском рассинхрона). */

/**
 * Найти description для рычага по metadata модели.
 *
 * Алгоритм:
 *   1. setting:<root>[.<sub>]   → SETTINGS_DESCRIPTIONS[<root>]
 *   2. answer:<questionId>      → calc.dictionaries.questions[id=<qid>].description
 *   3. иначе                    → spec.description (fallback) или ''
 *
 * @param {object} spec     один LEVER_SPECS-объект
 * @param {object} calc     активный расчёт (для questions)
 * @returns {string}        description (может быть пустой строкой)
 */
export function resolveLeverDescription(spec, calc) {
    const fieldId = spec.focusFieldId || '';
    if (fieldId.startsWith('setting:')) {
        const path = fieldId.slice('setting:'.length);
        const root = path.split('.')[0];
        if (SETTINGS_DESCRIPTIONS[root]) return SETTINGS_DESCRIPTIONS[root];
    }
    if (fieldId.startsWith('answer:')) {
        const qid = fieldId.slice('answer:'.length);
        const questions = calc?.dictionaries?.questions || [];
        const q = questions.find(x => x && x.id === qid);
        if (q && q.description) return q.description;
    }
    return spec.description || '';
}

/**
 * Определить отображаемую единицу измерения для рычага.
 *
 * Приоритет:
 *   1. spec.unit (override в LEVER_SPECS, если задан) — для случаев, где
 *      авто-детект неточен.
 *   2. Авто-детект по spec.kind / spec.field.
 *
 * Возвращаемые токены (стабильные строки для UI/тестов):
 *   '% от ПРОМ'   — stand ratios (standSizeRatio.LOAD/PSI/IFT/DEV)
 *   '%'           — risk fractions (bufferTask/bufferProject/kContingency/kScheduleShift), SLA
 *   'года/лет/год' — planning horizon (форматтер UI сам выберет форму по числу)
 *   'дн.'         — backup retention
 *   'токенов'     — ai_avg_output_tokens
 *   'ГБ'          — rag_corpus_size_gb
 *   'млн векторов'— rag_embeddings_million
 *   ''            — единица не определена
 *
 * @param {object} spec
 * @returns {string}
 */
export function deriveLeverUnit(spec) {
    if (typeof spec.unit === 'string') return spec.unit;
    if (spec.kind === 'settings_ratio') return '% от ПРОМ';
    if (spec.kind === 'settings_field' && /^(k|buffer)/.test(spec.field || '')) return '%';
    if (spec.field === 'planningHorizonYears')   return 'лет';
    if (spec.field === 'sla_target')             return '%';
    if (spec.field === 'backup_retention_days')  return 'дн.';
    if (spec.field === 'ai_avg_output_tokens')   return 'токенов';
    if (spec.field === 'rag_corpus_size_gb')     return 'ГБ';
    if (spec.field === 'rag_embeddings_million') return 'млн векторов';
    return '';
}

/**
 * Список рычагов, доступных для редактирования в текущем состоянии draft.
 *
 * Каждый возвращаемый lever содержит editor-metadata (editorType / min / max /
 * step / options) и текущее значение editingValue (либо из drafted change,
 * либо из calc).
 *
 * @param {object} calc
 * @param {object} draft  Draft (level + constraints + changes + baseSnapshot)
 * @returns {EditableLever[]}
 */
export function buildEditableLevers(calc, draft) {
    if (!calc || !draft) return [];
    const out = [];
    for (const spec of LEVER_SPECS) {
        /* constraint-gate */
        if (spec.constraintKey && !draft.constraints[spec.constraintKey]) continue;
        /* skipInTiers */
        if (Array.isArray(spec.skipInTiers) && spec.skipInTiers.includes(draft.level)) continue;
        /* appliesIf (master toggles, horizon>3, и т.д.) — против baseSnapshot,
           чтобы свежий toggle master'а в той же сессии не выдёргивал lever. */
        const baseCalc = draft.baseSnapshot ? hydrateCalcFromSnapshot(calc, draft.baseSnapshot) : calc;
        if (typeof spec.appliesIf === 'function' && !spec.appliesIf(baseCalc)) continue;

        const fieldId = spec.focusFieldId;
        const baseValue = Number(readFieldIdFromCalc(baseCalc, fieldId));
        if (!Number.isFinite(baseValue) || baseValue <= 0) continue;

        const editingValue = effectiveValue(calc, draft, fieldId);
        const editor = buildEditorMeta(spec, calc, baseValue, editingValue, draft.constraints);
        /* Если editor.options пустой / max <= min — рычаг бесполезен (нечего урезать). */
        if (editor.editorType === 'enum' && (!editor.options || editor.options.length <= 1)) continue;
        if (editor.editorType !== 'enum' && !(editor.max > editor.min)) continue;

        const suggested = suggestedValueForSpec(spec, baseValue, draft.level, draft.constraints);

        out.push({
            id: `${spec.id}__${draft.level}`,
            leverSpecId: spec.id,
            title: spec.title,
            /* PATCH 2.14.17: description — primary source = модель (SETTINGS_DESCRIPTIONS
               для settings, calc.dictionaries.questions[].description для answers).
               Fallback — spec.description. resolveLeverDescription гарантирует
               single source of truth: если описание есть в модели, в LEVER_SPECS
               его дублировать не нужно. */
            description: resolveLeverDescription(spec, calc),
            /* PATCH 2.14.17: единица измерения для UI-форматирования. См.
               deriveLeverUnit — '% от ПРОМ', 'лет', 'дн.', 'токенов', и т.п. */
            unit: deriveLeverUnit(spec),
            category: spec.category,
            groupId: getLeverGroupId(spec),
            riskLevel: spec.risk,
            consequence: spec.consequence,
            fieldId,
            baseValue,
            editingValue: Number.isFinite(editingValue) ? editingValue : baseValue,
            suggestedValue: Number.isFinite(suggested) ? suggested : null,
            editor,
            hasDraftChange: !!draft.changes?.[fieldId]
        });
    }
    return out;
}

/* ---------- Stage 18.1.1 — group levers by impact area ---------- */

const RISK_LEVEL_RANK = { low: 1, medium: 2, high: 3 };

function maxRiskLevel(items, picker = (x) => x?.riskLevel) {
    let best = null;
    for (const it of items) {
        const r = picker(it);
        if (r && (best == null || RISK_LEVEL_RANK[r] > RISK_LEVEL_RANK[best])) best = r;
    }
    return best;
}

function leverSpecBelongsToGroup(spec, groupId) {
    return getLeverGroupId(spec) === groupId;
}

function buildBlockedReason(group) {
    return `Заблокировано: ${group.title.toLowerCase()} запрещены текущими ограничениями.`;
}

/**
 * Stage 18.1.1 — сгруппировать lever'ы по области компромисса.
 *
 * Возвращает массив всех известных групп (OPTIMIZATION_LEVER_GROUPS) с
 * вычисленным summary. Группа НЕ исчезает, если все её lever'ы недоступны —
 * UI всё равно покажет её collapsed с причиной (blocked) или хинтом «нет
 * применимых параметров» (constraint=on, но spec'и отсеяны appliesIf).
 *
 * @returns {Array<{
 *   id: string,
 *   title: string,
 *   description: string,
 *   constraintKey: string|null,
 *   constraintEnableLabel: string|null,
 *   levers: Array<EditableLever>,
 *   changedCount: number,
 *   availableLeverCount: number,
 *   totalSavingRub: number,
 *   maxRiskLevel: 'low'|'medium'|'high'|null,
 *   blocked: boolean,
 *   blockedReason: string|null,
 *   hasAnyApplicableSpec: boolean
 * }>}
 */
export function groupOptimizationLevers(calc, draft) {
    const constraints = draft?.constraints || DEFAULT_CONSTRAINTS;
    const savingByGroup = draft?.preview?.savingByGroup || {};
    const allLevers = buildEditableLevers(calc, draft);
    const leversByGroup = new Map();
    for (const lever of allLevers) {
        const gid = lever.groupId;
        if (!gid) continue;
        if (!leversByGroup.has(gid)) leversByGroup.set(gid, []);
        leversByGroup.get(gid).push(lever);
    }

    /* Пробежимся по LEVER_SPECS и поймём, какие spec'и принадлежат каждой
       группе (для hasAnyApplicableSpec — отличие «заблокировано constraint'ом»
       от «в этой модели нет рычагов этой группы вообще»). */
    const specsByGroup = new Map();
    for (const spec of LEVER_SPECS) {
        const gid = getLeverGroupId(spec);
        if (!gid) continue;
        if (!specsByGroup.has(gid)) specsByGroup.set(gid, []);
        specsByGroup.get(gid).push(spec);
    }

    /* changes по группам — для подсчёта changedCount и риска применённых правок. */
    const changesByGroup = new Map();
    for (const [fieldId, change] of Object.entries(draft?.changes || {})) {
        const spec = LEVER_SPECS_BY_ID.get(change.leverSpecId) || specFromFieldId(fieldId);
        const gid = getLeverGroupId(spec);
        if (!gid) continue;
        if (!changesByGroup.has(gid)) changesByGroup.set(gid, []);
        changesByGroup.get(gid).push({ fieldId, change, spec });
    }

    return OPTIMIZATION_LEVER_GROUPS.map(group => {
        const levers = leversByGroup.get(group.id) || [];
        const groupSpecs = specsByGroup.get(group.id) || [];
        const changes = changesByGroup.get(group.id) || [];
        const blocked = !!(group.constraintKey && !constraints[group.constraintKey]);
        /* maxRisk: если есть изменения — берём максимум по их riskLevel; иначе
           — по доступным рычагам. Для пустой группы — null. */
        const maxRisk = changes.length > 0
            ? maxRiskLevel(changes, c => c.change?.riskLevel || c.spec?.risk)
            : maxRiskLevel(levers);
        return {
            id: group.id,
            title: group.title,
            description: group.description,
            constraintKey: group.constraintKey,
            constraintEnableLabel: group.constraintEnableLabel,
            levers,
            changedCount: changes.length,
            availableLeverCount: levers.length,
            totalSavingRub: Number(savingByGroup[group.id]) || 0,
            maxRiskLevel: maxRisk,
            blocked,
            blockedReason: blocked ? buildBlockedReason(group) : null,
            hasAnyApplicableSpec: groupSpecs.length > 0
        };
    });
}

/* Создаёт виртуальный calc, у которого settings/answers взяты из snapshot;
   нужно для appliesIf-gating относительно baseSnapshot (master-toggle
   ai_llm_used / rag_needed по состоянию на момент открытия модалки). */
function hydrateCalcFromSnapshot(calc, snap) {
    if (!snap) return calc;
    return {
        ...calc,
        settings:    snap.settings    || calc.settings    || {},
        answers:     snap.answers     || calc.answers     || {},
        answersMeta: snap.answersMeta || calc.answersMeta || {}
    };
}

/* ---------- Draft lifecycle ---------- */

/**
 * Создать draft для редактирования. На первом открытии модалки constraints
 * берутся целиком из LEVEL_DEFAULT_CONSTRAINTS[level]; touchedConstraints={}.
 *
 * @param {object} args
 * @param {object} args.calc                       Активный расчёт
 * @param {string} [args.level=DEFAULT_LEVEL]      'conservative' | 'ambitious' | 'extreme'
 * @param {object} [args.constraintsOverride]      Уже выбранные пользователем constraints
 * @param {object} [args.touchedConstraints={}]    Каких constraint'ов касался пользователь
 */
export function createOptimizationDraft({ calc, level = DEFAULT_LEVEL, constraintsOverride = null, touchedConstraints = {} } = {}) {
    const useLevel = LEVEL_DEFAULT_CONSTRAINTS[level] ? level : DEFAULT_LEVEL;
    const levelDefaults = { ...LEVEL_DEFAULT_CONSTRAINTS[useLevel] };
    const constraints = constraintsOverride
        ? { ...levelDefaults, ...constraintsOverride }
        : levelDefaults;
    const touched = { ...touchedConstraints };
    const draft = {
        level: useLevel,
        constraints,
        touchedConstraints: touched,
        baseSnapshot: snapshotCalc(calc),
        changes: {},
        preview: null,
        validation: { errors: [], warnings: [] }
    };
    return recomputeOptimizationDraft(draft, calc);
}

/**
 * Switch level c гибридной семантикой touched/defaults:
 *   - constraints, которые пользователь явно тронул → сохраняются как есть.
 *   - Остальные → перетираются дефолтами нового level.
 * Дополнительно: changes, чьи levers теперь недоступны (constraint-gate либо
 * skipInTiers нового уровня), удаляются.
 */
export function switchOptimizationDraftLevel(draft, newLevel, calc) {
    if (!draft) return draft;
    const useLevel = LEVEL_DEFAULT_CONSTRAINTS[newLevel] ? newLevel : draft.level;
    if (useLevel === draft.level) return draft;
    const newDefaults = LEVEL_DEFAULT_CONSTRAINTS[useLevel];
    const nextConstraints = { ...draft.constraints };
    for (const key of Object.keys(newDefaults)) {
        if (!draft.touchedConstraints[key]) {
            nextConstraints[key] = newDefaults[key];
        }
    }
    const prunedChanges = pruneChangesForGating(draft.changes, useLevel, nextConstraints);
    const next = {
        ...draft,
        level: useLevel,
        constraints: nextConstraints,
        changes: prunedChanges
    };
    return recomputeOptimizationDraft(next, calc);
}

/**
 * Toggle одного constraint. Помечает его как touched (даже если значение не
 * поменялось — пользователь явно подтвердил). Если после toggle какой-то lever
 * больше не доступен — его change удаляется из draft.
 */
export function toggleOptimizationDraftConstraint(draft, key, value, calc) {
    if (!draft || !key) return draft;
    if (!(key in draft.constraints)) return draft;
    const nextConstraints = { ...draft.constraints, [key]: !!value };
    const nextTouched = { ...draft.touchedConstraints, [key]: true };
    const prunedChanges = pruneChangesForGating(draft.changes, draft.level, nextConstraints);
    const next = {
        ...draft,
        constraints: nextConstraints,
        touchedConstraints: nextTouched,
        changes: prunedChanges
    };
    return recomputeOptimizationDraft(next, calc);
}

/**
 * Сбросить touched-флаги и применить defaults для текущего level.
 * Вспомогательно для UX-кнопки «Сбросить ограничения уровня» (опционально).
 */
export function resetOptimizationDraftConstraintsToLevel(draft, calc) {
    if (!draft) return draft;
    const defaults = { ...LEVEL_DEFAULT_CONSTRAINTS[draft.level] };
    const prunedChanges = pruneChangesForGating(draft.changes, draft.level, defaults);
    const next = {
        ...draft,
        constraints: defaults,
        touchedConstraints: {},
        changes: prunedChanges
    };
    return recomputeOptimizationDraft(next, calc);
}

/**
 * Установить новое значение для одного fieldId. Если value совпадает с baseValue
 * — change удаляется (нет смысла хранить no-op). Если value не финитен или вне
 * диапазона editor — change игнорируется (защитный no-op).
 */
export function updateOptimizationDraftValue(draft, fieldId, value, calc) {
    if (!draft || !fieldId) return draft;
    const spec = specFromFieldId(fieldId);
    if (!spec) return draft;
    /* Gate: constraint и skipInTiers — если рычаг недоступен, change не пишем. */
    if (spec.constraintKey && !draft.constraints[spec.constraintKey]) return draft;
    if (Array.isArray(spec.skipInTiers) && spec.skipInTiers.includes(draft.level)) return draft;

    const baseCalc = draft.baseSnapshot ? hydrateCalcFromSnapshot(calc, draft.baseSnapshot) : calc;
    const baseValue = Number(readFieldIdFromCalc(baseCalc, fieldId));
    if (!Number.isFinite(baseValue) || baseValue <= 0) return draft;
    const editor = buildEditorMeta(spec, calc, baseValue, value, draft.constraints);

    /* Валидация по editor.range / options. */
    let normalized = Number(value);
    if (!Number.isFinite(normalized)) return draft;
    if (editor.editorType === 'enum') {
        if (!editor.options.includes(normalized)) return draft;
    } else {
        if (normalized < editor.min - 1e-9 || normalized > editor.max + 1e-9) return draft;
        if (editor.editorType === 'number_int') normalized = Math.round(normalized);
    }

    /* No-op: значение совпадает с baseValue (с допуском). */
    const eps = editor.editorType === 'enum' ? 0 : Math.max(1e-9, (editor.step || 0) / 1000);
    if (Math.abs(normalized - baseValue) <= eps) {
        return removeOptimizationDraftChange(draft, fieldId, calc);
    }

    const nextChanges = {
        ...draft.changes,
        [fieldId]: {
            fieldId,
            from: baseValue,
            to: normalized,
            leverSpecId: spec.id,
            riskLevel: spec.risk
        }
    };
    return recomputeOptimizationDraft({ ...draft, changes: nextChanges }, calc);
}

/**
 * Удалить один change из draft (UI-кнопка «Сбросить параметр»).
 */
export function removeOptimizationDraftChange(draft, fieldId, calc) {
    if (!draft || !fieldId) return draft;
    if (!draft.changes?.[fieldId]) return draft;
    const nextChanges = { ...draft.changes };
    delete nextChanges[fieldId];
    return recomputeOptimizationDraft({ ...draft, changes: nextChanges }, calc);
}

/**
 * Сбросить ВСЕ changes (UI-кнопка «Сбросить изменения»). Level и constraints
 * не трогаем — пользователь оставил выбранный уровень.
 */
export function resetOptimizationDraft(draft, calc) {
    if (!draft) return draft;
    return recomputeOptimizationDraft({ ...draft, changes: {} }, calc);
}

/**
 * Пересчитать preview: клонируем calc, применяем все draft.changes, считаем
 * calculate() на clone, формируем preview { before, after, saving, percent,
 * inTargetRange, targetRange }.
 *
 * Если calculate бросает — preview.error = 'calculate_failed' и saving=0.
 * Это закрывает спек-требование «если calculate падает — показать warning и
 * не применять значение».
 */
export function recomputeOptimizationDraft(draft, calc) {
    if (!draft) return draft;
    const range = targetRangeOfLevel(draft.level);
    const emptySavingByGroup = () => {
        const out = {};
        for (const g of OPTIMIZATION_LEVER_GROUPS) out[g.id] = 0;
        return out;
    };
    if (!calc) {
        return {
            ...draft,
            preview: {
                beforeTotalMonthly: 0,
                afterTotalMonthly: 0,
                savingMonthly: 0,
                savingPercent: 0,
                inTargetRange: false,
                targetRange: range,
                savingByGroup: emptySavingByGroup(),
                error: 'no_calc'
            },
            validation: { errors: [], warnings: [] }
        };
    }

    let beforeTotal = 0;
    let baseError = null;
    try {
        beforeTotal = Number(calculate(calc, null)?.totalMonthly) || 0;
    } catch (_e) {
        baseError = 'calculate_base_failed';
    }

    const clone = cloneCalc(calc);
    for (const [fieldId, change] of Object.entries(draft.changes || {})) {
        applyFieldIdToClone(clone, fieldId, change.to);
    }

    let afterTotal = beforeTotal;
    let simError = null;
    if (Object.keys(draft.changes || {}).length > 0) {
        try {
            afterTotal = Number(calculate(clone, null)?.totalMonthly) || 0;
        } catch (_e) {
            afterTotal = beforeTotal;
            simError = 'calculate_clone_failed';
        }
    }

    const saving = Math.max(0, beforeTotal - afterTotal);
    const percent = beforeTotal > 0 ? (saving / beforeTotal) * 100 : 0;
    const inTargetRange = percent >= range.minPercent && (range.maxPercent === 0 || percent <= range.maxPercent + 1e-9);

    /* Stage 18.1.1 — per-group savings. Для каждой группы с ≥1 изменением
       строим clone с применёнными ТОЛЬКО её изменениями и считаем
       beforeTotal − groupAfterTotal. Это даёт честный ответ на вопрос
       «что я экономлю в этой группе», который не сводится к сумме —
       buffers/inflation/VAT мультипликативны в calculator.js, и сумма
       savings по группам ≠ общий saving. ≤6 calculate() при заполненном
       draft под debounce 200мс. */
    const savingByGroup = emptySavingByGroup();
    if (!baseError) {
        const changesByGroup = new Map();
        for (const [fieldId, change] of Object.entries(draft.changes || {})) {
            const spec = LEVER_SPECS_BY_ID.get(change.leverSpecId) || specFromFieldId(fieldId);
            const gid = getLeverGroupId(spec);
            if (!gid) continue;
            if (!changesByGroup.has(gid)) changesByGroup.set(gid, []);
            changesByGroup.get(gid).push([fieldId, change]);
        }
        for (const [gid, entries] of changesByGroup.entries()) {
            const groupClone = cloneCalc(calc);
            for (const [fieldId, change] of entries) {
                applyFieldIdToClone(groupClone, fieldId, change.to);
            }
            try {
                const groupAfter = Number(calculate(groupClone, null)?.totalMonthly) || 0;
                savingByGroup[gid] = Math.max(0, beforeTotal - groupAfter);
            } catch (_e) {
                savingByGroup[gid] = 0;
            }
        }
    }

    const errors = [];
    if (baseError) errors.push(baseError);
    if (simError)  errors.push(simError);

    return {
        ...draft,
        preview: {
            beforeTotalMonthly: beforeTotal,
            afterTotalMonthly:  afterTotal,
            savingMonthly:      saving,
            savingPercent:      percent,
            inTargetRange,
            targetRange:        range,
            savingByGroup,
            error:              errors.length > 0 ? errors[0] : null
        },
        validation: {
            errors,
            warnings: []
        }
    };
}

/* ---------- High-risk detection ---------- */

/**
 * Содержит ли draft хотя бы один high-risk change? Если да, UI обязан
 * показать inline-confirmation перед apply.
 */
export function draftHasHighRisk(draft) {
    if (!draft || !draft.changes) return false;
    for (const change of Object.values(draft.changes)) {
        if (HIGH_RISK_LEVER_SPEC_IDS.includes(change.leverSpecId)) return true;
        if (change.riskLevel === 'high') return true;
    }
    return false;
}

/**
 * Список high-risk changes для рендера warning-panel.
 */
export function listHighRiskChanges(draft) {
    if (!draft || !draft.changes) return [];
    const out = [];
    for (const change of Object.values(draft.changes)) {
        const isListed = HIGH_RISK_LEVER_SPEC_IDS.includes(change.leverSpecId);
        if (!isListed && change.riskLevel !== 'high') continue;
        const spec = LEVER_SPECS_BY_ID.get(change.leverSpecId);
        out.push({
            fieldId: change.fieldId,
            leverSpecId: change.leverSpecId,
            title: spec?.title || change.leverSpecId,
            from: change.from,
            to: change.to,
            consequence: spec?.consequence || ''
        });
    }
    return out;
}

/* ---------- Apply pipeline (pure) ---------- */

/**
 * Подготовить patch-list для apply.
 *
 * Domain не импортирует store/controllers; этот метод просто описывает что
 * именно нужно изменить и в каком порядке. Controller-слой превращает каждый
 * patch в setSetting / setResourceRatio / setAnswer.
 *
 * Каждый patch:
 *   { kind: 'setting' | 'setting_path' | 'answer',
 *     key:  'bufferTask' | 'standSizeRatio.LOAD' | 'sla_target',
 *     value: number,
 *     leverSpecId, title, from, to }
 */
export function buildApplyPatches(draft) {
    if (!draft || !draft.changes) return [];
    const out = [];
    for (const change of Object.values(draft.changes)) {
        const fieldId = change.fieldId;
        const spec = LEVER_SPECS_BY_ID.get(change.leverSpecId);
        if (fieldId.startsWith('setting:')) {
            const path = fieldId.slice('setting:'.length);
            const isNested = path.includes('.');
            out.push({
                kind: isNested ? 'setting_path' : 'setting',
                key: path,
                value: change.to,
                leverSpecId: change.leverSpecId,
                title: spec?.title || change.leverSpecId,
                from: change.from,
                to: change.to
            });
        } else if (fieldId.startsWith('answer:')) {
            out.push({
                kind: 'answer',
                key: fieldId.slice('answer:'.length),
                value: change.to,
                leverSpecId: change.leverSpecId,
                title: spec?.title || change.leverSpecId,
                from: change.from,
                to: change.to
            });
        }
    }
    return out;
}

/**
 * Финальная sanity-проверка перед apply: клонируем calc, применяем все patches,
 * вызываем calculate() — если падает, возвращаем error. Снимок calc до apply
 * (snapshot) тоже возвращается — controller сохранит его в state.modals.<name>.
 * lastApplySnapshot для отката.
 *
 * @returns {{ ok: true, patches, snapshot, preview } | { ok: false, reason, error? }}
 */
export function applyOptimizationDraft(draft, calc) {
    if (!draft || !calc) return { ok: false, reason: 'no_calc' };
    const patches = buildApplyPatches(draft);
    if (patches.length === 0) return { ok: false, reason: 'no_changes' };

    /* Atomic validation: применяем к clone, проверяем calculate. */
    const clone = cloneCalc(calc);
    for (const [fieldId, change] of Object.entries(draft.changes)) {
        applyFieldIdToClone(clone, fieldId, change.to);
    }
    let afterTotal = 0;
    try {
        afterTotal = Number(calculate(clone, null)?.totalMonthly) || 0;
    } catch (e) {
        return { ok: false, reason: 'recompute_failed', error: e?.message || String(e) };
    }
    if (!Number.isFinite(afterTotal) || afterTotal < 0) {
        return { ok: false, reason: 'invalid_total', error: `afterTotal=${afterTotal}` };
    }

    return {
        ok: true,
        patches,
        snapshot: snapshotCalc(calc),
        preview: draft.preview
    };
}

/**
 * Применить snapshot (rollback). Возвращает новый calc-объект с восстановленными
 * settings/answers/answersMeta; controller вызывает store.updateActiveCalc({
 * settings, answers, answersMeta }) с этими значениями.
 *
 * Не делает persist — это ответственность контроллера.
 */
export function calcFromApplySnapshot(calc, snapshot) {
    if (!calc || !snapshot) return calc;
    return {
        ...calc,
        settings:    JSON.parse(JSON.stringify(snapshot.settings    || {})),
        answers:     JSON.parse(JSON.stringify(snapshot.answers     || {})),
        answersMeta: JSON.parse(JSON.stringify(snapshot.answersMeta || {}))
    };
}
