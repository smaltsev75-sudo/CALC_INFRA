/**
 * Private rule registry for Calculation Health Check.
 * Pure functions: each rule receives (calc, options) and returns HealthFinding | null.
 */

import {
    STALE_BUNDLE_THRESHOLD_MONTHS,
    DEFAULT_THRESHOLD_RATIO,
    STAND_IDS
} from '../utils/constants.js';
import { getProviderSecurityPriceWarningForCalc } from './providerPriceTrust.js';
import { buildQuestionDefaults, calculate } from './calculator.js';
import { SEED_ITEMS, SEED_QUESTIONS } from './seed.js';
import {
    AI_LLM_TOKEN_CONTRACT_FIELDS,
    AI_TOKEN_VOLUME_FIELDS,
    hasActiveLlmOptIn,
    hasPositiveTokenDemandSignal,
    isExternalLlmHosting
} from './aiDemand.js';
/* ---------- Helpers ---------- */

function ans(calc, id) {
    return calc?.answers ? calc.answers[id] : undefined;
}

function setting(calc, id) {
    return calc?.settings ? calc.settings[id] : undefined;
}

function healthAck(calc, id) {
    const ack = calc?.healthAcknowledgements?.[id];
    return ack && typeof ack === 'object' ? ack : null;
}

function sameAckValues(calc, ack, fieldIds) {
    const stored = ack?.values;
    if (!stored || typeof stored !== 'object') return false;
    for (const fieldId of fieldIds || []) {
        const current = fieldId in (calc?.answers || {})
            ? ans(calc, fieldId)
            : setting(calc, fieldId);
        if (JSON.stringify(stored[fieldId]) !== JSON.stringify(current)) return false;
    }
    return true;
}

function isHealthAcknowledged(calc, id, fieldIds) {
    const ack = healthAck(calc, id);
    return !!ack && sameAckValues(calc, ack, fieldIds);
}

/** Финитное число (не null/undefined/NaN/Infinity). */
function isFiniteNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** «Есть ли явный ответ» — null/undefined/'' / [] = нет. */
function hasAnswer(v) {
    if (v === null || v === undefined) return false;
    if (Array.isArray(v) && v.length === 0) return false;
    if (v === '') return false;
    return true;
}

function makeFinding({ id, severity, category, title, message,
        fieldIds = [], suggestedAction = '', scenarioId = null }) {
    return {
        id,
        severity,
        category,
        title,
        message,
        fieldIds: Array.isArray(fieldIds) ? fieldIds.slice() : [],
        suggestedAction: suggestedAction || '',
        scenarioId: scenarioId || null
    };
}

const SEED_DASHBOARD_RESOURCE_BY_ID = new Map(
    SEED_ITEMS.filter(item => item.dashboardResource)
        .map(item => [item.id, item.dashboardResource])
);

const SEED_DASHBOARD_AI_METRIC_BY_ID = new Map(
    SEED_ITEMS.filter(item => item.dashboardAiMetric)
        .map(item => [item.id, item.dashboardAiMetric])
);

const SEED_QUESTION_BY_ID = new Map(SEED_QUESTIONS.map(question => [question.id, question]));
function activeStandIds(calc) {
    const disabled = new Set(Array.isArray(calc?.view?.disabledStands)
        ? calc.view.disabledStands
        : []);
    return STAND_IDS.filter(stand => !disabled.has(stand));
}

function aggregateDashboardQtyByStand(calc, result, resource) {
    const items = Array.isArray(calc?.dictionaries?.items) ? calc.dictionaries.items : [];
    const ids = items
        .filter(item => (item?.dashboardResource ?? SEED_DASHBOARD_RESOURCE_BY_ID.get(item?.id)) === resource)
        .map(item => item.id);
    const out = {};
    for (const stand of STAND_IDS) {
        out[stand] = ids.reduce((acc, itemId) =>
            acc + (Number(result?.items?.[itemId]?.stands?.[stand]?.qty) || 0), 0);
    }
    return out;
}

function aggregateAiMetricQty(calc, result, metric) {
    const items = Array.isArray(calc?.dictionaries?.items) ? calc.dictionaries.items : [];
    const ids = items
        .filter(item => (item?.dashboardAiMetric ?? SEED_DASHBOARD_AI_METRIC_BY_ID.get(item?.id)) === metric)
        .map(item => item.id);
    return ids.reduce((sum, itemId) => {
        const stands = result?.items?.[itemId]?.stands || {};
        return sum + Object.values(stands).reduce((acc, row) => acc + (Number(row?.qty) || 0), 0);
    }, 0);
}

function aiDemandSource(calc) {
    return {
        answers: calc?.answers || {},
        questionDefaults: buildQuestionDefaults(calc?.dictionaries?.questions || [])
    };
}

function autoTrafficTb(avgRps, sizeKb) {
    if (!isFiniteNum(avgRps) || !isFiniteNum(sizeKb)) return null;
    if (avgRps <= 0 || sizeKb <= 0) return null;
    return avgRps * 86400 * sizeKb * 30 / 1048576 / 1024;
}

function trafficDiffersMaterially(explicitTb, autoTb) {
    if (!isFiniteNum(explicitTb) || !isFiniteNum(autoTb)) return false;
    if (explicitTb <= 0 || autoTb <= 0) return false;
    const ratio = explicitTb > autoTb ? explicitTb / autoTb : autoTb / explicitTb;
    return ratio >= 3;
}

function seedDefaultForQuestion(id) {
    const q = SEED_QUESTION_BY_ID.get(id);
    if (!q) return undefined;
    return q.defaultValue !== undefined ? q.defaultValue : q.defaultIfUnknown;
}

function sameScalarValue(a, b) {
    if (typeof a === 'number' || typeof b === 'number') {
        const an = Number(a);
        const bn = Number(b);
        return Number.isFinite(an) && Number.isFinite(bn) && an === bn;
    }
    return a === b;
}

