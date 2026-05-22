/**
 * Stage 12.5 (PATCH 2.6.4) — Subgroup-level glow.
 *
 * Расширение Stage 6.6.B (PATCH 2.4.22) — там был только section-уровень.
 * Теперь при изменении вопроса в подгруппе подсвечивается:
 *   • сама подгруппа (.questionnaire-subgroup-recent) — точка изменения;
 *   • родительская секция (.section-recent) — каскадно (как и раньше).
 *
 * Проверяется источник: CSS-rule + @keyframes + prefers-reduced-motion override,
 * JS-renderer (class-массив + вычисление isRecentSubgroup через subQuestions.some),
 * APP_VERSION sync. Триггер (recentlyChangedKey = 'answer:${id}' в setAnswer)
 * существовал и до этого этапа — regression-check в controller-блоке.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments, stripCssComments, ruleBody } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Локальный helper: возвращает массив тел всех @media (prefers-reduced-motion: reduce)
 * блоков в файле. extractAtMediaBody из shared helpers возвращает только первый
 * совпавший блок, а в forms.css их несколько.
 */
function findAllReducedMotionBodies(src) {
    const stripped = stripCssComments(src);
    const headerRe = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{/g;
    const bodies = [];
    let m;
    while ((m = headerRe.exec(stripped)) !== null) {
        let i = m.index + m[0].length;
        let depth = 1;
        const start = i;
        while (i < stripped.length && depth > 0) {
            const ch = stripped[i];
            if (ch === '{') depth++;
            else if (ch === '}') depth--;
            if (depth === 0) {
                bodies.push(stripped.slice(start, i));
                break;
            }
            i++;
        }
    }
    return bodies;
}

describe('Stage 12.5 / 2.6.4 / subgroup glow — CSS', () => {
    const cssRaw = read('css/forms.css');
    const css = stripCssComments(cssRaw);

    it('.questionnaire-subgroup-recent объявлен с animation 1.2s', () => {
        const rule = ruleBody(cssRaw, '.questionnaire-subgroup-recent');
        assert.match(rule, /animation:\s*[\w-]+\s+1\.2s/,
            '.questionnaire-subgroup-recent должна иметь animation длительностью 1.2s ' +
            '(параллельно с .section-recent — оба glow заканчиваются синхронно)');
    });

    it('@keyframes для subgroup-glow существует и использует var(--accent-glow)', () => {
        const hasOwnKf = /@keyframes\s+subgroup-highlight\b/.test(css);
        const sharedKf = /@keyframes\s+section-highlight\b/.test(css);
        assert.ok(hasOwnKf || sharedKf,
            'должен существовать @keyframes для glow-анимации (subgroup-highlight ' +
            'или общий с section-highlight)');
        // accent-glow используется в одном из двух подходящих keyframes.
        const hasAccentInSubgroupKf = /@keyframes\s+subgroup-highlight\s*\{[^}]*var\(--accent-glow\)/m.test(css);
        const hasAccentInSectionKf  = /@keyframes\s+section-highlight\s*\{[^}]*var\(--accent-glow\)/m.test(css);
        assert.ok(hasAccentInSubgroupKf || hasAccentInSectionKf,
            'glow-keyframes должны использовать var(--accent-glow) для тематической ' +
            'консистентности с другими accent-эффектами проекта');
    });

    it('@media (prefers-reduced-motion: reduce) обнуляет animation на .questionnaire-subgroup-recent', () => {
        const reducedBodies = findAllReducedMotionBodies(cssRaw);
        const hasRule = reducedBodies.some(body =>
            /\.questionnaire-subgroup-recent\s*\{[^}]*animation:\s*none/.test(body)
        );
        assert.ok(hasRule,
            '@media (prefers-reduced-motion: reduce) должен содержать ' +
            '.questionnaire-subgroup-recent { animation: none } — WCAG 2.3.3 / Stage 12.1.5');
    });
});

describe('Stage 12.5 / 2.6.4 / subgroup glow — JS render', () => {
    const js = stripJsComments(read('js/ui/questionnaire.js'));

    it('класс questionnaire-subgroup-recent применяется conditionally на <div.questionnaire-subgroup>', () => {
        // Внутри renderSection-блока должен быть class-массив <div class:'questionnaire-subgroup'>
        // с conditional 'questionnaire-subgroup-recent' через флаг.
        assert.match(js,
            /['"]questionnaire-subgroup['"][\s\S]{0,500}?isRecentSubgroup\s*&&\s*['"]questionnaire-subgroup-recent['"]/,
            'класс questionnaire-subgroup-recent должен подключаться через isRecentSubgroup ' +
            'в class-массиве <div.questionnaire-subgroup>');
    });

    it('isRecentSubgroup вычисляется через subQuestions.some(q => recentKey === `answer:${q.id}`)', () => {
        // Точка изменения — конкретная подгруппа, не вся секция.
        assert.match(js,
            /isRecentSubgroup\s*=[\s\S]{0,400}?subQuestions\.some\s*\(\s*q\s*=>\s*recentKey\s*===\s*[`'"]answer:\$\{q\.id\}[`'"]/,
            'isRecentSubgroup должна определяться только по вопросам ИМЕННО этой подгруппы — ' +
            'иначе все подгруппы секции загорятся одновременно при изменении одного поля');
    });

    it('regression: section-recent (cascade) сохраняется', () => {
        // Stage 6.6.B (PATCH 2.4.22) — section-уровень glow существует, не должен исчезнуть.
        assert.match(js,
            /isRecentSection\s*=[\s\S]{0,300}?recentKey\.startsWith\(\s*['"]answer:['"]\s*\)[\s\S]{0,300}?questions\.some/,
            'isRecentSection должна остаться (cascade на родительскую секцию)');
        assert.match(js,
            /class:\s*\[\s*['"]questionnaire-section['"]\s*,\s*isRecentSection\s*&&\s*['"]section-recent['"]/,
            '.section-recent должен применяться через class-массив на <div.questionnaire-section>');
    });

    it('recentKey вычисляется один раз и переиспользуется в section + subgroup', () => {
        // Защита от регрессии «два независимых чтения state.ui.recentlyChangedKey» —
        // должна быть одна локальная переменная recentKey, используемая обоими блоками.
        const recentKeyDecls = (js.match(/const\s+recentKey\s*=\s*state\.ui\.recentlyChangedKey/g) || []).length;
        assert.equal(recentKeyDecls, 1,
            'const recentKey = state.ui.recentlyChangedKey должна быть объявлена ровно один раз ' +
            'в renderSection — section + subgroup используют общий источник истины');
    });
});

describe('Stage 12.5 / 2.6.4 / controller integration — regression', () => {
    const js = stripJsComments(read('js/controllers/calcController.js'));

    it('setAnswer выставляет recentlyChangedKey = `answer:${id}` (триггер для glow)', () => {
        // Тело setAnswer длинное (cascade-логика для master-toggle), поэтому проверяем
        // факт существования обоих маркеров в файле — функция и её recentlyChangedKey.
        assert.match(js, /export\s+function\s+setAnswer\s*\(/,
            'export function setAnswer должна существовать');
        assert.match(js,
            /recentlyChangedKey:\s*[`'"]answer:\$\{questionId\}[`'"]/,
            'где-то в calcController.js должна быть строка recentlyChangedKey: `answer:${questionId}` ' +
            '— это триггер для всех уровней glow (.field-recent / .questionnaire-subgroup-recent / .section-recent)');
    });
});

/* APP_VERSION sync проверяется глобальным линтером
   tests/unit/architecture/app-version-sync.test.js — version-bump в этом
   подэтапе не привязан к специфике 12.5. */
