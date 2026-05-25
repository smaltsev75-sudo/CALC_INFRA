/**
 * Трассировка расчёта количества ЭК.
 *
 * Этот модуль отвечает на вопрос пользователя «почему получилось именно
 * такое количество»: какая формула была применена, какие ответы Q.* и
 * параметры S.* в неё вошли, как они разрешились и совпадает ли итог с
 * реальным calculate().
 */

import { STAND_IDS, DEFAULT_DAYS_PER_MONTH, DEFAULT_PHASE_DURATION_MONTHS } from '../utils/constants.js';
import { getAst, isAstError } from './formula/cache.js';
import { evaluate, collectReferences } from './formula/evaluator.js';
import {
    calculate,
    buildContext,
    buildQuestionDefaults,
    billingIntervalToMonthlyMultiplier,
    riskFactor
} from './calculator.js';
import { SEED_ITEMS } from './seed.js';
import { applyProviderOverlay, DEFAULT_PROVIDER } from './providerOverlay.js';

const EPS = 1e-6;
const CORE_RESOURCE_LABELS = Object.freeze(['CPU', 'RAM', 'SSD']);
const SEED_DASHBOARD_RESOURCE_BY_ID = new Map(
    SEED_ITEMS.filter(item => item.dashboardResource)
        .map(item => [item.id, item.dashboardResource])
);

function hasOwn(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj || {}, key);
}

function normalizePath(path) {
    return Array.isArray(path) ? path : String(path || '').split('.').filter(Boolean);
}

function close(a, b, eps = EPS) {
    return Math.abs(a - b) <= eps;
}

function toQtyNumber(value) {
    return typeof value === 'boolean' ? (value ? 1 : 0) : Number(value);
}

function getEffectiveItems(calculation) {
    const rawItems = calculation?.dictionaries?.items || [];
    if (calculation?.providerVersion) return rawItems;
    const providerId = calculation?.settings?.provider || DEFAULT_PROVIDER;
    return applyProviderOverlay(rawItems, providerId);
}

function dashboardResourceOf(item) {
    return item?.dashboardResource ?? SEED_DASHBOARD_RESOURCE_BY_ID.get(item?.id) ?? null;
}

function activeStandsOf(calculation) {
    const disabled = new Set(Array.isArray(calculation?.view?.disabledStands)
        ? calculation.view.disabledStands
        : []);
    return STAND_IDS.filter(stand => !disabled.has(stand));
}

function questionFallbackValue(questionDefaults, answers, id) {
    const value = answers?.[id];
    if (value !== null && value !== undefined) return value;
    if (hasOwn(questionDefaults, id)) return questionDefaults[id];
    return 0;
}

function numQuestion(questionDefaults, answers, id) {
    const n = Number(questionFallbackValue(questionDefaults, answers, id));
    return Number.isFinite(n) ? n : 0;
}

function resourceQtyByStand(result, items) {
    const out = {};
    for (const resource of ['CPU', 'GPU', 'RAM', 'SSD', 'HDD', 'S3']) {
        out[resource] = Object.fromEntries(STAND_IDS.map(stand => [stand, 0]));
    }
    for (const item of items) {
        const resource = dashboardResourceOf(item);
        if (!resource || !out[resource]) continue;
        for (const stand of STAND_IDS) {
            out[resource][stand] += Number(result.items?.[item.id]?.stands?.[stand]?.qty) || 0;
        }
    }
    return out;
}

function itemQty(result, itemId, stand) {
    return Number(result.items?.[itemId]?.stands?.[stand]?.qty) || 0;
}

function applicableStandsOf(items, itemId) {
    const item = items.find(it => it?.id === itemId);
    if (!Array.isArray(item?.applicableStands)) return STAND_IDS;
    const allowed = item.applicableStands.filter(stand => STAND_IDS.includes(stand));
    return allowed.length > 0 ? allowed : STAND_IDS;
}