function isManualOrImportedAnswer(calc, id) {
    const source = calc?.answersMeta?.[id]?.source;
    return source === 'manual' || source === 'import' || source === 'user';
}

function isTokenVolumeExplicitlyConfigured(calc, id) {
    const value = ans(calc, id);
    if (!hasAnswer(value)) return false;
    if (isManualOrImportedAnswer(calc, id)) return true;
    const seedDefault = seedDefaultForQuestion(id);
    return seedDefault !== undefined && !sameScalarValue(value, seedDefault);
}

/* ============================================================
 * 28 правил проверки.
 * Каждая функция получает (calc, options) и возвращает HealthFinding | null.
 * ============================================================ */

/* --- Группа: Консистентность нагрузки --- */

function checkAvgRpsGtPeak(calc) {
    const avg = ans(calc, 'avg_rps');
    const peak = ans(calc, 'peak_rps');
    if (!isFiniteNum(avg) || !isFiniteNum(peak)) return null;
    if (avg > peak) {
        return makeFinding({
            id: 'consistency-avg-rps-gt-peak',
            severity: 'error',
            category: 'consistency',
            title: 'Средний RPS больше пикового',
            message: `avg_rps=${avg} > peak_rps=${peak}. Это противоречит ` +
                `физическому смыслу: пиковый RPS — это максимум по времени, ` +
                `средний не может его превышать.`,
            fieldIds: ['avg_rps', 'peak_rps'],
            suggestedAction: 'Проверьте оба значения. Обычно avg_rps = 5-30 % от peak_rps.'
        });
    }
    return null;
}

function checkPcuGtUsersTotal(calc) {
    const pcu = ans(calc, 'pcu_target');
    const total = ans(calc, 'users_total');
    if (!isFiniteNum(pcu) || !isFiniteNum(total)) return null;
    if (pcu > total) {
        return makeFinding({
            id: 'consistency-pcu-gt-users-total',
            severity: 'error',
            category: 'consistency',
            title: 'PCU больше общего числа пользователей',
            message: `pcu_target=${pcu} > users_total=${total}. PCU (одновременно ` +
                `онлайн) не может превышать общее число пользователей за срок жизни продукта.`,
            fieldIds: ['pcu_target', 'users_total'],
            suggestedAction: 'Проверьте оба значения. PCU обычно составляет долю от DAU и всегда меньше накопленной аудитории.'
        });
    }
    return null;
}

function checkPeakDurationGt24(calc) {
    const v = ans(calc, 'peak_duration_hours');
    if (!isFiniteNum(v)) return null;
    if (v > 24) {
        return makeFinding({
            id: 'consistency-peak-duration-gt-24',
            severity: 'error',
            category: 'consistency',
            title: 'Длительность пика больше 24 часов',
            message: `peak_duration_hours=${v} > 24. В сутках всего 24 часа.`,
            fieldIds: ['peak_duration_hours'],
            suggestedAction: 'Типовой диапазон: 2-6 часов в сутки.'
        });
    }
    return null;
}

function checkRegisteredGtUsersTotal(calc) {
    const reg = ans(calc, 'registered_users_total');
    const total = ans(calc, 'users_total');
    if (!isFiniteNum(reg) || !isFiniteNum(total) || total <= 0) return null;
    if (reg > total) {
        return makeFinding({
            id: 'consistency-registered-gt-users-total',
            severity: 'warning',
            category: 'consistency',
            title: 'Зарегистрированных сейчас больше, чем всего пользователей за срок',
            message: `registered_users_total=${reg} > users_total=${total}. ` +
                'Поле users_total — это накопленное число пользователей за весь срок жизни продукта, ' +
                'поэтому оно не должно быть меньше уже существующей базы.',
            fieldIds: ['registered_users_total', 'users_total'],
            suggestedAction: 'Увеличьте «Всего пользователей за весь срок жизни продукта» или уточните число уже зарегистрированных пользователей.'
        });
    }
    return null;
}

function checkDauShareLikelyPercentMistake(calc) {
    const share = ans(calc, 'dau_share_of_registered_percent');
    const registered = ans(calc, 'registered_users_total');
    if (!isFiniteNum(share) || share <= 0 || share >= 1) return null;
    const fieldIds = ['dau_share_of_registered_percent', 'registered_users_total'];
    if (isHealthAcknowledged(calc, 'consistency-dau-share-lower-than-1-percent', fieldIds)) return null;

    const dauText = isFiniteNum(registered)
        ? ` При ${registered} зарегистрированных это даёт ${Math.round(registered * share) / 100} DAU.`
        : '';

    return makeFinding({
        id: 'consistency-dau-share-lower-than-1-percent',
        severity: 'warning',
        category: 'consistency',
        title: 'DAU-доля меньше 1 %',
        message:
            `dau_share_of_registered_percent=${share} означает ${share} %, а не ${share * 100} %.` +
            dauText +
            ' Для EdTech это допустимо у раннего продукта, сезонного сценария или редкого B2B-использования, но для ежедневного учебного продукта значение нужно подтвердить.',
        fieldIds,
        suggestedAction:
            'Если реально меньше 1 %, подтвердите допущение. Если это опечатка, исправьте значение вручную.'
    });
}

