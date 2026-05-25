import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown } from '../../../js/services/markdown.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const manual = readFileSync(join(ROOT, 'UserManual.md'), 'utf8').replace(/\r\n?/g, '\n');
const modalCss = readFileSync(join(ROOT, 'css', 'modals.css'), 'utf8');
const constants = readFileSync(join(ROOT, 'js', 'utils', 'constants.js'), 'utf8');

function section(markdown, heading) {
    const start = markdown.indexOf(`## ${heading}`);
    assert.ok(start >= 0, `Раздел "${heading}" должен быть в UserManual.md`);
    const next = markdown.indexOf('\n## ', start + heading.length + 3);
    return next >= 0 ? markdown.slice(start, next) : markdown.slice(start);
}

describe('Help modal readability', () => {
    it('UserManual.md starts with a scannable quick-start section', () => {
        assert.match(manual, /- \[С чего начать\]\(#с-чего-начать\)/);
        assert.match(manual, /## С чего начать/);
        assert.match(manual, /\| Задача \| Где открыть \| Что сделать \|/);
        assert.match(manual, /\| Получить первую оценку \| \*\*Расчёты → Новый расчёт\*\*/);
    });

    it('typical scenario is a readable numbered list, not an arrow code block', () => {
        const scenario = section(manual, 'Типовой сценарий использования');
        assert.doesNotMatch(scenario, /```/);
        assert.match(
            scenario,
            /3\. Перейдите в \*\*Опросник\*\* и уточните ответы под свой продукт\./
        );
        assert.match(
            scenario,
            /9\. Создайте второй сценарий или второй расчёт, если нужно сравнить варианты\./
        );
    });

    it('uses plain Russian for non-obvious technical terms', () => {
        for (const forbidden of [
            /\bCAPEX\b/, /\bOPEX\b/, /Product Owner/, /\bLLM\b/, /\bRAG\b/,
            /\bDAU\b/, /\bRPS\b/, /\bPCU\b/, /\bMVP\b/, /\bSaaS\b/,
            /source-level/i, /\bstub\b/i, /\bbundle\b/i, /\bbaseline\b/i,
            /\bgross\b/i, /\bnet\b/i, /\boverride\b/i, /\btooltip\b/i,
            /\bruntime\b/i, /\brollback\b/i, /\binline\b/i, /\bSKU\b/i,
            /\bDashboard\b/, /\bAI\b/, /\bExcel\b/
        ]) {
            assert.doesNotMatch(manual, forbidden);
        }
        assert.match(manual, /WAF \(защита веб-приложений\)/);
        assert.match(manual, /DDoS \(защита от распределённых атак\)/);
        assert.match(manual, /CPU.*Процессорные ядра/);
        assert.match(manual, /RAM.*Оперативная память/);
    });

    it('does not document duplicated price actuality version next to the date', () => {
        assert.doesNotMatch(manual, /Актуальность прайса: ДД\.ММ\.ГГГГ · версия/);
        assert.doesNotMatch(manual, /актуальность прайса и версия/);
        assert.match(manual, /Актуальность прайса: ДД\.ММ\.ГГГГ/);
    });

    it('quick validation checklist renders as one ordered list with sequential items', () => {
        const checklist = section(manual, 'Как проверить реалистичность результата');
        const quick = checklist.slice(
            checklist.indexOf('### Быстрая проверка за 5-10 минут'),
            checklist.indexOf('### Красные флаги')
        );
        assert.doesNotMatch(quick, /^\s{2,}\S/m);
        const html = renderMarkdown(quick);
        assert.equal((html.match(/<ol>/g) || []).length, 1);
        assert.equal((html.match(/<li>/g) || []).length, 6);
    });

    it('does not duplicate the hotkeys section already rendered by helpModal.js', () => {
        assert.doesNotMatch(manual, /## Темы и горячие клавиши/);
        assert.doesNotMatch(manual, /Горячие клавиши/);
        assert.doesNotMatch(manual, /\| Клавиши \| Действие \|/);
        assert.match(manual, /## Темы/);
    });

    it('help content CSS limits line length and visually separates sections', () => {
        assert.match(modalCss, /\.help-content\s*{[\s\S]*max-width:\s*940px;/);
        assert.match(modalCss, /\.help-content\s*{[\s\S]*line-height:\s*1\.58;/);
        assert.match(modalCss, /\.help-content p\s*{[\s\S]*max-width:\s*82ch;/);
        assert.match(modalCss, /\.help-content h2\s*{[\s\S]*border-left:\s*3px solid var\(--accent\);/);
        assert.match(modalCss, /\.help-content table\s*{[\s\S]*font-size:\s*0\.92rem;/);
    });

    it('hotkey label points to the in-app help, not README', () => {
        assert.match(constants, /label:\s*'Справка'/);
        assert.doesNotMatch(constants, /Справка \(README\)/);
    });
});
