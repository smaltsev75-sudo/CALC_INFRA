/**
 * PATCH 2.14.17 — End-to-end проверка рендера Cost Optimization Planner модалки:
 *   - реальный buildEditableLevers + groupOptimizationLevers
 *   - реальный renderCostOptimizationPlannerModal через DOM-mock
 *   - traverse DOM-дерева, поиск текстовых узлов с unit и description
 *
 * Цель: доказать, что при v=800 для rag_corpus в UI рендерится «800 ГБ»,
 * а не «800» — независимо от кэша браузера. Если тест ПРОХОДИТ — пользователь
 * на стейл-кэше. Если ПАДАЕТ — есть невидимый сбой в data-flow.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- DOM-mock (паттерн из tests/unit/ui/print-answers.test.js) ---------- */

function makeMockElement(tag = 'div') {
    const node = {
        tagName: tag.toUpperCase(),
        children: [],
        childNodes: [],
        attributes: {},
        style: {},
        dataset: {},
        classList: {
            _list: new Set(),
            add(c) { this._list.add(c); },
            remove(c) { this._list.delete(c); },
            contains(c) { return this._list.has(c); }
        },
        className: '',
        id: '',
        textContent: '',
        innerHTML: '',
        title: '',
        appendChild(c) {
            if (c) {
                this.children.push(c);
                this.childNodes.push(c);
                if (c.nodeType === 3) this.textContent += c.textContent;
            }
            return c;
        },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) { this.children.splice(i, 1); this.childNodes.splice(i, 1); }
            return c;
        },
        remove() {},
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener() {}, removeEventListener() {},
        focus() {}, blur() {},
        // querySelector: simple text-content lookup
        querySelectorAll(sel) {
            const matches = [];
            function walk(n) {
                if (n && n.classList && typeof sel === 'string' && sel.startsWith('.')) {
                    if (n.classList.contains(sel.slice(1))) matches.push(n);
                }
                if (n && n.children) for (const c of n.children) walk(c);
            }
            walk(this);
            return matches;
        }
    };
    return node;
}

function collectText(node) {
    if (!node) return '';
    if (node.nodeType === 3) return node.textContent || '';
    let out = node.textContent || '';
    if (node.children) for (const c of node.children) {
        if (c.nodeType !== 3) out += ' ' + collectText(c);
    }
    return out;
}

before(() => {
    globalThis.document = {
        createElement: (tag) => makeMockElement(tag),
        createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
        body: makeMockElement('body'),
        addEventListener: () => {}, removeEventListener: () => {}
    };
    globalThis.window = {
        addEventListener: () => {}, removeEventListener: () => {},
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        location: { hash: '' },
        navigator: { userAgent: 'node-test' }
    };
});