function checkTrafficEgressExplicitDiffersFromAuto(calc) {
    const explicitTb = ans(calc, 'traffic_egress_tb_month');
    const autoTb = autoTrafficTb(ans(calc, 'avg_rps'), ans(calc, 'avg_response_size_kb'));
    if (!trafficDiffersMaterially(explicitTb, autoTb)) return null;

    return makeFinding({
        id: 'consistency-traffic-egress-explicit-differs-from-auto',
        severity: 'warning',
        category: 'consistency',
        title: 'Исходящий трафик сильно отличается от автооценки',
        message:
            `В опроснике задано ${explicitTb} ТБ/мес исходящего трафика, ` +
            `а автооценка по avg_rps и размеру ответа даёт примерно ${Math.round(autoTb * 10) / 10} ТБ/мес. ` +
            'В расчёте будет использовано явное значение из опросника.',
        fieldIds: ['traffic_egress_tb_month', 'avg_rps', 'avg_response_size_kb'],
        suggestedAction:
            'Подтвердите, что месячный трафик измерен отдельно. Если нет, поставьте 0, чтобы считать автоматически.'
    });
}

function checkTrafficIngressExplicitDiffersFromAuto(calc) {
    const explicitTb = ans(calc, 'traffic_ingress_tb_month');
    const autoTb = autoTrafficTb(ans(calc, 'avg_rps'), ans(calc, 'avg_request_size_kb'));
    if (!trafficDiffersMaterially(explicitTb, autoTb)) return null;

    return makeFinding({
        id: 'consistency-traffic-ingress-explicit-differs-from-auto',
        severity: 'warning',
        category: 'consistency',
        title: 'Входящий трафик сильно отличается от автооценки',
        message:
            `В опроснике задано ${explicitTb} ТБ/мес входящего трафика, ` +
            `а автооценка по avg_rps и размеру запроса даёт примерно ${Math.round(autoTb * 10) / 10} ТБ/мес. ` +
            'В расчёте будет использовано явное значение из опросника.',
        fieldIds: ['traffic_ingress_tb_month', 'avg_rps', 'avg_request_size_kb'],
        suggestedAction:
            'Подтвердите, что месячный трафик измерен отдельно. Если нет, поставьте 0, чтобы считать автоматически.'
    });
}

/* --- Группа: AI / RAG --- */

function checkRagWithoutLlm(calc) {
    if (ans(calc, 'rag_needed') === true && ans(calc, 'ai_llm_used') !== true) {
        return makeFinding({
            id: 'ai-rag-without-llm',
            severity: 'error',
            category: 'consistency',
            title: 'RAG включён, но LLM не используется',
            message: 'Поиск по корпусу (RAG) бессмыслен без LLM, который ' +
                'будет генерировать ответ по найденным фрагментам.',
            fieldIds: ['rag_needed', 'ai_llm_used'],
            suggestedAction: 'Включите «Использование LLM» либо отключите RAG.'
        });
    }
    return null;
}

function checkAgentWithoutLlm(calc) {
    if (ans(calc, 'ai_agent_mode') === true && ans(calc, 'ai_llm_used') !== true) {
        return makeFinding({
            id: 'ai-agent-without-llm',
            severity: 'error',
            category: 'consistency',
            title: 'AI-агенты включены, но LLM не используется',
            message: 'AI-агент — это LLM, вызывающий инструменты. Без LLM ' +
                'агентский режим невозможен.',
            fieldIds: ['ai_agent_mode', 'ai_llm_used'],
            suggestedAction: 'Включите «Использование LLM» либо отключите режим агентов.'
        });
    }
    return null;
}

function checkTokenVolumeWithoutLlm(calc) {
    if (ans(calc, 'ai_llm_used') === true) return null;
    const configured = AI_TOKEN_VOLUME_FIELDS
        .filter(fieldId => isTokenVolumeExplicitlyConfigured(calc, fieldId));
    if (configured.length === 0) return null;

    return makeFinding({
        id: 'ai-token-volume-without-llm',
        severity: 'warning',
        category: 'consistency',
        title: 'Заполнен объём токенов, но LLM выключен',
        message:
            'В разделе «Объём токенов» есть явные значения, но «Использовать LLM» не включено. ' +
            'Калькулятор использует явный объём токенов для строк LLM, но настройку стоит уточнить перед согласованием расчёта.',
        fieldIds: ['ai_llm_used', ...configured],
        suggestedAction:
            'Если продукт использует LLM, включите «Использовать большие языковые модели». ' +
            'Если LLM нет, верните поля объёма токенов к значениям по умолчанию и зафиксируйте это допущение.'
    });
}

function hasPositiveExternalTokenDemand(calc) {
    const source = aiDemandSource(calc);
    return hasActiveLlmOptIn(source)
        && isExternalLlmHosting(source)
        && hasPositiveTokenDemandSignal(source);
}

function checkTokenVolumeProducesTokenResources(calc) {
    if (!hasPositiveExternalTokenDemand(calc)) return null;

    let result;
    try {
        result = calculate(calc);
    } catch (_err) {
        return null;
    }

    if (aggregateAiMetricQty(calc, result, 'TOKENS') > 0) return null;

    return makeFinding({
        id: 'ai-token-volume-without-token-resources',
        severity: 'error',
        category: 'architecture',
        title: 'LLM включена, но токены не рассчитались',
        message:
            'LLM включена, demand-параметры токенов больше нуля, ' +
            'но суммарный объём ЭК с AI-метрикой TOKENS равен нулю. В Dashboard и Детализации ' +
            'это выглядело бы как отсутствие токеновой нагрузки при заполненном разделе токенов.',
        fieldIds: AI_LLM_TOKEN_CONTRACT_FIELDS,
        suggestedAction:
            'Проверьте поля нагрузки LLM, формулы ЭК «Входящие токены LLM» и «Исходящие токены LLM», ' +
            'а также наличие dashboardAiMetric="TOKENS" у токеновых ЭК. Если user-base неизвестна, задайте ' +
            '«Уже зарегистрировано пользователей сейчас» и «Доля активных в день» явно.'
    });
}

