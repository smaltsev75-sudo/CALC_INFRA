import { el } from './dom.js';
import { icon } from './icons.js';
import { STAND_IDS, MONTHS_PER_YEAR } from '../utils/constants.js';
import { formatNumber, formatRubThousands } from '../services/format.js';

function fmtRubForPeriod(value, period) {
    return formatRubThousands(value, { fractionDigits: 0 });
}

const formatRub = formatRubThousands;

function periodSlash(period) {
    return period === 'daily' ? '/ день' : period === 'annual' ? '/ год' : '/ мес';
}

function periodMul(period) {
    return period === 'daily' ? 1 / 30 : period === 'annual' ? MONTHS_PER_YEAR : 1;
}

/* ---------- Вклад риск-коэффициентов ---------- */

/* 12.U20: НДС убран из карточки «Вклад риск-коэффициентов» — это налог, а не риск.
 * НДС применяется независимо от мастера `applyRiskFactors`, и смешивать его с
 * буферами/инфляцией в одной карточке семантически неверно. */
const RISK_COMPONENT_LABELS = Object.freeze({
    bufferFactor:   'Буферы (задачный + проектный)',
    inflationMul:   'Инфляция',
    seasonalMul:    'Сезонность',
    scheduleMul:    'Сдвиг расписания',
    contingencyMul: 'Резерв на риски'
});

export function computeRiskContribution(result, disabledStands = []) {
    const components = ['bufferFactor', 'inflationMul', 'seasonalMul', 'scheduleMul', 'contingencyMul'];
    const sum = { totalBase: 0, totalFinal: 0 };
    const weightedComp = Object.fromEntries(components.map(c => [c, 0]));
    const disabled = Array.isArray(disabledStands) ? disabledStands : [];
    for (const sid of STAND_IDS) {
        if (disabled.includes(sid)) continue;
        const bucket = result.stands?.[sid];
        if (!bucket) continue;
        for (const cell of bucket.items || []) {
            const base = cell.costBase || 0;
            if (base <= 0 || !cell.riskBreakdown) continue;
            sum.totalBase  += base;
            // Используем потенциальный final = base × реальные коэффициенты,
            // независимо от cell.costFinal (который в режиме «без рисков» = base).
            // Это позволяет показать «потенциальную» наценку даже когда
            // applyRiskFactors=false и она не учтена в ИТОГО.
            const totalRisk = cell.riskBreakdown.total || 1;
            sum.totalFinal += base * totalRisk;
            for (const c of components) {
                const v = cell.riskBreakdown[c];
                if (Number.isFinite(v) && v > 0) weightedComp[c] += base * Math.log(v);
            }
        }
    }
    if (sum.totalBase <= 0) return null;
    const overall = sum.totalFinal / sum.totalBase;
    const surplus = overall - 1;
    if (!Number.isFinite(surplus) || Math.abs(surplus) < 1e-9) return null;
    const comp = {};
    let lnSum = 0;
    for (const c of components) {
        const ln = weightedComp[c] / sum.totalBase;
        comp[c] = Math.exp(ln);
        lnSum += ln;
    }
    const items = [];
    for (const c of components) {
        const ln = Math.log(comp[c]);
        const share = lnSum !== 0 ? ln / lnSum : 0;
        items.push({
            id: c,
            label: RISK_COMPONENT_LABELS[c],
            multiplier: comp[c],
            shareOfSurplus: share,
            contribution: share * surplus
        });
    }
    return { overall, surplus, items };
}

/**
 * Подробный tooltip-текст для строки риск-коэффициента.
 * Использует фактические значения настроек из расчёта, чтобы пользователь
 * видел расчёт собственного множителя, а не абстрактную формулу.
 *
 * Объясняет ключевую неинтуитивность мультипликативной модели:
 * НДС 20% от уже наценённого = больше +20% от базы, потому что
 * каждый коэффициент бьёт по результату всех предыдущих.
 */