function auditSemanticInvariants(calculation, result, items) {
    const errors = [];
    const warnings = [];
    const activeStands = activeStandsOf(calculation);
    if (activeStands.length === 0) return { errors, warnings };

    const resourceQty = resourceQtyByStand(result, items);
    const answers = calculation?.answers || {};
    const questionDefaults = buildQuestionDefaults(calculation?.dictionaries?.questions || []);
    const hasCoreResourceItems = items.some(item => CORE_RESOURCE_LABELS.includes(dashboardResourceOf(item)));

    if (hasCoreResourceItems) {
        for (const stand of activeStands) {
            for (const resource of CORE_RESOURCE_LABELS) {
                if ((resourceQty[resource]?.[stand] || 0) > 0) continue;
                errors.push({
                    type: 'missingCoreResource',
                    stand,
                    resource,
                    message: `${stand}: отсутствует обязательный ресурс ${resource}. ` +
                        'Активный стенд не должен оставаться без CPU/RAM/рабочего SSD-хранилища.'
                });
            }

            const cpu = resourceQty.CPU[stand] || 0;
            const ram = resourceQty.RAM[stand] || 0;
            if (cpu > 0 && ram > 0 && ram + EPS < cpu) {
                errors.push({
                    type: 'ramBelowCpu',
                    stand,
                    message: `${stand}: RAM=${ram} ГБ меньше CPU=${cpu} vCPU. ` +
                        'Вопрос ram_per_vcpu_ratio имеет min=1, значит RAM не должна быть меньше CPU.'
                });
            }
        }
    }

    const dbCount = numQuestion(questionDefaults, answers, 'db_count');
    const dbSizeGb = numQuestion(questionDefaults, answers, 'db_size_initial_gb');
    const dbGrowthGbMonth = numQuestion(questionDefaults, answers, 'db_growth_gb_month');
    const backupRetentionDays = numQuestion(questionDefaults, answers, 'backup_retention_days');
    const fileStorageTb = numQuestion(questionDefaults, answers, 'file_storage_volume_tb');
    const fileGrowthTbYear = numQuestion(questionDefaults, answers, 'file_storage_growth_tb_year');
    const hasDbData = dbCount > 0 && (dbSizeGb > 0 || dbGrowthGbMonth > 0);
    const hasFileData = (fileStorageTb + fileGrowthTbYear) > 0;

    if (hasDbData) {
        for (const stand of activeStands) {
            if ((resourceQty.SSD[stand] || 0) > 0) continue;
            errors.push({
                type: 'dbWithoutSsd',
                stand,
                message: `${stand}: есть параметры БД, но SSD=0. ` +
                    'Основные данные БД должны иметь рабочее SSD/NVMe-хранилище.'
            });
        }
    }

    if (hasFileData) {
        for (const stand of activeStands) {
            if ((resourceQty.S3[stand] || 0) > 0) continue;
            errors.push({
                type: 'filesWithoutObjectStorage',
                stand,
                message: `${stand}: есть файловое хранилище, но S3=0. ` +
                    'Пользовательские файлы должны иметь объектное хранилище.'
            });
        }
    }

    if (hasDbData && backupRetentionDays > 0) {
        for (const stand of applicableStandsOf(items, 'storage-hdd-tb')) {
            if (!activeStands.includes(stand)) continue;
            if ((resourceQty.HDD[stand] || 0) > 0) continue;
            errors.push({
                type: 'backupsWithoutHdd',
                stand,
                message: `${stand}: есть БД и срок хранения бэкапов, но HDD=0. ` +
                    'Архивные копии БД должны иметь холодное хранилище.'
            });
        }
    }

    for (const stand of activeStands) {
        const osNodes = itemQty(result, 'license-os-per-node', stand);
        const securityNodes = itemQty(result, 'license-siem-edr-per-node', stand);
        const cpu = resourceQty.CPU[stand] || 0;
        if (osNodes > 0 && cpu <= 0) {
            errors.push({
                type: 'licenseWithoutCompute',
                stand,
                message: `${stand}: лицензии ОС=${osNodes}, но CPU=0. ` +
                    'Лицензируемые узлы должны соответствовать вычислительным ресурсам.'
            });
        }
        if (securityNodes > 0 && osNodes <= 0) {
            errors.push({
                type: 'securityLicenseWithoutNodes',
                stand,
                message: `${stand}: СЗИ=${securityNodes}, но лицензии ОС/узлы=0. ` +
                    'Средства защиты должны привязываться к существующим узлам.'
            });
        }
    }

    return { errors, warnings };
}

export function resolvePathValue(root, path) {
    const segments = normalizePath(path);
    let value = root;
    for (const segment of segments) {
        if (value === null || value === undefined || typeof value !== 'object') {
            return { exists: false, value: 0, missingAt: segment };
        }
        if (!hasOwn(value, segment)) {
            return { exists: false, value: 0, missingAt: segment };
        }
        value = value[segment];
    }
    return { exists: true, value, missingAt: null };
}