function checkRagIncompleteCorpus(calc) {
    if (ans(calc, 'rag_needed') !== true) return null;
    const corpus = ans(calc, 'rag_corpus_size_gb');
    const emb = ans(calc, 'rag_embeddings_million');
    const corpusZero = isFiniteNum(corpus) && corpus === 0;
    const embZero = isFiniteNum(emb) && emb === 0;
    if (corpusZero || embZero) {
        return makeFinding({
            id: 'ai-rag-incomplete-corpus',
            severity: 'warning',
            category: 'completeness',
            title: 'RAG настроен, но размер корпуса или эмбеддингов = 0',
            message: 'При rag_needed=Да должны быть указаны и размер корпуса (ГБ), ' +
                'и число эмбеддингов (млн). Иначе расчёт RAG-ресурсов будет ' +
                'занижен.',
            fieldIds: ['rag_corpus_size_gb', 'rag_embeddings_million'],
            suggestedAction: 'Задайте оба значения или отключите RAG.'
        });
    }
    return null;
}

/* Stage 1 (qty-модель ПРОМ): ручное число эмбеддингов сильно (×3) расходится
   с авторасчётом от размера корпуса. Срабатывает только в ручном режиме. */
function checkRagEmbeddingsMismatch(calc) {
    if (ans(calc, 'rag_needed') !== true) return null;
    if (ans(calc, 'rag_embeddings_manual') !== true) return null;
    const corpus = ans(calc, 'rag_corpus_size_gb');
    const manual = ans(calc, 'rag_embeddings_million');
    if (!isFiniteNum(corpus) || corpus <= 0) return null;
    if (!isFiniteNum(manual) || manual <= 0) return null;
    const chunkRaw = ans(calc, 'rag_avg_chunk_tokens');
    const chunk = isFiniteNum(chunkRaw) && chunkRaw >= 1 ? chunkRaw : 512;
    const derived = corpus * 200000000 / chunk / 1_000_000; // млн эмбеддингов
    if (derived <= 0) return null;
    const ratio = manual / derived;
    if (ratio <= 3 && ratio >= 1 / 3) return null; // в пределах ×3 — допустимо для грубой sizing-модели
    return makeFinding({
        id: 'ai-rag-embeddings-mismatch',
        severity: 'warning',
        category: 'consistency',
        title: 'Ручное число эмбеддингов RAG расходится с расчётом от корпуса',
        message: `Указано ${manual} млн эмбеддингов вручную, но из размера корпуса (${corpus} ГБ при чанке ${chunk} токенов) ` +
            `ожидается ≈ ${derived.toFixed(1)} млн (расхождение более чем в 3 раза). Размер векторной БД и стоимость могут быть оценены неверно.`,
        fieldIds: ['rag_embeddings_million', 'rag_corpus_size_gb', 'rag_avg_chunk_tokens', 'rag_embeddings_manual'],
        suggestedAction: 'Проверьте число эмбеддингов или выключите ручной режим — тогда оно считается из корпуса автоматически.'
    });
}

/* Stage 1: ежедневный ПОЛНЫЙ пересчёт большого корпуса (delta≈100%) — дорого. */
function checkRagFullReindexLargeCorpus(calc) {
    if (ans(calc, 'rag_needed') !== true) return null;
    if (ans(calc, 'rag_refresh_frequency') !== 'daily') return null;
    const corpus = ans(calc, 'rag_corpus_size_gb');
    if (!isFiniteNum(corpus) || corpus < 100) return null;
    const deltaRaw = ans(calc, 'rag_refresh_delta_percent');
    const delta = isFiniteNum(deltaRaw) ? deltaRaw : 100; // default = полный пересчёт
    if (delta < 50) return null; // delta-конвейер — не предупреждаем
    return makeFinding({
        id: 'ai-rag-full-reindex-large-corpus',
        severity: 'recommendation',
        category: 'pricing',
        title: 'Ежедневный полный пересчёт большого RAG-корпуса — дорого',
        message: `Корпус ${corpus} ГБ переэмбеддивается ежедневно целиком (доля корпуса за цикл ${delta}%). ` +
            'Это завышает расход на эмбеддинги в разы — на практике переиндексируется только изменившаяся часть (дельта 5-15%).',
        fieldIds: ['rag_refresh_frequency', 'rag_refresh_delta_percent', 'rag_corpus_size_gb'],
        suggestedAction: 'Если у вас delta-конвейер — укажите реальную «долю корпуса за цикл» (обычно 5-15%) или выберите режим «В реальном времени» (непрерывная дельта).'
    });
}

/* Stage 2 (qty-модель ПРОМ): LLM включён, но спрос не задан (всё по нулям). */
function checkLlmEnabledNoDemand(calc) {
    if (ans(calc, 'ai_llm_used') !== true) return null;
    const share = ans(calc, 'ai_users_share');
    const reqs = ans(calc, 'ai_requests_per_user_day');
    const shareZero = isFiniteNum(share) && share <= 0;
    const reqsZero = isFiniteNum(reqs) && reqs <= 0;
    if (!(shareZero && reqsZero)) return null;
    return makeFinding({
        id: 'ai-llm-enabled-no-demand',
        severity: 'warning',
        category: 'completeness',
        title: 'Большая языковая модель включена, но спрос не задан',
        message: 'ai_llm_used=Да, но доля пользователей ИИ и число запросов в день = 0 — ' +
            'токены и стоимость ИИ получатся нулевыми. Похоже, ИИ включили, но не заполнили параметры спроса.',
        fieldIds: ['ai_llm_used', 'ai_users_share', 'ai_requests_per_user_day'],
        suggestedAction: 'Заполните долю пользователей ИИ и число запросов в день — или выключите ИИ.'
    });
}

/* Stage 2: RAG включён, но входные токены считаются простым средним —
   напоминание, что среднее должно уже включать RAG-контекст (или включить детальный режим). */