export function buildRiskRowTooltip(componentId, calc, contribPct, contribAmount, slash, multiplier) {
    const s = calc?.settings || {};
    const fmt2 = n => formatNumber(n, { min: 2, max: 2 });
    /* 12.U30-fix: ru-RU формат процентов (запятая) — согласован с UI карточек. */
    const pct1 = n => `${formatNumber(n * 100, { min: 1, max: 1 })}%`;
    const mulPct = (multiplier - 1) * 100;
    const tail = `\n\nСредний множитель ${fmt2(multiplier)} (+${formatNumber(mulPct, { min: 1, max: 1 })}% от базы).` +
                 `\nВклад в общую наценку: +${formatNumber(contribPct, { min: 1, max: 1 })}% (≈ ${formatRub(contribAmount)} ${slash}).` +
                 `\n\nПочему вклад больше номинала: коэффициенты применяются мультипликативно — каждый бьёт по уже наценённому числу. Например, НДС 20% от 130 ₽ (после буферов и инфляции) = +26 ₽, что больше +20% от базовой 100 ₽.`;

    switch (componentId) {
        case 'bufferFactor':
            return `Буферы — две запасные доли в стоимости:
• Буфер задачи: ${pct1(s.bufferTask || 0)} — на неучтённые работы внутри одного элемента.
• Буфер проекта: ${pct1(s.bufferProject || 0)} — на проектные риски (организационные, технические).

Расчёт: (1 + ${fmt2(s.bufferTask || 0)}) × (1 + ${fmt2(s.bufferProject || 0)}) = ${fmt2((1 + (s.bufferTask || 0)) * (1 + (s.bufferProject || 0)))}.

Применяется: ко всем элементам на всех стендах.${tail}`;

        case 'inflationMul':
            return `Инфляция — рост цен поставщиков за горизонт планирования.
• Годовая ставка: ${pct1(s.kInflation || 0)}.
• Горизонт планирования: ${s.planningHorizonYears || 1} ${(s.planningHorizonYears || 1) === 1 ? 'год' : 'лет'}.

Расчёт: ставка возводится в степень числа лет → ${fmt2(Math.pow(1 + (s.kInflation || 0), s.planningHorizonYears || 1))}.

Применяется: ко всем элементам на всех стендах.${tail}`;

        case 'seasonalMul':
            return `Сезонность — пиковая нагрузка в сезон.
• Множитель: ${pct1(s.kSeasonal || 0)} = коэффициент ${fmt2(1 + (s.kSeasonal || 0))}.

Применяется только к категориям с переменным потреблением: сетевые ресурсы, трафик, внешние сервисы, токены AI/LLM. Аппаратные ресурсы и лицензии не сезонят.${tail}`;

        case 'scheduleMul':
            return `Сдвиг расписания — простои и переработки на этапах нагрузочного тестирования и разовых работ.
• Множитель: ${pct1(s.kScheduleShift || 0)} = коэффициент ${fmt2(1 + (s.kScheduleShift || 0))}.

Применяется к стенду «Нагрузка» и ко всем элементам с разовым тарифом (внедрение, аудиты, сертификация).${tail}`;

        case 'contingencyMul':
            return `Резерв на риски — общая страховка на непредвиденные обстоятельства.
• Множитель: ${pct1(s.kContingency || 0)} = коэффициент ${fmt2(1 + (s.kContingency || 0))}.

Применяется: ко всем элементам на всех стендах.${tail}`;

        default:
            return `Множитель: ${fmt2(multiplier)} (+${formatNumber(mulPct, { min: 1, max: 1 })}%). Вклад: +${formatNumber(contribPct, { min: 1, max: 1 })}%.`;
    }
}

const RISK_OVERVIEW_TOOLTIP =
    'Как считается «Вклад риск-коэффициентов»\n\n' +
    'Пять риск-коэффициентов применяются МУЛЬТИПЛИКАТИВНО:\n' +
    '   итог = база × Буферы × Инфляция × Сезонность × Сдвиг × Резерв\n\n' +
    'Поэтому вклад каждого коэффициента БОЛЬШЕ его номинальной ставки: ' +
    'каждый следующий коэффициент применяется к УЖЕ наценённому числу.\n\n' +
    'Пример: резерв 5% от 100 ₽ = +5 ₽. ' +
    'Но резерв 5% от 130 ₽ (после буферов и инфляции) = +6,5 ₽ — ' +
    'это +6,5% к базовой 100 ₽, а не +5%.\n\n' +
    'Чем больше множитель коэффициента — тем больше его доля ' +
    'в общей наценке. Доли распределены так, чтобы их сумма ' +
    'была равна общей наценке сверху карточки.\n\n' +
    'НДС в эту карточку не входит — это отдельный налог, не риск. ' +
    'Он применяется к итогу независимо от того, включены риски или нет.';

