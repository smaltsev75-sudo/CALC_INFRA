import { formatRubThousands } from '../../services/format.js';
import { MONTHS_PER_YEAR } from '../../utils/constants.js';

/* ============================================================
 * Vocabulary and formatting helpers shared by planner modal parts
 * ============================================================ */

export const RISK_BADGE = Object.freeze({
    low:    { label: 'Низкий риск',  cls: 'cop-risk-low'    },
    medium: { label: 'Средний риск', cls: 'cop-risk-medium' },
    high:   { label: 'Высокий риск', cls: 'cop-risk-high'   }
});

/* Constraint-toggle'ы. Подпись соответствует Stage 18.1 спеку «Modal layout
   → Constraints» — без «(per Stage X.Y)»-жаргона. */
export const CONSTRAINT_TOGGLES = Object.freeze([
    { key: 'allowReliabilityTradeoff', label: 'Можно снижать SLA',         hint: 'Открывает рычаг снижения целевого SLA. Высокий риск.' },
    { key: 'allowNonProdReduction',    label: 'Можно уменьшать стенды',    hint: 'Уменьшение стендов DEV / ИФТ / ПСИ / НТ.' },
    { key: 'allowRiskBufferReduction', label: 'Можно снижать риск-буферы', hint: 'Снижение bufferTask / bufferProject / contingency / schedule shift.' },
    { key: 'allowAiReduction',         label: 'Можно уменьшать AI / RAG',  hint: 'Сокращение output-токенов, корпуса и эмбеддингов RAG.' },
    { key: 'allowRetentionReduction',  label: 'Можно уменьшать retention', hint: 'Сокращение срока хранения бэкапов в пределах compliance-floor.' },
    { key: 'protectCompliance',        label: 'Защитить compliance',       hint: 'Запрет уходить ниже compliance-минимума (например, retention 90 дней).' }
]);

export function periodMul(period) {
    return period === 'daily' ? 1 / 30 : period === 'annual' ? MONTHS_PER_YEAR : 1;
}

export function periodSlash(period) {
    return period === 'daily' ? '/ день' : period === 'annual' ? '/ год' : '/ мес';
}

export function formatRubPeriod(value, period) {
    if (!Number.isFinite(value)) return '—';
    /* Все суммы в модалке — в тыс. ₽. На дневном периоде значения малы
       (десятки/сотни тыс.), округление каждой карточки вниз ломает сумму
       (50 + 112 ≠ 163), поэтому daily выводим с 1 знаком после запятой —
       тот же приём, что в Dashboard (12.U25-fix-10). */
    const fd = period === 'daily' ? 1 : 0;
    return `${formatRubThousands(value, { fractionDigits: fd })} ${periodSlash(period)}`;
}

export function formatValueGeneric(v) {
    if (!Number.isFinite(v)) return '—';
    if (Math.abs(v) >= 100) return Math.round(v).toLocaleString('ru-RU');
    if (Math.abs(v) >= 1)   return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

export function pluralParams(n) {
    /* «1 параметр», «2 параметра», «5 параметров» — RU-плюрализация. */
    const mod10  = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'параметр';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'параметра';
    return 'параметров';
}

/* PATCH 2.14.17: русское склонение «год» для planningHorizonYears.
   1 год / 2 года / 5 лет. Простой алгоритм по правилам ру-плюрализации. */
export function pluralYears(n) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return 'год';
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'года';
    return 'лет';
}

/* PATCH 2.14.17: значения форматируются с учётом lever.unit (выставляется
   в domain buildEditableLevers через deriveLeverUnit). Раньше единицы
   определялись эвристиками внутри formatValueShort, что давало голые
   «0,15» вместо «15 %» для kContingency/bufferTask и расходилось со
   стилем «% от ПРОМ» для standSizeRatio.

   Контракт по типам:
     - percent editor (settings_ratio / settings_field) → значение 0..1 → ×100, без знаков после запятой
     - enum SLA               → «99,9 %» (один знак после запятой, обрезается)
     - enum backup_retention  → «90 дн.»
     - number_int horizon     → «3 года» (склонение)
     - number_int ai_tokens   → «1 200 токенов»
     - number_float rag_corpus / embeddings → значение + ' ГБ' / ' млн векторов'
 */
export function formatValueShort(v, lever) {
    if (!Number.isFinite(v)) return '—';
    const editor = lever?.editor;
    const unit = lever?.unit || '';

    // Special case: planningHorizon — целое число лет со склонением (поверх unit).
    if (editor?.editorType === 'number_int' && lever?.fieldId === 'setting:planningHorizonYears') {
        const n = Math.round(v);
        return `${n} ${pluralYears(n)}`;
    }

    // Percent editor: storage value 0..1 (ratio/доля) → проценты.
    // unit '% от ПРОМ' / '%' уже несёт ' %' в постфиксе.
    if (editor?.editorType === 'percent') {
        const formatted = (v * 100).toFixed(0);
        // unit '% от ПРОМ' начинается с '%' — не дублируем «%»: подставляем «N% от ПРОМ» или «N %»
        if (unit === '% от ПРОМ')  return `${formatted} % от ПРОМ`;
        return `${formatted} %`;
    }

    // Enum: SLA — десятичный процент; backup_retention — целые дни.
    if (editor?.editorType === 'enum') {
        if (unit === 'дн.') return `${Math.round(v)} дн.`;
        if (unit === '%')   return `${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`;
        // Fallback: эвристики прежней реализации.
        if (Math.abs(v) >= 1000) return `${Math.round(v)} дн.`;
        if (Number.isInteger(v) && Math.abs(v) >= 7 && Math.abs(v) <= 9000) return `${v} дн.`;
        return `${v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')} %`;
    }

    // Integer non-horizon (AI tokens и др.).
    if (editor?.editorType === 'number_int') {
        const n = Math.round(v);
        const num = n.toLocaleString('ru-RU');
        return unit ? `${num} ${unit}` : num;
    }

    // number_float (RAG corpus, embeddings).
    let core;
    if (Math.abs(v) >= 100)      core = Math.round(v).toLocaleString('ru-RU');
    else if (Math.abs(v) >= 10)  core = v.toFixed(1).replace(/\.0$/, '');
    else                          core = v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return unit ? `${core} ${unit}` : core;
}