function checkRagContextInSimpleMode(calc) {
    if (ans(calc, 'rag_needed') !== true) return null;
    if (ans(calc, 'ai_token_breakdown_manual') === true) return null;
    return makeFinding({
        id: 'ai-rag-context-in-simple-mode',
        severity: 'recommendation',
        category: 'completeness',
        title: 'При RAG средний входной объём токенов должен включать RAG-контекст',
        message: 'Поиск по базе знаний включён, а входные токены считаются простым средним. ' +
            'Убедитесь, что «Средний объём входящего запроса» уже включает токены найденных фрагментов RAG ' +
            '(обычно +1000–5000), иначе расход на токены будет занижен.',
        fieldIds: ['rag_needed', 'ai_avg_input_tokens', 'ai_token_breakdown_manual'],
        suggestedAction: 'Учтите RAG-контекст в среднем объёме входных токенов или включите детальный режим расчёта токенов.'
    });
}

/* Stage 3 (qty-модель ПРОМ): задан срок хранения бэкапов и размер БД, но db_count=0 —
   бэкап БД не сформируется (нет инстансов для копирования). */
function checkBackupRetentionWithoutDb(calc) {
    const retention = ans(calc, 'backup_retention_days');
    if (!(isFiniteNum(retention) && retention > 0)) return null;
    const dbSize = ans(calc, 'db_size_initial_gb');
    const dbGrowth = ans(calc, 'db_growth_gb_month');
    const hasDbData = (isFiniteNum(dbSize) && dbSize > 0) || (isFiniteNum(dbGrowth) && dbGrowth > 0);
    if (!hasDbData) return null;
    const dbCount = ans(calc, 'db_count');
    if (!(isFiniteNum(dbCount) && dbCount <= 0)) return null;
    return makeFinding({
        id: 'storage-backup-retention-without-db',
        severity: 'warning',
        category: 'completeness',
        title: 'Указан срок хранения бэкапов и размер БД, но число БД = 0',
        message: 'Задан срок хранения резервных копий и размер БД, но число баз данных = 0 — ' +
            'бэкап БД не сформируется (нет инстансов БД для копирования).',
        fieldIds: ['backup_retention_days', 'db_count', 'db_size_initial_gb'],
        suggestedAction: 'Укажите число баз данных (≥ 1) или обнулите размер БД, если базы нет.'
    });
}

/* Stage 3 (условие 2): старый расчёт без новых storage-параметров — к нему применены
   обновлённые допущения по умолчанию. Показываем явно, чтобы это не выглядело как тихая магия. */
function checkStorageModelAssumptionsUpdated(calc) {
    if (ans(calc, 'db_index_ratio') !== undefined) return null; // новые параметры заданы — не старый расчёт
    const dbCount = ans(calc, 'db_count');
    const dbSize = ans(calc, 'db_size_initial_gb');
    const files = ans(calc, 'file_storage_volume_tb');
    const hasStorage = (isFiniteNum(dbCount) && dbCount > 0)
        || (isFiniteNum(dbSize) && dbSize > 0)
        || (isFiniteNum(files) && files > 0);
    if (!hasStorage) return null;
    return makeFinding({
        id: 'storage-model-assumptions-updated',
        severity: 'info',
        category: 'completeness',
        title: 'Применены обновлённые допущения по расчёту хранилища',
        message: 'Модель расчёта хранилища обновлена: применены допущения по умолчанию — коэффициент ' +
            'индексов БД (×1.3), WAL (+10%), сжатие бэкапов (÷2), доли горячих/холодных файлов. ' +
            'Суммы по SSD/HDD/S3 могли измениться относительно прежнего расчёта.',
        fieldIds: ['db_index_ratio', 'db_wal_overhead_percent', 'backup_compression_ratio'],
        suggestedAction: 'Откройте расширенные параметры хранилища и при необходимости уточните коэффициенты под свою архитектуру.'
    });
}

/* Stage 4 (qty-модель ПРОМ): есть вычислительная нагрузка (CPU>0), но RAM=0 —
   физически невозможно (обычно ram_per_vcpu_ratio=0 после битого импорта). */
function checkCpuPositiveRamZero(calc) {
    const drivers = ['peak_rps', 'pcu_target', 'microservices_count', 'async_workers_count']
        .map(id => ans(calc, id));
    const hasCpu = drivers.some(v => isFiniteNum(v) && v > 0);
    if (!hasCpu) return null;
    const ramRatio = ans(calc, 'ram_per_vcpu_ratio');
    const cache = ans(calc, 'cache_size_gb');
    const ramRatioZero = isFiniteNum(ramRatio) && ramRatio <= 0;
    const cacheZero = !isFiniteNum(cache) || cache <= 0;
    if (!(ramRatioZero && cacheZero)) return null;
    return makeFinding({
        id: 'cpu-positive-ram-zero',
        severity: 'error',
        category: 'consistency',
        title: 'Есть вычислительная нагрузка, но RAM получается нулевой',
        message: 'Заданы драйверы CPU (RPS / PCU / сервисы), но RAM на vCPU = 0 и кэш = 0 — ' +
            'оперативная память выйдет нулевой, что невозможно для работающего сервиса.',
        fieldIds: ['ram_per_vcpu_ratio', 'cache_size_gb', 'peak_rps'],
        suggestedAction: 'Укажите RAM на vCPU (обычно 2-8 ГБ) — без памяти сервис не запустится.'
    });
}

function checkAgentIncompleteTools(calc) {
    if (ans(calc, 'ai_agent_mode') !== true) return null;
    const t = ans(calc, 'agent_tool_avg_seconds');
    if (isFiniteNum(t) && t === 0) {
        return makeFinding({
            id: 'ai-agent-incomplete-tools',
            severity: 'warning',
            category: 'completeness',
            title: 'Агентский режим включён, но среднее время вызова инструментов = 0',
            message: 'agent_tool_avg_seconds=0 — это означает, что агент ничего не ' +
                'делает между LLM-вызовами. Расчёт sandbox vCPU и потоков агента ' +
                'будет некорректным.',
            fieldIds: ['agent_tool_avg_seconds'],
            suggestedAction: 'Задайте типовое время инструмента (1-5 с).'
        });
    }
    return null;
}

