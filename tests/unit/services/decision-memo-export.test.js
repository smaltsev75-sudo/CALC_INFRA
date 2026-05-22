/**
 * Unit-тесты Stage 15.5 — Decision Memo Export.
 *
 * Покрывает:
 *   - sanitizeMemoText (Markdown-escape, control-chars, длина).
 *   - sanitizeFilename (spec-chars, lowercase, fallback).
 *   - buildMemoFilename.
 *   - formatMemoMoney / formatMemoPercent.
 *   - buildDecisionMemo (структура объекта; budget=null если not_configured).
 *   - buildDecisionMemoMarkdown (наличие секций, опускание budget).
 *   - copyDecisionMemoToClipboard (success path; fallback при отсутствии).
 *   - downloadDecisionMemoMarkdown (DOM-mock).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    sanitizeMemoText,
    sanitizeFilename,
    buildMemoFilename,
    formatMemoMoney,
    formatMemoPercent,
    buildDecisionMemo,
    buildDecisionMemoMarkdown,
    copyDecisionMemoToClipboard,
    downloadDecisionMemoMarkdown
} from '../../../js/services/decisionMemoExport.js';

/* ============================================================
 * Фабрика context'а
 * ============================================================ */

function makeCtx(overrides = {}) {
    return {
        generatedAt: '2026-05-09T10:00:00.000Z',
        providerInfo: {
            providerId: 'sbercloud',
            version: '2025-Q4',
            updatedAt: '2025-12-15',
            status: 'свежий'
        },
        activeScenario: { id: 'main', name: 'Базовый' },
        health: {
            score: 78,
            counts: { error: 0, warning: 2, recommendation: 3, info: 1 },
            findings: [
                { id: 'w1', severity: 'warning', title: 'Нет HA-плана для PROD' },
                { id: 'w2', severity: 'warning', title: 'RTO выше нормы' },
                { id: 'r1', severity: 'recommendation', title: 'Указать backup retention' }
            ]
        },
        assumptions: {
            summary: { manual: 12, quick_start: 5, default: 23 },
            risky: [
                { fieldId: 'rto_hours', label: 'RTO, часов', value: 24, confidence: 'low' }
            ]
        },
        sensitivity: {
            topDrivers: [
                {
                    fieldId: 'pcu_target', label: 'Пиковая аудитория',
                    delta: { total: 480_000, opexMonthly: 480_000, capexMonthly: 0 },
                    deltaPercent: { total: 12 },
                    changeLabel: '+10%'
                },
                {
                    fieldId: 'sla_target', label: 'SLA',
                    delta: { total: 210_000, opexMonthly: 210_000, capexMonthly: 0 },
                    changeLabel: '+10%'
                }
            ]
        },
        budgetGuardrails: {
            status: 'warning',
            actual: { capexTotal: 4_200_000, capexMonthly: 350_000, opexMonthly: 1_180_000, totalMonthly: 1_530_000 },
            capex: { target: 5_000_000, actual: 4_200_000, gap: -800_000, gapPercent: -16, status: 'ok' },
            opex:  { target: 1_000_000, actual: 1_180_000, gap: 180_000,  gapPercent: 18, status: 'warning' },
            reasons: [
                { fieldId: 'pcu_target', label: 'Пиковая аудитория', impact: 480_000, costType: 'opex' }
            ],
            hints: [
                { fieldId: 'pcu_target', label: 'Пиковая аудитория', expectedSaving: 480_000, costType: 'opex' }
            ]
        },
        ...overrides
    };
}

function makeCalc(overrides = {}) {
    return {
        id: 'memo-t1',
        name: 'Test Calc',
        schemaVersion: 12,
        answers: {
            users_total: 50_000,
            pcu_target: 1000,
            sla_target: '99.95',
            ai_llm_used: true,
            pdn_152fz: false
        },
        answersMeta: {},
        settings: {},
        dictionaries: { questions: [], items: [], settings: {} },
        view: { disabledStands: [] },
        providerVersion: 'sbercloud@2025-Q4',
        ...overrides
    };
}

/* ============================================================
 * sanitizeMemoText
 * ============================================================ */

