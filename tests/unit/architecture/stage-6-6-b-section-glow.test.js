/**
 * Stage 6.6.B (PATCH 2.4.22) — Section glow on change.
 *
 * Когда пользователь меняет любое поле в секции, recentlyChangedKey в state
 * становится `answer:<q.id>`. renderSection обнаруживает совпадение с одним
 * из своих вопросов и применяет класс .section-recent. CSS animation
 * section-highlight 1.2s ease — пульс accent-glow на всю секцию.
 *
 * Аналог .field-recent (Stage 12.U1) но на section-уровне. Полезно когда
 * секция свёрнута: glow на свёрнутой секции сообщает «ваше изменение
 * учтено вот здесь» без необходимости раскрывать.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, ruleBody, extractAtMediaBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('Stage 6.6.B / questionnaire.js — recent-section detection', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    function renderSectionBody() {
        const fnStart = src.indexOf('function renderSection(');
        const after = src.indexOf('\nfunction ', fnStart + 30);
        return after < 0 ? src.slice(fnStart) : src.slice(fnStart, after);
    }

    it('renderSection читает state.ui.recentlyChangedKey', () => {
        const body = renderSectionBody();
        assert.match(body, /recentKey\s*=\s*state\.ui\.recentlyChangedKey/,
            'renderSection должен читать recentlyChangedKey из state.ui');
    });

    it('renderSection вычисляет isRecentSection через answer-prefix + question.id match', () => {
        const body = renderSectionBody();
        // recentKey.startsWith('answer:') && questions.some(q => recentKey === `answer:${q.id}`)
        assert.match(body, /recentKey\.startsWith\(\s*['"]answer:['"]\s*\)/,
            'isRecentSection должен проверять префикс «answer:» (только пользовательские ответы)');
        assert.match(body, /questions\.some\(\s*q\s*=>\s*recentKey\s*===\s*`answer:\$\{q\.id\}`/,
            'isRecentSection должен матчить через questions.some(q => recentKey === `answer:${q.id}`)');
    });

    it('isRecentSection защищён от non-string recentKey (typeof check)', () => {
        const body = renderSectionBody();
        assert.match(body, /typeof\s+recentKey\s*===\s*['"]string['"]/,
            'isRecentSection должен иметь typeof check (recentKey может быть null/undefined)');
    });

    it('секция получает class section-recent при isRecentSection=true', () => {
        const body = renderSectionBody();
        assert.match(body, /class:\s*\[\s*['"]questionnaire-section['"]\s*,\s*isRecentSection\s*&&\s*['"]section-recent['"]/,
            'div секции должен conditionally получать класс section-recent');
    });
});

describe('Stage 6.6.B / forms.css — section-glow animation', () => {
    it('.section-recent имеет animation section-highlight 1.2s', () => {
        const body = ruleBody(read('css/forms.css'), '.section-recent');
        assert.match(body, /animation:\s*section-highlight\s+1\.2s/,
            '.section-recent должен запускать animation section-highlight 1.2s');
    });

    it('@keyframes section-highlight использует accent-glow', () => {
        const css = read('css/forms.css');
        // @keyframes имеет nested блоки `0% { ... }` — простой /[^}]+/ не работает.
        // Балансируем фигурные скобки вручную.
        const startRe = /@keyframes\s+section-highlight\s*\{/;
        const startMatch = css.match(startRe);
        assert.ok(startMatch, '@keyframes section-highlight должен быть определён');
        let i = startMatch.index + startMatch[0].length;
        let depth = 1;
        const start = i;
        while (i < css.length && depth > 0) {
            if (css[i] === '{') depth++;
            else if (css[i] === '}') depth--;
            i++;
        }
        const body = css.slice(start, i - 1);
        assert.match(body, /var\(--accent-glow\)/,
            'glow должен использовать токен --accent-glow');
        assert.match(body, /transparent/,
            'финальный кадр должен переходить в transparent (glow затухает)');
    });

    it('prefers-reduced-motion обнуляет .section-recent animation', () => {
        const css = read('css/forms.css');
        const body = extractAtMediaBody(css, 'prefers-reduced-motion: reduce');
        assert.ok(body, '@media (prefers-reduced-motion: reduce) должен существовать');
        assert.match(body, /\.section-recent\s*\{[^}]*animation:\s*none/,
            'prefers-reduced-motion должен обнулять .section-recent animation (WCAG 2.3.3)');
    });

    it('базовый .questionnaire-section не сломан Stage 6.6.B (всё ещё карточка)', () => {
        const body = ruleBody(read('css/forms.css'), '.questionnaire-section');
        assert.match(body, /background:\s*var\(--bg-card\)/);
        assert.match(body, /border:\s*1px\s+solid\s+var\(--border-light\)/);
    });
});