/* --- Группа: ПДн / безопасность --- */

function checkPdnWithoutEncryption(calc) {
    if (ans(calc, 'pdn_152fz') === true && ans(calc, 'encryption_at_rest') !== true) {
        return makeFinding({
            id: 'security-pdn-without-encryption',
            severity: 'warning',
            category: 'security',
            title: 'ПДн обрабатываются, но шифрование at-rest отключено',
            message: 'При обработке ПДн по 152-ФЗ требуется криптозащита данных ' +
                'на уровне хранилища (приказ ФСТЭК № 21 п. 12).',
            fieldIds: ['pdn_152fz', 'encryption_at_rest'],
            suggestedAction: 'Включите шифрование at-rest либо уточните категорию ПДн.'
        });
    }
    return null;
}

function checkPdnWithoutCategory(calc) {
    if (ans(calc, 'pdn_152fz') !== true) return null;
    const cat = ans(calc, 'pdn_category');
    if (!hasAnswer(cat)) {
        return makeFinding({
            id: 'security-pdn-without-category',
            severity: 'warning',
            category: 'security',
            title: 'ПДн обрабатываются, но категория не указана',
            message: 'Категория ПДн (К1/К2/К3/К4 или УЗ-1..4) определяет состав ' +
                'СЗИ, требования к ЦОД и аттестации.',
            fieldIds: ['pdn_category'],
            suggestedAction: 'Уточните категорию у профильного специалиста или DPO.'
        });
    }
    return null;
}

function checkPublicWithoutWaf(calc) {
    const pt = ans(calc, 'product_type');
    if ((pt === 'b2c' || pt === 'b2g') && ans(calc, 'waf_required') !== true) {
        return makeFinding({
            id: 'security-public-without-waf',
            severity: 'warning',
            category: 'security',
            title: 'Публичный продукт без WAF',
            message: `product_type=${pt} — публичный доступ через интернет. ` +
                'Без WAF (Web Application Firewall) приложение остаётся ' +
                'беззащитным к OWASP Top-10 атакам.',
            fieldIds: ['product_type', 'waf_required'],
            suggestedAction: 'Включите WAF либо обоснуйте отсутствие (например, продукт за VPN).'
        });
    }
    return null;
}

function checkPublicWithoutDdos(calc) {
    const pt = ans(calc, 'product_type');
    if ((pt === 'b2c' || pt === 'b2g') && ans(calc, 'ddos_protection_required') !== true) {
        return makeFinding({
            id: 'security-public-without-ddos',
            severity: 'recommendation',
            category: 'security',
            title: 'Публичный продукт без DDoS-защиты',
            message: `product_type=${pt} — без DDoS-защиты публичный продукт ` +
                'уязвим к L3-L4 атакам, особенно сезонным/таргетированным.',
            fieldIds: ['product_type', 'ddos_protection_required'],
            suggestedAction: 'Рассмотрите DDoS-защиту хотя бы на уровне CDN/Anti-DDoS-провайдера.'
        });
    }
    return null;
}

/* --- Группа: SLA / резервирование --- */

function checkSlaHighWithoutGeoredundancy(calc) {
    const sla = ans(calc, 'sla_target');
    if (!isFiniteNum(sla)) return null;
    if ((sla >= 99.95) && ans(calc, 'georedundancy_required') !== true) {
        return makeFinding({
            id: 'sla-high-without-georedundancy',
            severity: 'warning',
            category: 'architecture',
            title: 'Высокий SLA без геораспределённого резервирования',
            message: `sla_target=${sla} % обычно требует резервного ЦОДа. ` +
                'Single-DC даёт максимум 99,9 % (≈ 9 ч простоя в год).',
            fieldIds: ['sla_target', 'georedundancy_required'],
            suggestedAction: 'Включите georedundancy или снизьте SLA до 99,9 %.'
        });
    }
    return null;
}

function checkSlaStrictRtoRpoWithoutGeoredundancy(calc) {
    const rto = ans(calc, 'rto_hours');
    const rpo = ans(calc, 'rpo_minutes');
    const geo = ans(calc, 'georedundancy_required');
    const strictRto = isFiniteNum(rto) && rto <= 1;
    const strictRpo = isFiniteNum(rpo) && rpo <= 5;
    if ((strictRto || strictRpo) && geo !== true) {
        return makeFinding({
            id: 'sla-strict-rto-rpo-without-georedundancy',
            severity: 'warning',
            category: 'architecture',
            title: 'Жёсткие RTO/RPO без геораспределённого резервирования',
            message: `RTO ≤ 1 ч или RPO ≤ 5 мин достижимы только при наличии ` +
                'резервного ЦОД. Без georedundancy эти показатели — ' +
                'недостижимы при отказе площадки.',
            fieldIds: ['rto_hours', 'rpo_minutes', 'georedundancy_required'],
            suggestedAction: 'Согласуйте RTO/RPO с реальной архитектурой.'
        });
    }
    return null;
}

function checkZeroRpoWithoutReplicas(calc) {
    const rpo = ans(calc, 'rpo_minutes');
    const replicas = ans(calc, 'db_replicas_count');
    if (isFiniteNum(rpo) && rpo === 0 && (!isFiniteNum(replicas) || replicas < 2)) {
        return makeFinding({
            id: 'sla-zero-rpo-without-replicas',
            severity: 'warning',
            category: 'architecture',
            title: 'RPO = 0 минут, но реплик БД меньше 2',
            message: 'Нулевой RPO (никакой потери данных при сбое) требует ' +
                'синхронной репликации, минимум 2 реплики СУБД.',
            fieldIds: ['rpo_minutes', 'db_replicas_count'],
            suggestedAction: 'Увеличьте число реплик до 2+ или поднимите RPO.'
        });
    }
    return null;
}