export function buildQuantityTrace(calculation, itemId, stand, precomputedResult = null) {
    const items = getEffectiveItems(calculation);
    const item = items.find(it => it.id === itemId);
    if (!item) {
        throw new Error(`ЭК ${itemId} не найден`);
    }
    if (!STAND_IDS.includes(stand)) {
        throw new Error(`Стенд ${stand} не найден`);
    }

    const questions = calculation?.dictionaries?.questions || [];
    const qById = new Map(questions.map(q => [q.id, q]));
    const questionDefaults = buildQuestionDefaults(questions);
    const answers = calculation?.answers || {};
    const settings = calculation?.settings || {};
    const answersMeta = calculation?.answersMeta || {};
    const ctx = buildContext(answers, settings, questionDefaults, stand, item);
    const result = precomputedResult || calculate(calculation);
    const cell = result.items?.[item.id]?.stands?.[stand] || {
        qty: 0,
        costBase: 0,
        costFinal: 0,
        error: null,
        riskBreakdown: null
    };

    const formula = item.qtyFormulas?.[stand] || '';
    const applicable = (item.applicableStands || []).includes(stand);
    const ast = getAst(formula);
    const parseError = ast && isAstError(ast) ? ast.__error.message : null;
    const refs = ast && !isAstError(ast)
        ? collectReferences(ast)
        : { questions: [], settings: [], functions: [], usesStand: false };

    let evaluatedRaw = null;
    let evaluatedQty = 0;
    let evaluateError = parseError;
    if (ast !== null && !isAstError(ast)) {
        try {
            evaluatedRaw = evaluate(ast, ctx);
            const num = toQtyNumber(evaluatedRaw);
            evaluatedQty = Number.isFinite(num) ? Math.max(0, num) : num;
        } catch (error) {
            evaluateError = error.message;
        }
    }

    const questionInputs = refs.questions.map(id => {
        const hasAnswer = hasOwn(answers, id);
        const hasDefault = hasOwn(questionDefaults, id);
        const rawValue = hasAnswer ? answers[id] : undefined;
        const usedFallback = (rawValue === null || rawValue === undefined) && hasDefault;
        const value = usedFallback ? questionDefaults[id] : hasAnswer ? rawValue : 0;
        const meta = answersMeta[id];
        return {
            ref: `Q.${id}`,
            id,
            title: qById.get(id)?.title || null,
            value,
            rawValue: hasAnswer ? rawValue : undefined,
            exists: qById.has(id),
            source: meta?.source || (usedFallback ? 'default' : hasAnswer ? 'answer' : hasDefault ? 'default' : 'missing'),
            profileId: meta?.profileId || null
        };
    });

    const settingInputs = refs.settings.map(path => {
        const resolved = resolvePathValue(ctx.S, path);
        const raw = resolvePathValue(settings, path);
        return {
            ref: `S.${path}`,
            path,
            value: resolved.exists ? resolved.value : 0,
            exists: resolved.exists,
            rawValue: raw.exists ? raw.value : null,
            overriddenByContext: raw.exists && JSON.stringify(raw.value) !== JSON.stringify(resolved.value)
        };
    });

    const phaseDuration = Number(settings?.phaseDurationMonths) || DEFAULT_PHASE_DURATION_MONTHS;
    const daysPerMonth = Number(settings?.daysPerMonth) || DEFAULT_DAYS_PER_MONTH;
    const billingIntervalMul = billingIntervalToMonthlyMultiplier(
        item.billingInterval,
        daysPerMonth,
        phaseDuration
    );
    const riskBreakdown = riskFactor(item, stand, settings);
    const applyRisks = settings.applyRiskFactors !== false;

    return {
        itemId: item.id,
        itemName: item.name,
        stand,
        applicable,
        unit: item.unit,
        category: item.category,
        resourceClass: item.resourceClass,
        dashboardResource: item.dashboardResource || null,
        formula,
        formulaHelp: item.formulaHelp || '',
        references: refs,
        questionInputs,
        settingInputs,
        usesStand: refs.usesStand,
        evaluatedRaw,
        evaluatedQty,
        evaluateError,
        qty: cell.qty,
        costBase: cell.costBase,
        costFinal: cell.costFinal,
        cellError: cell.error,
        billing: {
            pricePerUnit: Number(item.pricePerUnit) || 0,
            billingInterval: item.billingInterval,
            billingIntervalMul,
            daysPerMonth,
            phaseDurationMonths: phaseDuration
        },
        risk: {
            applyRiskFactors: applyRisks,
            breakdown: riskBreakdown
        }
    };
}

