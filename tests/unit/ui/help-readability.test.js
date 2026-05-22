import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

const manual = readFileSync(join(ROOT, 'UserManual.md'), 'utf8');
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
        assert.match(manual, /\| Задача \| Где открыть \| Что проверить \|/);
        assert.match(manual, /\| Получить первую оценку \| \*\*Расчёты → Новый расчёт\*\*/);
    });

    it('typical scenario is a readable numbered list, not an arrow code block', () => {
        const scenario = section(manual, 'Типовой сценарий использования');
        assert.doesNotMatch(scenario, /```/);
        assert.match(
            scenario,
            /3\. \*\*Опросник\*\* — уточните пользователей, нагрузку, данные, уведомления, безопасность, тестирование и ИИ, если он нужен\./
        );
        assert.match(
            scenario,
            /9\. \*\*Сравнение расчётов\*\* — сопоставьте несколько вариантов рядом\./
        );
    });

    it('does not document duplicated price actuality version next to the date', () => {
        assert.doesNotMatch(manual, /Актуальность прайса: ДД\.ММ\.ГГГГ · версия/);
        assert.doesNotMatch(manual, /актуальность прайса и версия/);
        assert.match(manual, /Актуальность прайса: ДД\.ММ\.ГГГГ/);
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