export function renderRiskCard(result, calc, period, applyRisks = true) {
    const data = computeRiskContribution(result, result.disabledStands || []);
    if (!data) {
        return el('article', { class: 'dash-card dash-card-risk' },
            el('div', { class: 'dash-card-header' },
                el('div', { class: 'dash-card-eyebrow' },
                    el('span', { text: 'Вклад риск-коэффициентов' })
                )
            ),
            el('div', { class: 'dash-card-body dash-risk-empty',
                text: 'Все коэффициенты равны 1 — наценка от рисков отсутствует.' })
        );
    }

    const totalSurplusPct = data.surplus * 100;
    const mul = periodMul(period);
    const slash = periodSlash(period);
    // Базовая стоимость (без рисков). В режиме applyRisks=true result.totalMonthly
    // содержит costFinal-сумму с рисками, и базу нужно вычислить через overall.
    // В режиме applyRisks=false result.totalMonthly = costBase total — это и есть база.
    const totalMonthly = result.totalMonthly || 0;
    const baseMonthly = applyRisks
        ? (data.overall > 0 ? totalMonthly / data.overall : 0)
        : totalMonthly;
    const surplusMonthly = baseMonthly * data.surplus;
    const surplusPeriod = surplusMonthly * mul;

    const visible = data.items
        .filter(it => Math.abs(it.multiplier - 1) > 1e-6)
        // Сортировка по убыванию вклада в общую наценку (самый «дорогой» риск — первым).
        .sort((a, b) => b.shareOfSurplus - a.shareOfSurplus);

    return el('article', { class: 'dash-card dash-card-risk' },
        el('div', { class: 'dash-card-header' },
            el('div', { class: 'dash-card-eyebrow' },
                el('span', { text: 'Вклад риск-коэффициентов' }),
                el('span', { class: 'dash-card-eyebrow-tag', text: 'ИТОГО' }),
                el('span', { class: 'info-icon',
                    title: RISK_OVERVIEW_TOOLTIP,
                    attrs: { role: 'note', tabindex: '0', 'aria-label': 'Как считается вклад' }
                }, icon('info', { size: 12 }))
            ),
            el('div', { class: 'dash-card-eyebrow-sub' },
                el('span', { text: applyRisks ? 'Общая наценка ' : 'Потенциальная наценка ' }),
                el('span', { class: 'dash-risk-surplus',
                    /* 12.U26-fix: единый формат процента ru-RU (запятая) — согласовано с
                       «Распределение по категориям», где percent() даёт «41,7%». Раньше
                       .toFixed(1) выдавал «56.0%» (точка) → визуальный диссонанс. */
                    text: `${totalSurplusPct >= 0 ? '+' : ''}${formatNumber(totalSurplusPct, { min: 1, max: 1 })}%`
                }),
                el('span', { class: 'dash-risk-surplus-amount',
                    /* 12.U25-fix-14: убрана точка-разделитель «·» — пользователь воспринимал её как
                       мусор перед числом. column-gap родителя (.dash-card-eyebrow-sub) даёт
                       визуальную границу между процент-пиллом и суммой. */
                    text: `${fmtRubForPeriod(surplusPeriod, period)} ${slash}`
                }),
                !applyRisks
                    ? el('span', { class: 'dash-risk-surplus-note',
                        title: 'Сейчас риск-коэффициенты ВЫКЛЮЧЕНЫ в Опроснике — итог считается без них. Это сумма, на которую вырос бы итог, если бы вы их включили.',
                        text: ' (если применить)' })
                    : null
            )
        ),
        el('div', { class: 'dash-card-body dash-risk-body' },
            ...visible.map(it => {
                const contribPct = it.shareOfSurplus * data.surplus * 100;
                const contribAmount = surplusPeriod * it.shareOfSurplus;
                return el('div', { class: 'dash-risk-row',
                    title: buildRiskRowTooltip(it.id, calc, contribPct, contribAmount, slash, it.multiplier),
                    attrs: { tabindex: '0' }
                },
                    el('div', { class: 'dash-risk-row-head' },
                        el('span', { class: 'dash-risk-row-label', text: it.label }),
                        el('span', { class: 'dash-risk-row-amount',
                            /* 12.U25-fix-16: единица времени (/ год / мес / день) обязательна — без неё
                               «+25 817 тыс. ₽» оторвано от шапки «Общая наценка ... / год» и пользователь
                               вынужден помнить, в каком периоде смотрит дашборд. */
                            text: `${contribAmount >= 0 ? '+' : ''}${fmtRubForPeriod(contribAmount, period)} ${slash}`
                        }),
                        el('span', { class: 'dash-risk-row-value',
                            /* 12.U26-fix: ru-RU формат (запятая), согласован с категории. */
                            text: `${contribPct >= 0 ? '+' : ''}${formatNumber(contribPct, { min: 1, max: 1 })}%`
                        })
                    ),
                    el('span', { class: 'dash-risk-row-bar' },
                        el('span', { class: 'dash-risk-row-bar-fill',
                            style: { width: `${Math.max(0, Math.min(100, Math.abs(it.shareOfSurplus) * 100))}%` }
                        })
                    )
                );
            })
        )
    );
}