/* --- Группа: Риск-коэффициенты --- */

function checkSeasonalActivityNotApplied(calc) {
    if (ans(calc, 'seasonal_activity') !== true) return null;

    const applyRiskFactors = setting(calc, 'applyRiskFactors');
    const kSeasonal = setting(calc, 'kSeasonal');
    const riskDisabled = applyRiskFactors === false;
    const zeroSeasonal = isFiniteNum(kSeasonal) && kSeasonal <= 0;
    if (!riskDisabled && !zeroSeasonal) return null;

    const reason = riskDisabled
        ? 'риск-коэффициенты отключены'
        : 'коэффициент сезонности равен 0 %';
    const fieldIds = ['seasonal_activity', 'kSeasonal', 'applyRiskFactors'];
    if (isHealthAcknowledged(calc, 'risk-seasonal-activity-not-applied', fieldIds)) return null;

    return makeFinding({
        id: 'risk-seasonal-activity-not-applied',
        severity: 'warning',
        category: 'risk',
        title: 'Сезонность включена, но не влияет на расчёт',
        message:
            `В опроснике включена сезонная активность, но ${reason}. ` +
            'Сезонная надбавка к ресурсам и стоимости сейчас не применяется.',
        fieldIds,
        suggestedAction:
            'Если сезонный пик должен попадать в бюджет, включите риск-коэффициенты и задайте kSeasonal больше 0. Если peak_rps уже включает сезонный пик, оставьте как есть.'
    });
}

/* --- Группа: Прайсы --- */

function checkStaleBundle(calc, options) {
    const meta = options?.bundleMeta;
    if (!meta?.timestamp) return null;
    const ts = Date.parse(meta.timestamp);
    if (!Number.isFinite(ts)) return null;
    const ageMs = Date.now() - ts;
    const monthMs = 30 * 24 * 60 * 60 * 1000;
    const ageMonths = ageMs / monthMs;
    if (ageMonths > STALE_BUNDLE_THRESHOLD_MONTHS) {
        return makeFinding({
            id: 'pricing-stale-bundle',
            severity: 'warning',
            category: 'pricing',
            title: 'Прайс провайдера устарел',
            message: `Прайс «${meta.providerId || '—'}» версии «${meta.version || '—'}» ` +
                `обновлён ${Math.round(ageMonths)} мес назад. Тарифы провайдеров ` +
                'обычно обновляются 1-2 раза в год.',
            fieldIds: [],
            suggestedAction: 'Обновите прайс на вкладке Опросник → блок Тарифы.'
        });
    }
    return null;
}

function checkStubBundle(calc, options) {
    const meta = options?.bundleMeta;
    if (!meta?.version) return null;
    const v = String(meta.version).toLowerCase();
    if (v.includes('stub') || v.includes('test') || v.includes('fixture')) {
        return makeFinding({
            id: 'pricing-stub-bundle',
            severity: 'recommendation',
            category: 'pricing',
            title: 'Используется тестовый/заглушечный прайс',
            message: `Версия прайса содержит маркер test/stub/fixture: «${meta.version}». ` +
                'Это значит, что цены не верифицированы на реальных тарифах провайдера.',
            fieldIds: [],
            suggestedAction: 'Замените на актуальный прайс из реального источника.'
        });
    }
    return null;
}

function checkBundleNotApplied(calc, options) {
    const meta = options?.bundleMeta;
    if (!meta || meta.isStale !== true) return null;
    return makeFinding({
        id: 'pricing-bundle-not-applied',
        severity: 'warning',
        category: 'pricing',
        title: 'Доступен более свежий прайс, но он не применён к расчёту',
        message: `Прайс провайдера «${meta.providerId || '—'}» обновлён, ` +
            'но текущий расчёт всё ещё использует прежний снимок цен.',
        fieldIds: [],
        suggestedAction: 'Нажмите «Пересчитать на новом прайсе» в Опроснике.'
    });
}

function checkProviderSecurityPricesByRequest(calc) {
    const warning = getProviderSecurityPriceWarningForCalc(calc);
    if (!warning) return null;
    return makeFinding({
        id: warning.id,
        severity: 'warning',
        category: 'pricing',
        title: 'VK: защитные сервисы по запросу',
        message: warning.message,
        fieldIds: warning.fieldIds,
        suggestedAction: warning.suggestedAction
    });
}

/* --- Группа: Полнота данных --- */

function _countAnswerStats(calc) {
    const questions = calc?.dictionaries?.questions || [];
    const answers = calc?.answers || {};
    let answered = 0, defaultMatches = 0, total = 0;
    for (const q of questions) {
        if (!q?.id) continue;
        total++;
        const v = answers[q.id];
        if (hasAnswer(v)) {
            answered++;
            // совпадение с defaultValue считается «дефолтным» ответом
            if (q.defaultValue !== undefined && q.defaultValue !== null
                    && v === q.defaultValue) {
                defaultMatches++;
            }
        }
    }
    return { total, answered, defaultMatches };
}

function checkTooManyDefaults(calc) {
    const { total, answered, defaultMatches } = _countAnswerStats(calc);
    if (answered === 0 || total === 0) return null;
    const ratio = defaultMatches / answered;
    if (ratio > DEFAULT_THRESHOLD_RATIO) {
        const pct = Math.round(ratio * 100);
        return makeFinding({
            id: 'completeness-too-many-defaults',
            severity: 'warning',
            category: 'completeness',
            title: 'Большая доля ответов — значения по умолчанию',
            message: `${pct} % отвеченных вопросов совпадают со значением по ` +
                'умолчанию. Это допустимо для Quick Start-расчёта, но снижает ' +
                'точность прогноза.',
            fieldIds: [],
            suggestedAction: 'Уточните ответы, особенно по нагрузке и SLA.'
        });
    }
    return null;
}

