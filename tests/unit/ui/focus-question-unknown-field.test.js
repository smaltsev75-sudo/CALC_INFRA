/**
 * focusQuestion — навигация к полю в режиме «Не знаю» (assumption).
 *
 * Контекст: «Перейти к полю» из «Допущений расчёта» / «Реестр допущений» /
 * Health Check ведёт к вопросу, ответа на который нет (`answer === null`) —
 * input поля задизейблен по UX-паттерну `field-unknown`. Курсор в disabled
 * input не встаёт; программный click по «Не знаю» считается мутацией данных
 * (меняет answer и source) и для навигационного действия запрещён.
 *
 * Контракт focusQuestion:
 *   1. Editable input → курсор в input (стандарт).
 *   2. Disabled input (assumption) → фокус на кнопку `.field-unknown-toggle`
 *      + info-snackbar с подсказкой «Нажмите "Не знаю", чтобы включить
 *      ручной ввод». Без авто-клика, без изменения answer.
 *   3. Поле всегда подсвечивается через .field-recent (recentlyChangedKey).
 *   4. ID-якорь `field-${q.id}` на внешнем div для scrollIntoView.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf-8');

describe('focusQuestion — фокус для assumption-полей (input disabled)', () => {
    const src = stripJsComments(read('js/app/focusQuestionAction.js'));
    const fnMatch = src.match(/export function focusQuestionAction[\s\S]*$/);
    assert.ok(fnMatch, 'focusQuestionAction должен существовать');
    const body = fnMatch[0];

    it('ищет .field-unknown-toggle как fallback-цель фокуса', () => {
        assert.match(body, /\.field-unknown-toggle/,
            'Когда editable input не найден (поле disabled из-за «Не знаю»), ' +
            'фокус должен ставиться на кнопку «Не знаю».');
    });

    it('editable-селектор исключает [disabled]', () => {
        assert.match(body, /input:not\(\[disabled\]\)/,
            'Селектор должен пропускать disabled input — иначе фокус всё равно ' +
            'попытается встать на disabled-поле и .focus() будет no-op без fallback.');
        assert.match(body, /select:not\(\[disabled\]\)/);
        assert.match(body, /textarea:not\(\[disabled\]\)/);
    });

    it('показывает info-подсказку при попадании на unknown-toggle', () => {
        assert.match(body, /snackbar\.info\s*\(\s*['"][^'"]*Не знаю[^'"]*['"]/,
            'Должен быть snackbar.info(...) с упоминанием «Не знаю» — иначе ' +
            'пользователь не поймёт, почему поле не редактируется.');
    });

    it('НЕ вызывает ctx.setAnswer / setAnswer / store.update — навигация без мутации', () => {
        assert.equal(/setAnswer\s*\(/.test(body), false,
            'focusQuestion не должен менять answer — переход к полю это навигация, ' +
            'а не подтверждение замены default-значения на ручной ввод.');
        assert.equal(/updateActiveCalc\s*\(/.test(body), false,
            'Никаких updateActiveCalc — навигация не пересчитывает calc.');
    });

    it('НЕ вызывает .click() на unknown-toggle (auto-unlock запрещён)', () => {
        // Защита от регрессии: если кто-то решит «упростить» сценарий и
        // программно кликнуть по «Не знаю» — это молча поменяет answer
        // (null → defaultValue) + source станет manual. Для навигационного
        // действия из Реестра допущений это побочный эффект.
        assert.equal(/unknownToggle\.click\s*\(/.test(body), false,
            'unknownToggle.click() запрещён — пользователь сам Enter/Space разблокирует.');
    });

    it('сохраняет scrollIntoView к якорю field-${id}', () => {
        assert.match(body, /scrollIntoView/,
            'Прокрутка обязательна — без неё «навигация к полю» бессмысленна.');
        assert.match(body, /field-\$\{questionId\}/,
            'Якорь — id="field-${questionId}" на внешнем div поля.');
    });

    it('сохраняет .field-recent glow через recentlyChangedKey', () => {
        assert.match(body, /recentlyChangedKey:\s*[`'"]answer:\$\{questionId\}/,
            'Glow подсветка через recentlyChangedKey должна оставаться.');
    });
});

describe('questionnaire.js — поле имеет id="field-${q.id}" как scroll-якорь', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    it('renderQuestionField возвращает div с id=`field-${q.id}`', () => {
        // Проверяем именно факт наличия id на внешнем div поля.
        // Без него focusQuestion не найдёт ноду через document.getElementById.
        assert.match(src, /id:\s*`field-\$\{q\.id\}`/,
            'Внешний div поля должен иметь id="field-${q.id}" — якорь для ' +
            'document.getElementById в focusQuestion.');
    });
});

describe('questionnaire.js — .field-unknown-toggle остаётся focusable button', () => {
    const src = stripJsComments(read('js/ui/questionnaire.js'));

    it('unknownToggle — это <button type="button">', () => {
        const m = src.match(/class:\s*\[\s*'field-unknown-toggle'[\s\S]{0,500}?\}/);
        assert.ok(m, 'Должен быть el(\'button\', { class: [\'field-unknown-toggle\', ...] })');
        assert.match(m[0], /type:\s*['"]button['"]/,
            'type="button" — иначе кнопка отправляет форму при Enter.');
    });

    it('unknownToggle имеет title с подсказкой про разблокировку', () => {
        const slice = src.match(/field-unknown-toggle[\s\S]{0,800}/);
        assert.ok(slice);
        assert.match(slice[0], /title:/,
            'title= обязателен — пользователь, попавший на кнопку через ' +
            'focusQuestion, должен видеть подсказку при hover/screen-reader.');
    });
});
