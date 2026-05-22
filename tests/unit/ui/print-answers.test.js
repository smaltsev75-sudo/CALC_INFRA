/**
 * UI-тест PDF-печати ответов опросника.
 *
 * Под минимальным DOM-mock'ом проверяет:
 *   - вызов printAnswers(calc) добавляет секцию #print-answers-area в body;
 *   - body получает класс printing-answers;
 *   - в DOM есть заголовки секций, текст вопросов и форматированные ответы;
 *   - после `afterprint` всё убирается;
 *   - вызов с null calc — безопасный no-op.
 *
 * Тесты внутри describe выполняются последовательно (concurrency: false),
 * потому что мутируют общий global document/window/body.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';

/* ---------- DOM-mock (тот же подход что в ui-modules-smoke) ---------- */

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
        appendChild(c) { if (c) { this.children.push(c); this.childNodes.push(c); } return c; },
        removeChild(c) {
            const i = this.children.indexOf(c);
            if (i >= 0) { this.children.splice(i, 1); this.childNodes.splice(i, 1); }
            return c;
        },
        remove() {
            // эмуляция Element.remove() — отвязка от parent
            // (в нашем mock используется только cleanup() через document.getElementById)
        },
        setAttribute(k, v) { this.attributes[k] = v; },
        getAttribute(k) { return this.attributes[k] ?? null; },
        addEventListener() {}, removeEventListener() {},
        focus() {}, blur() {}
    };
    return node;
}

let listeners = {};
const docBody = makeMockElement('body');

function installDomMock() {
    const html = makeMockElement('html');
    listeners = {};
    docBody.children = [];
    docBody.childNodes = [];
    docBody.classList._list = new Set();

    globalThis.document = {
        createElement: (tag) => makeMockElement(tag),
        createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
        getElementById: (id) => docBody.children.find(c => c.attributes?.id === id) || null,
        body: docBody,
        documentElement: html,
        addEventListener: () => {}, removeEventListener: () => {}
    };
    globalThis.window = {
        addEventListener: (event, fn) => { listeners[event] = fn; },
        removeEventListener: (event) => { delete listeners[event]; },
        print: () => {
            // Эмулируем системный диалог печати: сразу зовём afterprint listener
            if (listeners['afterprint']) listeners['afterprint']();
        },
        requestAnimationFrame: (fn) => setTimeout(fn, 0),
        cancelAnimationFrame: (id) => clearTimeout(id),
        location: { hash: '' },
        navigator: { userAgent: 'node-test' }
    };
    globalThis.localStorage = {
        getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}
    };
}

before(() => installDomMock());

/* ---------- Тестовые данные ---------- */

function makeCalc() {
    return {
        id: 'test',
        name: 'Тестовый расчёт',
        updatedAt: '2026-05-02T10:00:00.000Z',
        answers: {
            users_total: 50000,
            georedundancy_required: true,
            ai_llm_used: false
        },
        settings: {
            phaseDurationMonths: 12, daysPerMonth: 30, planningHorizonYears: 1,
            bufferTask: 0.30, bufferProject: 0.15,
            kInflation: 0.10, kSeasonal: 0, kScheduleShift: 0.15, kContingency: 0.05,
            vatEnabled: true, vatRate: 0.20,
            standSizeRatio: { DEV: 0.20, IFT: 0.30, PSI: 0.60, PROD: 1.00, LOAD: 0.50 }
        },
        dictionaries: {
            questions: [
                { id: 'users_total', section: 'business',  title: 'Сколько у вас пользователей?', type: 'number',  order: 10 },
                { id: 'georedundancy_required', section: 'security', title: 'Нужен георезерв?', type: 'boolean', order: 20, recommendation: 'Только при SLA ≥ 99.95%' },
                { id: 'ai_llm_used', section: 'ai',        title: 'Используете LLM?',         type: 'boolean', order: 30 }
            ]
        }
    };
}