function checkLowAnswerRate(calc) {
    const { total, answered } = _countAnswerStats(calc);
    if (total === 0) return null;
    const rate = answered / total;
    if (rate < 0.5) {
        const pct = Math.round(rate * 100);
        return makeFinding({
            id: 'completeness-low-answer-rate',
            severity: 'recommendation',
            category: 'completeness',
            title: 'Низкая заполненность опросника',
            message: `Заполнено ${pct} % вопросов (${answered} из ${total}). ` +
                'Для незаполненных полей используются значения по умолчанию.',
            fieldIds: [],
            suggestedAction: 'Дозаполните опросник для повышения точности.'
        });
    }
    return null;
}

function checkNoBudgetTarget(calc) {
    const capex = ans(calc, 'target_capex_rub');
    const opex = ans(calc, 'target_opex_monthly_rub');
    if (!hasAnswer(capex) && !hasAnswer(opex)) {
        return makeFinding({
            id: 'completeness-no-budget-target',
            severity: 'recommendation',
            category: 'completeness',
            title: 'Целевой бюджет не задан',
            message: 'Не указаны ни целевой CAPEX, ни целевой OPEX. Без них ' +
                'калькулятор не может оценить, укладывается ли расчёт в бюджет.',
            fieldIds: ['target_capex_rub', 'target_opex_monthly_rub'],
            suggestedAction: 'Задайте хотя бы один из бюджетных таргетов.'
        });
    }
    return null;
}

function checkInfrastructureCoreResources(calc) {
    const stands = activeStandIds(calc);
    if (stands.length === 0) return null;

    const dictItems = Array.isArray(calc?.dictionaries?.items) ? calc.dictionaries.items : [];
    const hasCoreItems = dictItems.some(item => {
        const resource = item?.dashboardResource ?? SEED_DASHBOARD_RESOURCE_BY_ID.get(item?.id);
        return resource === 'CPU' || resource === 'RAM' || resource === 'SSD';
    });
    if (!hasCoreItems) return null;

    let result;
    try {
        result = calculate(calc);
    } catch (_err) {
        return null;
    }

    const cpu = aggregateDashboardQtyByStand(calc, result, 'CPU');
    const ram = aggregateDashboardQtyByStand(calc, result, 'RAM');
    const ssd = aggregateDashboardQtyByStand(calc, result, 'SSD');
    const hdd = aggregateDashboardQtyByStand(calc, result, 'HDD');
    const s3 = aggregateDashboardQtyByStand(calc, result, 'S3');

    const missing = [];
    for (const stand of stands) {
        const gaps = [];
        if (cpu[stand] <= 0) gaps.push('CPU');
        if (ram[stand] <= 0) gaps.push('RAM');
        if (ssd[stand] <= 0) gaps.push('SSD');
        if ((ssd[stand] + hdd[stand] + s3[stand]) <= 0) gaps.push('хранилище');
        if (gaps.length > 0) missing.push(`${stand}: ${gaps.join(', ')}`);
    }

    if (missing.length === 0) return null;

    return makeFinding({
        id: 'architecture-core-infrastructure-missing',
        severity: 'error',
        category: 'architecture',
        title: 'На активных стендах не хватает базовых ресурсов',
        message:
            'Для каждого активного стенда должны быть рассчитаны процессор, оперативная память ' +
            'и рабочее хранилище. Обнаружены нулевые объёмы: ' + missing.join('; ') + '.',
        fieldIds: [
            'peak_rps', 'microservices_count', 'async_workers_count',
            'ram_per_vcpu_ratio', 'cache_size_gb',
            'db_size_initial_gb', 'db_growth_gb_month', 'db_count'
        ],
        suggestedAction:
            'Проверьте параметры нагрузки, RAM/vCPU, кэш и параметры БД. ' +
            'Если значение неизвестно, используйте автозначение из JSON-ремонта или уточните вручную.'
    });
}

/* ---------- Реестр всех правил ---------- */

export const CALCULATION_HEALTH_CHECKS = [
    checkAvgRpsGtPeak,
    checkPcuGtUsersTotal,
    checkPeakDurationGt24,
    checkRegisteredGtUsersTotal,
    checkDauShareLikelyPercentMistake,
    checkTrafficEgressExplicitDiffersFromAuto,
    checkTrafficIngressExplicitDiffersFromAuto,
    checkRagWithoutLlm,
    checkAgentWithoutLlm,
    checkTokenVolumeWithoutLlm,
    checkTokenVolumeProducesTokenResources,
    checkRagIncompleteCorpus,
    checkRagEmbeddingsMismatch,
    checkRagFullReindexLargeCorpus,
    checkLlmEnabledNoDemand,
    checkRagContextInSimpleMode,
    checkBackupRetentionWithoutDb,
    checkStorageModelAssumptionsUpdated,
    checkCpuPositiveRamZero,
    checkAgentIncompleteTools,
    checkPdnWithoutEncryption,
    checkPdnWithoutCategory,
    checkPublicWithoutWaf,
    checkPublicWithoutDdos,
    checkSlaHighWithoutGeoredundancy,
    checkSlaStrictRtoRpoWithoutGeoredundancy,
    checkZeroRpoWithoutReplicas,
    checkSeasonalActivityNotApplied,
    checkStaleBundle,
    checkStubBundle,
    checkBundleNotApplied,
    checkProviderSecurityPricesByRequest,
    checkTooManyDefaults,
    checkLowAnswerRate,
    checkNoBudgetTarget,
    checkInfrastructureCoreResources
];
