/**
 * Stage 15.1 — Calculation Health Check.
 *
 * Pure-domain логика (без DOM, store, services — только calc + DI metadata).
 * Возвращает массив findings по 21 правилу + score + counts.
 *
 * Score = clamp(100 − sum(HEALTH_PENALTY[sev]), 0, 100). Шкала штрафов
 * подобрана так, чтобы ОДНА ошибка чувствительно опускала рейтинг (−20),
 * а 5+ рекомендаций оставались в зелёной зоне (≥80).
 *
 * Правила сгруппированы по 6 категориям:
 *   - consistency  — внутренние противоречия в нагрузке/аудитории
 *   - completeness — полнота данных (default-ratio, answer-rate, бюджет)
 *   - risk         — настройки риск-факторов (зарезервировано на будущее)
 *   - pricing      — свежесть и применимость прайс-bundle'а
 *   - security     — соответствие требованиям ИБ для типа продукта
 *   - architecture — архитектурные противоречия (зарезервировано)
 */

import {
    HEALTH_PENALTY,
    HEALTH_SEVERITIES,
    STALE_BUNDLE_THRESHOLD_MONTHS,
    DEFAULT_THRESHOLD_RATIO
} from '../utils/constants.js';

/* ---------- Helpers ---------- */

function ans(calc, id) {
    return calc?.answers ? calc.answers[id] : undefined;
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

/* ============================================================
 * 21 правило проверки.
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
            title: 'PCU больше DAU',
            message: `pcu_target=${pcu} > users_total=${total}. PCU (одновременно ` +
                `онлайн) не может превышать DAU (всех активных за день).`,
            fieldIds: ['pcu_target', 'users_total'],
            suggestedAction: 'PCU/DAU обычно 3-10 % для interactive-сервисов.'
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

function checkRegisteredGtActive(calc) {
    const reg = ans(calc, 'registered_users_total');
    const active = ans(calc, 'users_total');
    if (!isFiniteNum(reg) || !isFiniteNum(active) || active <= 0) return null;
    if (reg > active * 100) {
        return makeFinding({
            id: 'consistency-registered-gt-active',
            severity: 'warning',
            category: 'consistency',
            title: 'Соотношение зарегистрированных к активным больше 100',
            message: `registered=${reg} > users_total × 100 = ${active * 100}. ` +
                `Похоже на ошибку в одном из значений или на крайне низкую ` +
                `активность пользователей (<1 % активных в день от зарегистрированных).`,
            fieldIds: ['registered_users_total', 'users_total'],
            suggestedAction: 'Проверьте оба значения; типовая доля активных в день от зарегистрированных = 5-30 %.'
        });
    }
    return null;
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

/* ---------- Реестр всех правил ---------- */

const ALL_CHECKS = [
    checkAvgRpsGtPeak,
    checkPcuGtUsersTotal,
    checkPeakDurationGt24,
    checkRegisteredGtActive,
    checkRagWithoutLlm,
    checkAgentWithoutLlm,
    checkRagIncompleteCorpus,
    checkAgentIncompleteTools,
    checkPdnWithoutEncryption,
    checkPdnWithoutCategory,
    checkPublicWithoutWaf,
    checkPublicWithoutDdos,
    checkSlaHighWithoutGeoredundancy,
    checkSlaStrictRtoRpoWithoutGeoredundancy,
    checkZeroRpoWithoutReplicas,
    checkStaleBundle,
    checkStubBundle,
    checkBundleNotApplied,
    checkTooManyDefaults,
    checkLowAnswerRate,
    checkNoBudgetTarget
];

/* ============================================================
 * Public API
 * ============================================================ */

/**
 * @param {Object} calc       — calc-объект из store.
 * @param {Object} [options]
 * @param {Object} [options.bundleMeta] — { providerId, version, timestamp, isStale? }
 *                                        для pricing-checks. UI передаёт через ctx.
 * @returns {{ findings: HealthFinding[], score: number, counts: { error: number,
 *            warning: number, recommendation: number, info: number } }}
 */
export function evaluateCalculationHealth(calc, options = {}) {
    const safeCounts = { error: 0, warning: 0, recommendation: 0, info: 0 };
    if (!calc || typeof calc !== 'object') {
        return { findings: [], score: 100, counts: safeCounts };
    }
    const findings = [];
    for (const check of ALL_CHECKS) {
        try {
            const f = check(calc, options);
            if (f) findings.push(f);
        } catch (_err) {
            // защитный: один сломанный check не должен убивать всю оценку
            // (например, новое поле с несовместимым типом ответа)
        }
    }
    const counts = { ...safeCounts };
    for (const f of findings) {
        if (counts[f.severity] !== undefined) counts[f.severity]++;
    }
    return { findings, score: getHealthScore(findings), counts };
}

/**
 * Вычисляет финальный score по списку findings.
 * Шкала: clamp(100 − sum(HEALTH_PENALTY[sev]), 0, 100), целое число.
 */
export function getHealthScore(findings) {
    if (!Array.isArray(findings)) return 100;
    let penalty = 0;
    for (const f of findings) {
        const p = HEALTH_PENALTY[f?.severity];
        if (typeof p === 'number') penalty += p;
    }
    const score = 100 - penalty;
    if (score < 0) return 0;
    if (score > 100) return 100;
    return Math.round(score);
}

/**
 * Группирует findings по severity. Возвращает объект со ВСЕМИ 4 ключами
 * (даже пустыми) — чтобы UI мог рендерить пустые секции без NPE-проверок.
 */
export function groupHealthFindings(findings) {
    const groups = { error: [], warning: [], recommendation: [], info: [] };
    if (!Array.isArray(findings)) return groups;
    for (const f of findings) {
        if (f && HEALTH_SEVERITIES.includes(f.severity)) {
            groups[f.severity].push(f);
        }
    }
    return groups;
}

/**
 * Per-scenario evaluate. По решению пользователя (lock-in #2): UI вызывает
 * только для активного scenario. Для legacy-расчётов без scenario-структуры
 * scenarioId игнорируется и возвращается тот же результат, что и для всего calc.
 */
export function evaluateScenarioHealth(calc, scenarioId, options = {}) {
    if (!calc) {
        return { findings: [], score: 100,
            counts: { error: 0, warning: 0, recommendation: 0, info: 0 } };
    }
    const result = evaluateCalculationHealth(calc, options);
    if (scenarioId) {
        // Помечаем все findings заданным scenarioId для UI (drill-down).
        result.findings = result.findings.map(f => ({ ...f, scenarioId }));
    }
    return result;
}