describe('PATCH 2.14.17 e2e: RAG corpus в модалке показывает unit + description', { concurrency: false }, () => {
    it('lever имеет unit="ГБ" и непустой description', async () => {
        const seed = await import('../../../js/domain/seed.js');
        const planner = await import('../../../js/domain/costOptimizationPlanner.js');
        const calc = {
            settings: {
                applyRiskFactors: true,
                standSizeRatio: { DEV:0.16, IFT:0.4, PSI:0.5, PROD:1, LOAD:1 },
                planningHorizonYears: 3, bufferTask: 0.3, bufferProject: 0.15,
                kContingency: 0.05, kScheduleShift: 0.15, kSeasonal: 0,
                kInflation: 0.07, vatEnabled: true, vatRate: 0.20,
                daysPerMonth: 30, phaseDurationMonths: 12
            },
            answers: { ai_llm_used: true, rag_needed: true, rag_corpus_size_gb: 800 },
            dictionaries: { questions: seed.SEED_QUESTIONS, items: seed.SEED_ITEMS }
        };
        const draft = planner.createOptimizationDraft({ calc, level: 'ambitious' });
        const groups = planner.groupOptimizationLevers(calc, draft);

        let ragLever = null;
        for (const g of groups) {
            for (const lev of g.levers) {
                if (lev.leverSpecId === 'rag_corpus') { ragLever = lev; break; }
            }
            if (ragLever) break;
        }
        assert.ok(ragLever, 'lever rag_corpus должен присутствовать в группах');
        assert.equal(ragLever.unit, 'ГБ', 'unit должен быть "ГБ"');
        assert.ok(ragLever.description && ragLever.description.length > 20,
            'description должен быть непустым (из question.description в seed.js)');
        assert.ok(ragLever.description.includes('гигабайт') || ragLever.description.includes('ГБ') || ragLever.description.includes('RAG'),
            `description должен содержать суть параметра, реальный: «${ragLever.description.slice(0, 80)}»`);
    });

    it('renderCostOptimizationPlannerModal: в DOM присутствует «800 ГБ» и описание', async () => {
        const seed = await import('../../../js/domain/seed.js');
        const planner = await import('../../../js/domain/costOptimizationPlanner.js');
        // Re-import с очисткой кэша не нужен — это новый процесс.
        const modal = await import('../../../js/ui/modals/costOptimizationPlannerModal.js');

        const calc = {
            settings: {
                applyRiskFactors: true,
                standSizeRatio: { DEV:0.16, IFT:0.4, PSI:0.5, PROD:1, LOAD:1 },
                planningHorizonYears: 3, bufferTask: 0.3, bufferProject: 0.15,
                kContingency: 0.05, kScheduleShift: 0.15, kSeasonal: 0,
                kInflation: 0.07, vatEnabled: true, vatRate: 0.20,
                daysPerMonth: 30, phaseDurationMonths: 12
            },
            answers: { ai_llm_used: true, rag_needed: true, rag_corpus_size_gb: 800 },
            dictionaries: { questions: seed.SEED_QUESTIONS, items: seed.SEED_ITEMS }
        };
        const draft = planner.createOptimizationDraft({ calc, level: 'ambitious' });

        // Передаём state в форме, ожидаемой renderCostOptimizationPlannerModal
        const state = {
            calcList: [calc],
            activeCalc: calc,
            modals: {
                costOptimizationPlanner: {
                    open: true,
                    draft,
                    openGroups: ['ai']  // открываем группу AI чтобы RAG-рычаги отрисовались
                }
            }
        };
        const ctx = {
            updateOptimizationDraftValue() {},
            removeOptimizationDraftChange() {},
            toggleOptimizationConstraint() {},
            closeCostOptimizationPlannerModal() {},
            focusQuestion() {},
            openSummaryFormula() {}
        };
        const rendered = modal.renderCostOptimizationPlannerModal(state, ctx);
        assert.ok(rendered, 'модалка должна отрисоваться');

        const fullText = collectText(rendered);

        // ГЛАВНОЕ: проверяем что «800 ГБ» появилось в тексте,
        // НЕ просто «800» без единицы.
        assert.ok(
            fullText.includes('800 ГБ'),
            `В рендере должно быть «800 ГБ» (для baseValue rag_corpus). Реальный текст начала: «${fullText.slice(0, 1500)}…»`
        );
        // Описание из seed.js (question.description) тоже должно быть в DOM
        assert.ok(
            fullText.includes('гигабайт') || fullText.includes('RAG'),
            'description из seed.js должен быть в рендере (.cop-lever-description)'
        );

        // Дополнительно: проверим что есть строки «Сейчас: 800 ГБ» и «Диапазон: 1 ГБ – 800 ГБ»
        assert.ok(
            fullText.includes('Сейчас: 800 ГБ'),
            'формат «Сейчас: 800 ГБ» должен присутствовать'
        );
        assert.ok(
            /Диапазон:\s*1\s+ГБ\s*–\s*800\s+ГБ/.test(fullText),
            `формат «Диапазон: 1 ГБ – 800 ГБ» должен присутствовать. Найдено: ${
                (fullText.match(/Диапазон[^\n]{0,80}/) || [])[0]
            }`
        );
    });
});