describe('sanitizeMemoText', () => {
    it('null/undefined → пустая строка', () => {
        assert.equal(sanitizeMemoText(null), '');
        assert.equal(sanitizeMemoText(undefined), '');
    });

    it('escape реальных inline-метасимволов Markdown', () => {
        const r = sanitizeMemoText('# Foo *bar* [link](url)');
        assert.match(r, /\\#/);
        assert.match(r, /\\\*/);
        assert.match(r, /\\\[/);
        // Stage 18.1.6: `(` и `)` БОЛЬШЕ НЕ escape'ятся — они метасимволы только
        // внутри `[text](url)` после square-bracket'а. В inline-output после
        // `**Label:**` они безвредны, escape давал ложно-обратные слэши в
        // user-facing memo (e.g. «Cloud.ru \(бывший SberCloud\)»).
        assert.doesNotMatch(r, /\\\(/, '`(` не должен escape\'иться (CommonMark inline)');
    });

    it('убирает HTML-теги через escape', () => {
        const r = sanitizeMemoText('<script>alert(1)</script>');
        // Угловые скобки сами по себе НЕ Markdown-метасимволы — не escape'ятся
        // на этом уровне, но выходом будет передан в renderMarkdown, где
        // escapeHtml преобразует < и > в &lt; / &gt;. Здесь проверяем только,
        // что не сломано.
        assert.ok(typeof r === 'string');
        assert.ok(r.length > 0);
    });

    it('усекает по умолчанию до 500 символов и добавляет …', () => {
        const long = 'a'.repeat(800);
        const r = sanitizeMemoText(long);
        assert.equal(r.length, 501);
        assert.ok(r.endsWith('…'));
    });

    it('переводы строк → пробел', () => {
        const r = sanitizeMemoText('foo\nbar\tbaz');
        assert.match(r, /foo bar baz/);
    });

    it('число → строка', () => {
        assert.equal(sanitizeMemoText(42), '42');
    });

    it('boolean → строка', () => {
        assert.equal(sanitizeMemoText(true), 'true');
    });
});

/* ============================================================
 * sanitizeFilename / buildMemoFilename
 * ============================================================ */

describe('sanitizeFilename', () => {
    it('заменяет пробелы на дефисы и lowercase', () => {
        assert.equal(sanitizeFilename('My Calc Name'), 'my-calc-name');
    });

    it('убирает FS-опасные символы', () => {
        assert.equal(sanitizeFilename('foo/bar:baz?qux'), 'foo_bar_baz_qux');
    });

    it('пустая строка → fallback', () => {
        assert.equal(sanitizeFilename(''), 'decision-memo.md');
        assert.equal(sanitizeFilename(null), 'decision-memo.md');
    });

    it('усекает до 200 символов', () => {
        const long = 'x'.repeat(500);
        assert.equal(sanitizeFilename(long).length, 200);
    });
});

describe('buildMemoFilename', () => {
    it('включает дату dd.mm.yyyy', () => {
        const r = buildMemoFilename({ name: 'Foo' }, new Date('2026-05-09T12:00:00Z'));
        // dateForFilename → 09.05.2026 (RU-формат единообразно с CSV/JSON exports)
        assert.match(r, /09\.05\.2026/);
        assert.match(r, /^decision-memo-/);
        assert.match(r, /\.md$/);
    });

    it('расчёт без имени → decision-memo-<date>.md', () => {
        const r = buildMemoFilename({ name: '' }, new Date('2026-05-09T12:00:00Z'));
        assert.equal(r, 'decision-memo-09.05.2026.md');
    });

    it('null calc → decision-memo-<date>.md', () => {
        const r = buildMemoFilename(null, new Date('2026-05-09T12:00:00Z'));
        assert.equal(r, 'decision-memo-09.05.2026.md');
    });
});

/* ============================================================
 * format helpers
 * ============================================================ */

describe('formatMemoMoney', () => {
    it('млн ₽ при больших значениях', () => {
        assert.match(formatMemoMoney(2_500_000), /2,50\s+млн/);
    });

    it('тыс. ₽ при средних', () => {
        assert.match(formatMemoMoney(150_000), /150,0\s+тыс/);
    });

    it('целые ₽ при малых', () => {
        assert.match(formatMemoMoney(750), /750\s+₽/);
    });

    it('NaN → —', () => {
        assert.equal(formatMemoMoney(NaN), '—');
        assert.equal(formatMemoMoney(null), '—');
    });

    it('отрицательные → префикс −', () => {
        assert.match(formatMemoMoney(-1000), /^−/);
    });
});

describe('formatMemoPercent', () => {
    it('положительное → префикс +', () => {
        assert.equal(formatMemoPercent(18), '+18,0%');
    });

    it('отрицательное → unicode minus', () => {
        assert.equal(formatMemoPercent(-5.5), '−5,5%');
    });

    it('NaN → —', () => {
        assert.equal(formatMemoPercent(NaN), '—');
    });
});

/* ============================================================
 * buildDecisionMemo (структура)
 * ============================================================ */

describe('buildDecisionMemo', () => {
    it('возвращает 8 секций', () => {
        const memo = buildDecisionMemo(makeCalc(), makeCtx());
        assert.ok(memo.sections.summary);
        assert.ok(memo.sections.keyParams);
        assert.ok(memo.sections.provider);
        assert.ok(memo.sections.assumptions);
        assert.ok(memo.sections.health);
        // Stage 18.1.12: sensitivity удалён из memo (раздел 4 удалён, дублировал раздел 2).
        assert.equal(memo.sections.sensitivity, undefined,
            'sensitivity-раздел больше НЕ часть memo (Stage 18.1.12)');
        assert.ok(memo.sections.budget); // budget warning → присутствует
        // Stage 18.1.6: раздел "Рекомендации" удалён из memo — Decision Memo это
        // ОБОСНОВАНИЕ для предъявления, список «что ещё доделать» подрывает доверие.
        assert.equal(memo.sections.recommendations, undefined);
    });

    it('Stage 18.1.6: memo НЕ содержит раздел «8. Рекомендации» — это обоснование, не план улучшений', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        assert.doesNotMatch(md, /## 8\.\s*Рекомендации/,
            'раздел «Рекомендации» в обосновании = противоречие цели документа');
        assert.doesNotMatch(md, /## \d+\. Рекомендации/,
            'раздел «Рекомендации» под любым номером запрещён в memo');
    });

    it('budget=null если статус not_configured', () => {
        const ctx = makeCtx({ budgetGuardrails: { status: 'not_configured' } });
        const memo = buildDecisionMemo(makeCalc(), ctx);
        assert.equal(memo.sections.budget, null);
    });

    it('calcName экранируется', () => {
        const memo = buildDecisionMemo(makeCalc({ name: '# Evil <script>' }), makeCtx());
        // Заголовок, тег и spec-chars НЕ должны попадать в "сыром" виде в memo:
        assert.doesNotMatch(memo.calcName, /^# /);
    });
});

/* ============================================================
 * buildDecisionMemoMarkdown
 * ============================================================ */

describe('buildDecisionMemoMarkdown', () => {
    it('содержит заголовок и название расчёта', () => {
        const md = buildDecisionMemoMarkdown(makeCalc({ name: 'My Project' }), makeCtx());
        assert.match(md, /# Обоснование расчёта инфраструктуры/);
        assert.match(md, /My Project/);
    });

    /* ============================================================
     * Stage 18.1.5 — параметры расчёта в Summary section
     * ============================================================ */

    it('Stage 18.1.5: Memo показывает «Режим расчёта: Без рисков» когда applyRiskFactors=false', () => {
        const calc = makeCalc({ settings: { applyRiskFactors: false } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        assert.match(md, /\*\*Режим расчёта:\*\*\s*Без рисков/i);
    });

    it('Stage 18.1.5: Memo показывает «Режим расчёта: С рисками» когда applyRiskFactors=true (или default)', () => {
        const calc = makeCalc({ settings: { applyRiskFactors: true } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        assert.match(md, /\*\*Режим расчёта:\*\*\s*С рисками/i);
    });

    it('Stage 18.1.5 / VAT-1 Phase 5: Memo показывает «Ставка НДС: 20% (...)» когда vatEnabled=true и vatRate=0.20', () => {
        const calc = makeCalc({ settings: { vatEnabled: true, vatRate: 0.20 } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        /* VAT-1 Phase 5: bulletLine переименован «НДС» → «Ставка НДС» и
           расширен суффиксом режима (auto/manual/frozen). */
        assert.match(md, /\*\*Ставка НДС:\*\*\s*20%/);
    });

    it('Stage 18.1.5: Memo показывает «НДС: не учитывается» когда vatEnabled=false', () => {
        const calc = makeCalc({ settings: { vatEnabled: false } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        assert.match(md, /\*\*НДС:\*\*\s*не учитывается/i);
    });

    it('Stage 18.1.5: Memo показывает горизонт планирования', () => {
        const calc = makeCalc({ settings: { planningHorizonYears: 3 } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        assert.match(md, /\*\*Горизонт планирования:\*\*\s*3\s*(год|года|лет)/i);
    });

    it('Stage 18.1.5: Memo показывает длительность фазы', () => {
        const calc = makeCalc({ settings: { phaseDurationMonths: 6 } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        assert.match(md, /\*\*Длительность фазы:\*\*\s*6\s*(мес|месяц)/i);
    });

    it('Stage 18.1.5: Memo показывает размеры стендов (DEV/ИФТ/ПСИ/НТ), PROD как эталон не дублирует', () => {
        const calc = makeCalc({ settings: {
            standSizeRatio: { DEV: 0.16, IFT: 0.40, PSI: 0.50, LOAD: 0.80, PROD: 1.00 }
        } });
        const md = buildDecisionMemoMarkdown(calc, makeCtx());
        assert.match(md, /\*\*Размеры стендов:\*\*/);
        assert.match(md, /DEV\s*16%/);
        assert.match(md, /ИФТ\s*40%/);
        assert.match(md, /ПСИ\s*50%/);
        assert.match(md, /НТ\s*80%/);
    });

    it('строка «Сформировано: <timestamp>.» не обёрнута в подчёркивания (Markdown emphasis)', () => {
        /* Stage 18.1.4: ранее строка экспортировалась как `_Сформировано: ...._`
           (курсив через `_..._`). По правкам пользователя — голый текст без
           emphasis, дата уже сама по себе достаточно выразительна. */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        // Стросnя «Сформировано: <timestamp>.» извлекается отдельно — проверяем
        // что у НЕЁ нет ни лидирующего, ни закрывающего `_`. Другие места в
        // memo (например, placeholder `_Состав стоимости не определён._`)
        // могут иметь курсив намеренно — они не покрыты этой проверкой.
        const generatedLine = md.split('\n').find(line => line.startsWith('Сформировано:'));
        assert.ok(generatedLine, 'строка «Сформировано: ...» должна существовать');
        assert.doesNotMatch(generatedLine, /^_/, 'у строки не должно быть лидирующего _');
        assert.doesNotMatch(generatedLine, /_$/, 'у строки не должно быть закрывающего _');
    });

    it('Stage 18.1.6: «Сформировано: » использует RU-формат `dd.mm.yyyy hh:mi`, НЕ ISO', () => {
        /* `generatedAt` в context'е — ISO-string (internal metadata), но в
           markdown-output он должен быть отформатирован через formatDateTime
           из services/format.js. Правило date-format-ru: пользователь не должен
           видеть ISO-timestamp в UI / экспорте / memo. */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        // makeCtx() даёт generatedAt='2026-05-09T10:00:00.000Z' (UTC).
        // formatDateTime использует локальный пояс — точное hh:mi зависит от TZ,
        // поэтому проверяем формат через regex, а не точное значение.
        assert.match(
            md,
            /^Сформировано: \d{2}\.\d{2}\.\d{4} \d{2}:\d{2}\.\s*$/m,
            'строка должна быть в формате «Сформировано: dd.mm.yyyy hh:mi.»'
        );
    });

    it('Stage 18.1.6: providerLabel из PROVIDER_OVERLAYS не экранируется Markdown-метасимволами (trusted constant)', () => {
        /* `providerLabel` приходит из `PROVIDER_OVERLAYS[id].label` — это domain
           constant («Cloud.ru (бывший SberCloud)»), не user-input. Sanitize
           через `sanitizeMemoText` escape'ит `(` и `)` как `\(`/`\)` → пользователь
           видит обратные слэши. Trusted значения должны выводиться как есть. */
        const md = buildDecisionMemoMarkdown(
            makeCalc(),
            makeCtx({
                providerInfo: {
                    providerId: 'sbercloud',
                    providerLabel: 'Cloud.ru (бывший SberCloud)',
                    version: '2025-Q4',
                    status: 'свежий'
                }
            })
        );
        assert.match(md, /Cloud\.ru \(бывший SberCloud\)/,
            'memo должен содержать «Cloud.ru (бывший SberCloud)» без обратных слэшей');
        assert.doesNotMatch(md, /Cloud\.ru\s*\\\(/,
            'memo НЕ должен содержать `\\(` после Cloud.ru (Markdown-escape констант запрещён)');
    });

    it('Stage 18.1.6: Раздел 2 — числа форматированы по RU и с единицей измерения', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        // users_total = 50000 → «50 000 чел.» (NBSP внутри 50 000)
        assert.match(md, /\*\*Накопленная аудитория[^:]*:\*\*\s*50[\s ]000\s*чел\./,
            'users_total должен быть с RU-форматом и unit «чел.»');
        // pcu_target = 1000 → «1 000 чел.»
        assert.match(md, /Пиковая одновременная аудитория[^:]*:\*\*\s*1[\s ]000\s*чел\./,
            'pcu_target должен быть с unit «чел.»');
        // sla_target = '99.95' → должен быть с %
        assert.match(md, /Целевой SLA[^:]*:\*\*\s*99[.,]95\s*%/,
            'sla_target должен быть с unit «%»');
    });

    it('Stage 18.1.6: дедуп — Summary НЕ дублирует «Версия прайса» и «Статус прайса» из раздела 3', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        const summary = md.split('## 2.')[0]; // только Summary часть
        assert.doesNotMatch(summary, /Версия прайса/,
            'Summary не должен содержать «Версия прайса» (это раздел 3)');
        assert.doesNotMatch(summary, /Статус прайса/,
            'Summary не должен содержать «Статус прайса» (это раздел 3)');
        // Но провайдер в Summary остаётся.
        assert.match(summary, /Провайдер:/, 'Summary должен содержать pretty-label провайдера');
    });

    it('Stage 18.1.6/7/12: дедуп — раздел «Использованные прайсы» НЕ дублирует «Провайдер» из Summary', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        // После 18.1.12 — Provider = раздел 4 (был 5, ещё раньше 3).
        const m = md.match(/## 4\.\s*Использованные прайсы[\s\S]*?(?=## 5\.|$)/);
        assert.ok(m, 'раздел «Использованные прайсы» должен существовать');
        const sectionProvider = m[0];
        assert.doesNotMatch(sectionProvider, /\*\*Провайдер:\*\*/,
            'раздел «Использованные прайсы» не должен содержать строку «Провайдер:» (уже в Summary)');
        assert.match(sectionProvider, /\*\*Версия:\*\*/, 'раздел содержит «Версия:»');
        assert.match(sectionProvider, /\*\*Статус:\*\*/, 'раздел содержит «Статус:»');
    });

    it('Stage 18.1.6/7/12: дедуп — раздел «Риски и замечания» НЕ дублирует «Оценка качества» из Summary', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        // После 18.1.12 — Health = раздел 6 (был 7, ещё раньше 5).
        const m = md.match(/## 6\.\s*Риски и замечания[\s\S]*?(?=## 7\.|$)/);
        assert.ok(m, 'раздел «Риски и замечания» должен существовать');
        const sectionHealth = m[0];
        assert.doesNotMatch(sectionHealth, /\*\*Оценка качества:\*\*/,
            'раздел «Риски и замечания» не должен содержать «Оценка качества» — она в Summary как «Качество расчёта»');
        const summary = md.split('## 2.')[0];
        assert.match(summary, /\*\*Качество расчёта:\*\*\s*78\s*\/\s*100/,
            'Summary должен содержать «Качество расчёта: 78 / 100»');
    });

    it('Stage 18.1.6: «Активный сценарий» НЕ показывается, если name = UUID-like', () => {
        /* В Quick Start новый сценарий получает UUID как id и часто как name.
           Memo не должен показывать «Активный сценарий: 20ed5d47-...» — UUID
           ничего не сообщает пользователю. */
        const md1 = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            activeScenario: { id: 'ea7614ff-da60-4a6e-b09f-9e8bbecff7ec', name: 'ea7614ff-da60-4a6e-b09f-9e8bbecff7ec' }
        }));
        assert.doesNotMatch(md1, /Активный сценарий:/,
            'строка «Активный сценарий» не должна выводиться при UUID-name');

        // Контроль: с человеческим именем — показывается.
        const md2 = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            activeScenario: { id: 'sc-1', name: 'Pre-launch' }
        }));
        assert.match(md2, /\*\*Активный сценарий:\*\*\s*Pre-launch/,
            'при человеческом имени строка должна выводиться');
    });

    it('Stage 18.1.6: скобки в item-names не escape\'ятся (Markdown-`(`/`)` не метасимволы вне `[..](url)`)', () => {
        /* После 18.1.12 удаления sensitivity раздела — тест перенесён на
           cost-composition (раздел 2), где у item-name тоже могут быть скобки. */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            costComposition: {
                totalAll: 100_000,
                topItems: [{ id: 'rag', name: 'СУБД (на vCPU)', category: 'LICENSE', totalMonthly: 100_000, share: 1.0 }],
                paretoNeeded: 1,
                top10Share: 1.0
            }
        }));
        assert.match(md, /СУБД \(на vCPU\)/, 'item-name со скобками без обратных слэшей');
        assert.doesNotMatch(md, /СУБД\s*\\\(/, 'не должно быть `\\(` после метки');
    });

    /* Stage 18.1.12: тесты раздела «Главные драйверы стоимости» удалены —
       sensitivity-раздел убран из memo (дублировал по смыслу раздел 2). */

    /* ============================================================
     * Stage 18.1.7 — структурная переработка: top-10 + Pareto + порядок секций
     * ============================================================ */

    it('Stage 18.1.7: новый раздел 2 «Что повлияло на стоимость больше всего» с Markdown-таблицей top-10', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            costComposition: {
                totalAll: 1_000_000,
                topItems: [
                    { id: 'cpu', name: 'vCPU (compute)', category: 'HW', totalMonthly: 600_000, share: 0.6 },
                    { id: 'ssd', name: 'SSD-диск',       category: 'HW', totalMonthly: 200_000, share: 0.2 }
                ],
                paretoNeeded: 2,
                top10Share: 0.8
            }
        }));
        assert.match(md, /## 2\.\s*Что повлияло на стоимость больше всего/,
            'раздел 2 должен называться «Что повлияло на стоимость больше всего»');
        // Table-header
        assert.match(md, /\|\s*#\s*\|\s*Статья затрат\s*\|\s*Категория\s*\|\s*₽\/мес\s*\|\s*Доля\s*\|/,
            'таблица top-10 должна иметь колонки # / Статья затрат / Категория / ₽/мес / Доля');
        // Хотя бы одна data-row
        assert.match(md, /\|\s*1\s*\|\s*vCPU \(compute\)\s*\|/,
            'таблица должна содержать ЭК «vCPU (compute)» без escape скобок');
    });

    /* Stage 18.1.12: тест «cap % > 100 %» удалён — раздел 4 (sensitivity)
       больше не выводится в memo, sensitivity-cap-логика перестала быть
       частью memo-output. */

    it('Stage 18.1.9: таблица top-10 в разделе 2 — pipe-aligned по ширине колонок (читается как plain-text)', () => {
        /* Stage 18.1.9 polishing: ячейки таблицы выравниваются padding'ом до
           ширины самой длинной cell в колонке. Цель — читаемость markdown'а
           в plain-text view (когда .md открывается в editor без table-render). */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            costComposition: {
                totalAll: 1_000_000,
                topItems: [
                    { id: 'a', name: 'Хранилище SSD/NVMe (горячее)', category: 'HW',       totalMonthly: 600_000, share: 0.6 },
                    { id: 'b', name: 'SMS',                          category: 'SERVICES', totalMonthly: 200_000, share: 0.2 }
                ],
                paretoNeeded: 1,
                top10Share: 0.8
            }
        }));
        // Извлечь раздел 2
        const m = md.match(/## 2\.\s*Что повлияло[\s\S]*?(?=## 3\.|$)/);
        assert.ok(m, 'раздел 2 должен существовать');
        const section2 = m[0];

        // Собираем все строки таблицы (header + separator + data).
        const tableLines = section2.split('\n').filter(l => l.startsWith('|'));
        assert.ok(tableLines.length >= 3, 'таблица должна содержать header + separator + ≥1 data-row');

        // Проверка: количество pipe-разделителей в каждой строке одинаково.
        const pipeCount = (s) => (s.match(/\|/g) || []).length;
        const expectedPipes = pipeCount(tableLines[0]);
        for (let i = 1; i < tableLines.length; i++) {
            assert.equal(pipeCount(tableLines[i]), expectedPipes,
                `pipe-count в строке ${i} (${tableLines[i]}) ≠ header pipe-count (${expectedPipes})`);
        }

        // Проверка: длина каждой строки таблицы одинакова (= pipe-aligned).
        const expectedLen = tableLines[0].length;
        for (let i = 1; i < tableLines.length; i++) {
            assert.equal(tableLines[i].length, expectedLen,
                `длина строки ${i} «${tableLines[i]}» (${tableLines[i].length}) ≠ длине header (${expectedLen})`);
        }
    });

    it('Stage 18.1.8: категории в top-10 показываются человекочитаемыми labels из CATEGORY_LABELS, не raw-кодами', () => {
        /* После 18.1.7 раздел 2 показывал raw-коды HW / LICENSE / SERVICES /
           SECURITY — технически. Stage 18.1.8 polishing — заменить на russian
           labels через CATEGORY_LABELS из constants.js (mapping уже существует,
           используется в дашборде/charts/comparison). */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            costComposition: {
                totalAll: 1_000_000,
                topItems: [
                    { id: 'cpu', name: 'vCPU', category: 'HW',       totalMonthly: 500_000, share: 0.5 },
                    { id: 'db',  name: 'СУБД', category: 'LICENSE',  totalMonthly: 300_000, share: 0.3 },
                    { id: 'sec', name: 'WAF',  category: 'SECURITY', totalMonthly: 100_000, share: 0.1 },
                    { id: 'tr',  name: 'CDN',  category: 'TRAFFIC',  totalMonthly:  50_000, share: 0.05 },
                    { id: 'rs',  name: 'B/U',  category: 'RESERVES', totalMonthly:  30_000, share: 0.03 },
                    { id: 'ai',  name: 'LLM',  category: 'AI',       totalMonthly:  10_000, share: 0.01 },
                    { id: 'sv',  name: 'OPS',  category: 'SERVICES', totalMonthly:  10_000, share: 0.01 }
                ],
                paretoNeeded: 3,
                top10Share: 1.0
            }
        }));
        // Все 7 категорий показаны как labels.
        assert.match(md, /Аппаратные ресурсы/, 'HW → «Аппаратные ресурсы»');
        assert.match(md, /Лицензии/,            'LICENSE → «Лицензии»');
        assert.match(md, /Безопасность/,        'SECURITY → «Безопасность»');
        assert.match(md, /Трафик/,              'TRAFFIC → «Трафик»');
        assert.match(md, /Резервы/,             'RESERVES → «Резервы»');
        assert.match(md, /AI \/ LLM/,           'AI → «AI / LLM»');
        assert.match(md, /Услуги/,              'SERVICES → «Услуги»');
        // Raw-коды НЕ должны выводиться как category-text.
        // (regex проверяет cell-content в табличной строке: `| HW |` etc.)
        for (const raw of ['HW', 'LICENSE', 'SERVICES', 'SECURITY', 'TRAFFIC', 'RESERVES']) {
            assert.doesNotMatch(md, new RegExp(`\\|\\s*${raw}\\s*\\|`),
                `raw-код «${raw}» не должен выводиться как category-cell — должен идти label`);
        }
    });

    it('Stage 18.1.7: Pareto-строка «Стоимость концентрирована» при paretoNeeded ≤ 10', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            costComposition: {
                totalAll: 1_000_000,
                topItems: [
                    { id: 'a', name: 'A', category: 'HW', totalMonthly: 800_000, share: 0.8 }
                ],
                paretoNeeded: 1,
                top10Share: 0.8
            }
        }));
        assert.match(md, /Стоимость концентрирована:\s*1\s*стать[яиь]\s*формиру[еют]+\s*80\s*%/i,
            'при paretoNeeded ≤ 10 — формулировка «Стоимость концентрирована: N стать(я|и|ей) формируют 80%...»');
    });

    it('Stage 18.1.7: Pareto-строка «Top-10 формируют X%; для 80% требуется N статей» при paretoNeeded > 10', () => {
        // 11 примерно одинаковых items → top-10 даёт ~91%, для 80% нужно 9 → но 9 ≤ 10.
        // Сделаем чтобы для 80% потребовалось 11 items (т.е. paretoNeeded=11).
        const items = Array.from({ length: 30 }, (_, i) => ({
            id: `it-${i}`, name: `Item-${i}`, category: 'HW',
            totalMonthly: 100, share: 100 / 3000
        }));
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            costComposition: {
                totalAll: 3000,
                topItems: items.slice(0, 10),
                paretoNeeded: 24, // 24 / 30 ≥ 80%
                top10Share: 10 / 30 // ≈ 33%
            }
        }));
        // `стат[а-яё]+` ловит «статей» (й — кириллица); .* без флага s не пересекает \n, но строка single-line.
        assert.match(md, /Top-10 стат[а-яё]+ формиру[а-яё]+ \d+[.,]\d+\s*%[^\n]*для достижения 80%[^\n]*требуется 24/i,
            'при paretoNeeded > 10 — формулировка «Top-10 формируют X%; для 80% требуется N статей»');
    });

    it('Stage 18.1.12: новый порядок разделов — без Sensitivity (раздел 4 удалён): Provider=4, Assumptions=5, Health=6, Budget=7', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        assert.match(md, /## 1\.\s*Краткое резюме/);
        assert.match(md, /## 2\.\s*Что повлияло/);
        assert.match(md, /## 3\.\s*Основные параметры/);
        assert.match(md, /## 4\.\s*Использованные прайсы/);
        assert.match(md, /## 5\.\s*Ключевые допущения/);
        assert.match(md, /## 6\.\s*Риски и замечания/);
        assert.match(md, /## 7\.\s*Бюджетные ограничения/);
        // Раздел «Главные драйверы стоимости» удалён.
        assert.doesNotMatch(md, /Главные драйверы стоимости/,
            'Sensitivity-раздел удалён — для обоснования он избыточен');
    });

    it('Stage 18.1.12: раздел «Использованные прайсы» без applied overlay — простой текст без жаргона «overlay»', () => {
        /* Без applied price-overlay (calc.providerVersion отсутствует) раздел
           показывал «Источник цен: базовые тарифы провайдера (overlay не импортирован)».
           Пользователю «overlay» непонятен — убираем скобочную часть. */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx({
            providerInfo: { providerId: 'sbercloud', providerLabel: 'Cloud.ru (бывший SberCloud)', version: null, status: null }
        }));
        const m = md.match(/## 4\.\s*Использованные прайсы[\s\S]*?(?=## 5\.|$)/);
        assert.ok(m, 'раздел «Использованные прайсы» должен существовать');
        const sectionProvider = m[0];
        assert.doesNotMatch(sectionProvider, /overlay/i,
            'без applied overlay — слово «overlay» не должно фигурировать в memo');
        assert.doesNotMatch(sectionProvider, /не импортирован/i,
            'без applied overlay — формулировка «не импортирован» убрана');
        assert.match(sectionProvider, /базовые тарифы провайдера/i,
            'формулировка остаётся: «базовые тарифы провайдера»');
    });

    it('Stage 18.1.6: memo markdown НЕ содержит ISO-timestamps ни в одном месте', () => {
        /* Контрольная проверка для всего memo — никаких `T\d{2}:\d{2}:\d{2}`
           ISO-фрагментов в готовом markdown. Распространяется на любые поля
           (generatedAt, provider.updatedAt, ассертские timestamp'ы), не только
           на «Сформировано:». */
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        assert.doesNotMatch(
            md,
            /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
            'memo содержит ISO-timestamp — все timestamp\'ы должны проходить через formatDateTime/formatDate из services/format.js'
        );
    });

    it('содержит провайдера', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        assert.match(md, /sbercloud/);
        assert.match(md, /2025-Q4/);
    });

    it('содержит health score', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        assert.match(md, /78 \/ 100/);
    });

    it('содержит assumptions summary', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        assert.match(md, /пользователь — 12/);
        assert.match(md, /Quick Start — 5/);
    });

    /* Stage 18.1.12: тест на «содержит sensitivity top drivers» удалён —
       sensitivity больше не часть memo (раздел 4 убран). */

    it('содержит секцию бюджета, если бюджет задан', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), makeCtx());
        // После 18.1.12 — Budget = раздел 7 (был 8, ещё раньше 7).
        assert.match(md, /## 7\. Бюджетные ограничения/);
        assert.match(md, /превышение/);
    });

    it('НЕ содержит секцию бюджета, если статус not_configured', () => {
        const ctx = makeCtx({ budgetGuardrails: { status: 'not_configured' } });
        const md = buildDecisionMemoMarkdown(makeCalc(), ctx);
        assert.doesNotMatch(md, /## 7\. Бюджетные ограничения/);
    });

    it('null calc → fallback с empty-state сообщением', () => {
        const md = buildDecisionMemoMarkdown(null, makeCtx());
        assert.match(md, /Нет активного расчёта/);
    });

    it('пустой context не ломает build', () => {
        const md = buildDecisionMemoMarkdown(makeCalc(), {});
        assert.match(md, /# Обоснование расчёта инфраструктуры/);
        // После 18.1.12 — Assumptions = раздел 5, Health = раздел 6.
        assert.match(md, /## 5\. Ключевые допущения/);
        assert.match(md, /## 6\. Риски и замечания/);
        // Sensitivity удалён в 18.1.12 — fallback-формулировка больше неактуальна.
    });

    it('HTML в calc.name НЕ исполняется (escape Markdown-метасимволов)', () => {
        const md = buildDecisionMemoMarkdown(
            makeCalc({ name: '# Big <script>alert(1)</script>' }),
            makeCtx()
        );
        // # должен быть escaped (\#), а не интерпретироваться как заголовок.
        // Также не должно быть инъекции в первую строку memo.
        const calcLine = md.split('\n').find(l => /Расчёт/.test(l)) || '';
        assert.match(calcLine, /\\#/);
        assert.doesNotMatch(calcLine, /^# /);
    });
});

/* ============================================================
 * copyDecisionMemoToClipboard
 * ============================================================ */

describe('copyDecisionMemoToClipboard', () => {
    // Helper: navigator в Node 22 — getter, нельзя присвоить напрямую.
    // Используем Object.defineProperty с configurable:true.
    function withFakeNavigator(impl, fn) {
        const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', { value: impl, configurable: true, writable: true });
        try { return fn(); }
        finally {
            if (desc) Object.defineProperty(globalThis, 'navigator', desc);
            else delete globalThis.navigator;
        }
    }

    it('navigator.clipboard.writeText → success', async () => {
        let captured = null;
        const result = await withFakeNavigator(
            { clipboard: { writeText: async (s) => { captured = s; } } },
            () => copyDecisionMemoToClipboard('hello')
        );
        assert.equal(result, true);
        assert.equal(captured, 'hello');
    });

    it('clipboard.writeText throws → false (без бросания)', async () => {
        const origDoc = globalThis.document;
        // Нет document → fallback ничего не сделает, вернёт false.
        globalThis.document = undefined;
        try {
            const result = await withFakeNavigator(
                { clipboard: { writeText: async () => { throw new Error('denied'); } } },
                () => copyDecisionMemoToClipboard('hello')
            );
            assert.equal(result, false);
        } finally {
            globalThis.document = origDoc;
        }
    });

    it('null/undefined → пустая строка передана успешно', async () => {
        let captured = null;
        const result = await withFakeNavigator(
            { clipboard: { writeText: async (s) => { captured = s; } } },
            () => copyDecisionMemoToClipboard(null)
        );
        assert.equal(result, true);
        assert.equal(captured, '');
    });
});

/* ============================================================
 * downloadDecisionMemoMarkdown
 * ============================================================ */

describe('downloadDecisionMemoMarkdown', () => {
    it('создаёт <a download="..."> и кликает по нему', () => {
        const calls = { appended: 0, removed: 0, clicked: 0 };
        const origDoc = globalThis.document;
        const origURL = globalThis.URL;
        const origBlob = globalThis.Blob;
        const origSetTimeout = globalThis.setTimeout;

        let lastA = null;
        globalThis.Blob = class FakeBlob {
            constructor(parts) { this.parts = parts; }
        };
        globalThis.URL = {
            createObjectURL: () => 'blob:fake',
            revokeObjectURL: () => {}
        };
        globalThis.document = {
            createElement: () => {
                const a = { href: '', download: '', style: {}, click: () => { calls.clicked++; } };
                lastA = a;
                return a;
            },
            body: {
                appendChild: () => { calls.appended++; },
                removeChild: () => { calls.removed++; }
            }
        };
        globalThis.setTimeout = (fn) => fn();

        try {
            downloadDecisionMemoMarkdown('# memo', 'My File.md');
            assert.equal(calls.clicked, 1);
            assert.equal(calls.appended, 1);
            assert.equal(calls.removed, 1);
            assert.equal(lastA.download, 'my-file.md');
            assert.equal(lastA.href, 'blob:fake');
        } finally {
            globalThis.document = origDoc;
            globalThis.URL = origURL;
            globalThis.Blob = origBlob;
            globalThis.setTimeout = origSetTimeout;
        }
    });

    it('добавляет .md если отсутствует', () => {
        const origDoc = globalThis.document;
        const origURL = globalThis.URL;
        const origBlob = globalThis.Blob;
        const origSetTimeout = globalThis.setTimeout;

        let lastA = null;
        globalThis.Blob = class FakeBlob { constructor(parts) { this.parts = parts; } };
        globalThis.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };
        globalThis.document = {
            createElement: () => {
                const a = { href: '', download: '', style: {}, click: () => {} };
                lastA = a;
                return a;
            },
            body: { appendChild: () => {}, removeChild: () => {} }
        };
        globalThis.setTimeout = (fn) => fn();

        try {
            downloadDecisionMemoMarkdown('# memo', 'no-extension');
            assert.match(lastA.download, /\.md$/);
        } finally {
            globalThis.document = origDoc;
            globalThis.URL = origURL;
            globalThis.Blob = origBlob;
            globalThis.setTimeout = origSetTimeout;
        }
    });
});