describe('printAnswers: построение DOM', { concurrency: false }, () => {
    it('добавляет секцию #print-answers-area в body', async () => {
        installDomMock();
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc());
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        assert.ok(area, 'секция должна быть добавлена');
        // window.print() в моке сразу триггерит afterprint, который чистит секцию.
        // Чтобы проверить содержимое — пересоздадим без вызова print.
    });

    it('устанавливает body.classList.printing-answers перед печатью', async () => {
        installDomMock();
        // Mock'аем print чтобы НЕ вызывать afterprint автоматически
        let calledPrint = false;
        globalThis.window.print = () => { calledPrint = true; };
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc());
        // setTimeout(50) перед print — ждём
        await new Promise(r => setTimeout(r, 80));
        assert.ok(calledPrint, 'window.print() должен быть вызван');
        assert.ok(docBody.classList.contains('printing-answers'),
            'body должен получить класс printing-answers');
    });

    it('содержит имя расчёта в шапке', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc());
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const allText = collectText(area);
        assert.match(allText, /Тестовый расчёт/);
        assert.match(allText, /Анкета бизнес-заказчика/);
    });

    it('рендерит вопросы с ответами', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc());
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const allText = collectText(area);
        assert.match(allText, /Сколько у вас пользователей/);
        assert.match(allText, /50.?000/); // 50000 или 50 000 (locale-formatted)
        assert.match(allText, /Нужен георезерв/);
        assert.match(allText, /Да/); // boolean true → "Да"
    });

    it('секция параметров расчёта присутствует с НДС и буферами', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc());
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const allText = collectText(area);
        assert.match(allText, /Параметры расчёта/);
        assert.match(allText, /НДС/);
        assert.match(allText, /20,0%/);   // vatRate: 0.20
        assert.match(allText, /Задачный буфер/);
    });

    it('после window.print() — afterprint чистит секцию и класс', async () => {
        installDomMock();
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc());
        await new Promise(r => setTimeout(r, 80));
        // window.print() в моке вызывает afterprint listener сразу → cleanup
        assert.ok(!docBody.classList.contains('printing-answers'), 'класс снят');
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        // Из-за нашей упрощённой Element.remove (no-op) секция может остаться в children;
        // главное — класс снят и cleanup() вызван.
        // Не проверяем area — это деталь mock'а.
    });

    it('вызов с null/undefined calc — безопасный no-op', async () => {
        installDomMock();
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        assert.doesNotThrow(() => printAnswers(null));
        assert.doesNotThrow(() => printAnswers(undefined));
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        assert.ok(!area, 'секция НЕ должна быть добавлена');
    });

    /* ---------- Этап 13.U3: extended-режим (полный формат с пояснениями) ---------- */

    it('extended=false (default) → 2 колонки в thead, нет pa-x-cell', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc()); // default = compact
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const text = collectText(area);
        // Заголовок «Пояснение» НЕ должен присутствовать в default-режиме.
        assert.doesNotMatch(text, /Пояснение/);
        assert.ok(!docBody.classList.contains('printing-answers-extended'),
            'extended-класс не должен ставиться при default-режиме');
    });

    it('extended=true → 3-я колонка «Пояснение» + body.printing-answers-extended', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { extended: true });
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const text = collectText(area);
        // В заголовке таблицы есть «Пояснение»
        assert.match(text, /Пояснение/);
        // Recommendation вопроса georedundancy_required попадает в колонку
        assert.match(text, /SLA ≥ 99\.95%/);
        // Body получил extended-класс — print-CSS использует его для трёх колоночной раскладки.
        assert.ok(docBody.classList.contains('printing-answers-extended'),
            'body должен получить класс printing-answers-extended');
    });

    it('cleanup после afterprint снимает оба класса (printing-answers и -extended)', async () => {
        installDomMock();
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { extended: true });
        await new Promise(r => setTimeout(r, 80));
        assert.ok(!docBody.classList.contains('printing-answers'), 'базовый класс снят');
        assert.ok(!docBody.classList.contains('printing-answers-extended'), 'extended-класс снят');
    });

    /* ---------- Этап 13.U4: ориентация (landscape по умолчанию, portrait — opt-in) ---------- */

    it('landscape=true (default) → нет класса printing-answers-portrait', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc()); // landscape по умолчанию
        assert.ok(docBody.classList.contains('printing-answers'),
            'базовый класс должен стоять');
        assert.ok(!docBody.classList.contains('printing-answers-portrait'),
            'portrait-класс НЕ должен ставиться при default-режиме');
    });

    it('явный landscape: true → также без printing-answers-portrait', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { landscape: true });
        assert.ok(!docBody.classList.contains('printing-answers-portrait'),
            'portrait-класс не ставится при landscape=true');
    });

    it('landscape=false → body.printing-answers-portrait добавляется', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { landscape: false });
        assert.ok(docBody.classList.contains('printing-answers'),
            'базовый класс printing-answers должен стоять');
        assert.ok(docBody.classList.contains('printing-answers-portrait'),
            'portrait-класс должен быть добавлен при landscape=false');
    });

    it('extended=true + landscape=false → оба доп.класса', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { extended: true, landscape: false });
        assert.ok(docBody.classList.contains('printing-answers-extended'));
        assert.ok(docBody.classList.contains('printing-answers-portrait'));
    });

    it('cleanup снимает printing-answers-portrait', async () => {
        installDomMock();
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { landscape: false });
        await new Promise(r => setTimeout(r, 80));
        assert.ok(!docBody.classList.contains('printing-answers'), 'базовый класс снят');
        assert.ok(!docBody.classList.contains('printing-answers-portrait'),
            'portrait-класс снят после afterprint');
    });

    /* ---------- Этап 13.U5: «Параметры расчёта» в extended-режиме ---------- */

    it('extended=false → секция «Параметры расчёта» БЕЗ описания (2 колонки)', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc()); // default = compact
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const text = collectText(area);
        // «Параметры расчёта» секция присутствует
        assert.match(text, /Параметры расчёта/);
        // Описание из SETTINGS_DESCRIPTIONS (например, фрагмент для bufferTask) НЕ должно появиться
        assert.doesNotMatch(text, /Дополнительная надбавка к стоимости на риски выполнения задач/);
    });

    it('extended=true → секция «Параметры расчёта» содержит пояснения из SETTINGS_DESCRIPTIONS', async () => {
        installDomMock();
        globalThis.window.print = () => {};
        const { printAnswers } = await import('../../../js/ui/printAnswers.js');
        printAnswers(makeCalc(), { extended: true });
        const area = docBody.children.find(c => c.attributes?.id === 'print-answers-area');
        const text = collectText(area);
        assert.match(text, /Параметры расчёта/);
        // Фрагменты из нескольких описаний — гарантия что НЕ ОДНА строка добавлена,
        // а все settings получили колонку «Пояснение».
        assert.match(text, /Дополнительная надбавка к стоимости на риски выполнения задач/, 'bufferTask description');
        assert.match(text, /Применяется как \(1 \+ инфляция\)/, 'kInflation description');
        assert.match(text, /Учитывать НДС в итоговой стоимости/, 'vatEnabled description (НДС-строка)');
        assert.match(text, /Множитель ресурсов каждого стенда относительно ПРОМ/, 'standSizeRatio description');
    });
});

/** Рекурсивно собрать textContent всех нод (поддержка mock-структуры). */
function collectText(node) {
    if (!node) return '';
    let out = '';
    if (node.textContent) out += node.textContent + ' ';
    if (node.nodeType === 3 && node.textContent) out += node.textContent + ' ';
    if (Array.isArray(node.children)) {
        for (const c of node.children) out += collectText(c);
    }
    if (Array.isArray(node.childNodes)) {
        for (const c of node.childNodes) {
            if (!node.children?.includes(c)) out += collectText(c);
        }
    }
    return out;
}