export function auditQuantityLogic(calculation) {
    const items = getEffectiveItems(calculation);
    const questions = calculation?.dictionaries?.questions || [];
    const knownQuestions = new Set(questions.map(q => q.id));
    const result = calculate(calculation);
    const errors = [];
    const warnings = [];
    const stats = {
        items: items.length,
        formulas: 0,
        applicableCells: 0,
        questionRefs: 0,
        settingRefs: 0
    };

    for (const item of items) {
        if (!item.formulaHelp || !String(item.formulaHelp).trim()) {
            warnings.push({
                type: 'missingFormulaHelp',
                itemId: item.id,
                message: `${item.id}: нет пояснения formulaHelp`
            });
        }

        for (const stand of STAND_IDS) {
            const applicable = (item.applicableStands || []).includes(stand);
            if (!applicable) continue;
            stats.applicableCells++;

            const trace = buildQuantityTrace(calculation, item.id, stand, result);
            const label = `${item.id}/${stand}`;
            if (!trace.formula.trim()) {
                errors.push({ type: 'emptyApplicableFormula', itemId: item.id, stand, message: `${label}: применимый стенд без формулы qty` });
                continue;
            }
            stats.formulas++;

            if (trace.evaluateError) {
                errors.push({ type: 'formulaError', itemId: item.id, stand, message: `${label}: ${trace.evaluateError}` });
                continue;
            }
            if (!Number.isFinite(trace.evaluatedQty)) {
                errors.push({ type: 'nonFiniteQty', itemId: item.id, stand, message: `${label}: qty не финитный (${trace.evaluatedQty})` });
            }
            if (Number.isFinite(trace.evaluatedQty) && trace.evaluatedQty < 0) {
                errors.push({ type: 'negativeQty', itemId: item.id, stand, message: `${label}: qty отрицательный (${trace.evaluatedQty})` });
            }
            if (Number.isFinite(trace.evaluatedQty) && !close(trace.evaluatedQty, trace.qty)) {
                errors.push({
                    type: 'qtyMismatch',
                    itemId: item.id,
                    stand,
                    message: `${label}: trace qty ${trace.evaluatedQty} не совпадает с calculate qty ${trace.qty}`
                });
            }

            for (const input of trace.questionInputs) {
                stats.questionRefs++;
                if (!knownQuestions.has(input.id)) {
                    errors.push({
                        type: 'unknownQuestion',
                        itemId: item.id,
                        stand,
                        message: `${label}: ссылка ${input.ref} не найдена в вопросах`
                    });
                }
            }
            for (const input of trace.settingInputs) {
                stats.settingRefs++;
                if (!input.exists) {
                    errors.push({
                        type: 'unknownSettingPath',
                        itemId: item.id,
                        stand,
                        message: `${label}: ссылка ${input.ref} не разрешилась в параметрах расчёта`
                    });
                }
            }

            const expectedBase = trace.qty * trace.billing.pricePerUnit * trace.billing.billingIntervalMul;
            if (!close(trace.costBase, expectedBase, 0.01)) {
                errors.push({
                    type: 'costBaseMismatch',
                    itemId: item.id,
                    stand,
                    message: `${label}: costBase ${trace.costBase} != qty × price × interval (${expectedBase})`
                });
            }

            const riskMul = trace.risk.applyRiskFactors ? trace.risk.breakdown.total : 1;
            const expectedFinal = expectedBase * riskMul * trace.risk.breakdown.vatMul;
            if (!close(trace.costFinal, expectedFinal, 0.01)) {
                errors.push({
                    type: 'costFinalMismatch',
                    itemId: item.id,
                    stand,
                    message: `${label}: costFinal ${trace.costFinal} != costBase × risks × VAT (${expectedFinal})`
                });
            }
        }
    }

    const semantic = auditSemanticInvariants(calculation, result, items);
    errors.push(...semantic.errors);
    warnings.push(...semantic.warnings);

    return { errors, warnings, stats };
}
