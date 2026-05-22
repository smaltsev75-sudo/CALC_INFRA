/**
 * UI-улучшения после ревью (2026-05-05): CSS @layer для управления каскадом.
 *
 * Цель — детерминированный порядок каскада для базы стилей:
 *   tokens → themes → reset → utilities (далее — неслоёные правила компонентов).
 *
 * По спецификации CSS Cascade Level 5 (W3C):
 *   1. Неслоёные правила имеют ВЫСШИЙ приоритет (вне layers).
 *   2. Среди слоёных — выигрывает та layer, что объявлена ПОЗЖЕ в `@layer`-декларации.
 *
 * Поэтому объявленный нами порядок гарантирует, что [data-theme="light"] (themes)
 * перебивает :root-токены (tokens), а utilities имеют приоритет над reset'ом.
 * Прочие CSS-файлы остаются неслоёными → их правила имеют максимальный
 * приоритет, что предотвращает регрессии.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { stripCssComments } from '../../_helpers/source.js';

const here = path.dirname(url.fileURLToPath(import.meta.url));
const cssPath = path.resolve(here, '../../../css/base.css');
const cssRaw = fs.readFileSync(cssPath, 'utf8');
/* Используем БЕЗ-strip версию для проверки структуры layers — закрывающие
 * `}` располагаются строго после содержимого, и комментарии-маркеры рядом
 * не мешают. Всё ядро регексов работает с stripped версией. */
const css = stripCssComments(cssRaw);

describe('CSS @layer: явный порядок каскада в base.css', () => {
    it('base.css объявляет @layer с порядком tokens, reset, themes, utilities', () => {
        const m = css.match(/@layer\s+([^;]+);/);
        assert.ok(m, 'не найдена декларация @layer на верхнем уровне base.css');
        const order = m[1].split(',').map(s => s.trim());
        // themes ОБЯЗАТЕЛЬНО после reset — иначе [data-theme="light"] body не
        // перебивает body { background-image: <radial> } из reset-блока.
        assert.deepEqual(order, ['tokens', 'reset', 'themes', 'utilities'],
            'порядок layers должен быть tokens → reset → themes → utilities. ' +
            'themes идут ПОСЛЕ reset, чтобы темы могли перебивать body-фон из reset.');
    });

    it(':root-токены обёрнуты в @layer tokens', () => {
        // Ищем `@layer tokens {` за которым (внутри) идёт `:root {`.
        const m = css.match(/@layer\s+tokens\s*\{[\s\S]*?:root\s*\{/);
        assert.ok(m,
            ':root должен быть внутри @layer tokens — иначе :root перебьёт ' +
            'не только themes, но и любые слоёные правила');
    });

    it('[data-theme="light"] обёрнут в @layer themes', () => {
        const m = css.match(/@layer\s+themes\s*\{[\s\S]*?\[data-theme="light"\]\s*\{/);
        assert.ok(m,
            '[data-theme="light"] должен жить в @layer themes — это даёт ему ' +
            'приоритет над :root-токенами и одновременно позволяет компонентам ' +
            '(неслоёным) перебивать темы при необходимости');
    });

    it('reset (* / html / body) обёрнут в @layer reset', () => {
        const m = css.match(/@layer\s+reset\s*\{[\s\S]*?\*[\s\S]*?box-sizing/);
        assert.ok(m, 'reset (универсальный селектор + box-sizing) должен быть в @layer reset');
    });

    it('утилиты (.hidden / .text-muted) обёрнуты в @layer utilities', () => {
        const m = css.match(/@layer\s+utilities\s*\{[\s\S]*?\.hidden/);
        assert.ok(m, '.hidden и другие утилиты должны быть в @layer utilities');
    });

    it('boot-fallback и prefers-reduced-motion остаются неслоёными', () => {
        // Для критических вещей (fallback при file://, accessibility) приоритет
        // должен быть максимальный — поэтому они вне layers. Проверяем, что
        // .boot-fallback и @media (prefers-reduced-motion) встречаются ПОСЛЕ
        // последнего открывающего `@layer utilities {` И после соответствующей
        // закрывающей `}`. Так как @layer не вкладываются (одна пара), достаточно
        // найти позицию последней `}` после `@layer utilities {`.
        const utilsOpenIdx = css.search(/@layer\s+utilities\s*\{/);
        assert.ok(utilsOpenIdx >= 0, 'не нашёл @layer utilities');
        const afterUtilsBody = css.slice(utilsOpenIdx);
        // Ищем .boot-fallback в части файла после @layer utilities.
        // Раньше строка маркера-комментария «end @layer utilities» теряется при
        // stripCssComments → проверяем по структуре, а не литералу.
        const bootFallbackIdx = afterUtilsBody.search(/\.boot-fallback\s*\{/);
        const reducedMotionIdx = afterUtilsBody.search(/@media\s*\(\s*prefers-reduced-motion/);
        assert.ok(bootFallbackIdx > 0,
            '.boot-fallback должен идти ПОСЛЕ @layer utilities (вне @layer = max приоритет)');
        assert.ok(reducedMotionIdx > 0,
            '@media (prefers-reduced-motion) должен идти ПОСЛЕ @layer utilities');
    });
});
