/**
 * Esc должен закрывать ЛЮБУЮ открытую модалку, не только модалки из
 * жёстко зашитого whitelist'а.
 *
 * Жалоба пользователя: «Quick Start не закрывается по Esc». Корень — в
 * keyboardController.js `case 'closeModal'` был hardcoded список 8 имён
 * (itemEdit, questionEdit, formula, help, confirm, message, input, reset),
 * который не обновлялся при добавлении новых модалок. В store на момент
 * фикса было 27 модалок, т.е. 19 модалок (quickStart, costOptimizationPlanner,
 * vatPolicyChoice, calculationHealth и др.) НЕ закрывались по Esc.
 *
 * Решение: динамически читать `Object.keys(state.modals)` — любая
 * модалка, добавленная в store, автоматически становится «закрываемой по Esc».
 *
 * Secondary-overlay'и (confirm/message/input/reset/duplicateImport/
 * reapplyConfirm/vatPolicyChoice) приоритетны — они могут быть открыты
 * ПОВЕРХ основной модалки, Esc должен закрывать сначала их.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function extractCloseModalCaseBody(src) {
    const cleaned = stripJsComments(src);
    const m = cleaned.match(/case\s*['"]closeModal['"]\s*:\s*\{([\s\S]*?)\bbreak\s*;/);
    if (!m) throw new Error('case "closeModal" не найден в keyboardController');
    return m[1];
}

function collectModalNamesFromStore(src) {
    // Все модалки в store.js имеют форму `<name>: { open: false ...}` (initial state).
    // Других мест с паттерном `<id>: { open:` в файле нет — поэтому ищем напрямую,
    // не ограничиваясь блоком (balanced-brace разбор многострочных объектов
    // хрупок и не нужен).
    const cleaned = stripJsComments(src);
    const names = [];
    const re = /^\s+([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*\{\s*open\s*:/gm;
    let mm;
    while ((mm = re.exec(cleaned)) !== null) names.push(mm[1]);
    return names;
}

describe('keyboardController · case "closeModal" — Esc закрывает ЛЮБУЮ открытую модалку', () => {
    const ctlSrc = read('js/controllers/keyboardController.js');
    const storeSrc = read('js/state/store.js');
    const caseBody = extractCloseModalCaseBody(ctlSrc);
    const modalNames = collectModalNamesFromStore(storeSrc);

    it('case использует динамический список модалок (Object.keys(state.modals)) — не hardcoded whitelist', () => {
        assert.match(caseBody, /Object\.keys\s*\(\s*state\.modals\s*\)/,
            'closeModal должен читать список модалок из state.modals динамически, ' +
            'иначе любая новая модалка тихо «забудется» и не будет закрываться по Esc');
    });

    it('в store зарегистрировано >= 20 модалок (защита от ложно-зелёного теста)', () => {
        assert.ok(modalNames.length >= 20,
            `ожидаем минимум 20 модалок в store (нашли ${modalNames.length}: ${modalNames.join(', ')}) — ` +
            'если внезапно меньше, проверь regex collectModalNamesFromStore');
    });

    it('quickStart — модалка, упомянутая в исходной жалобе — присутствует в store', () => {
        assert.ok(modalNames.includes('quickStart'),
            'регрессионный якорь: quickStart должен быть в state.modals (иначе фикс теряет смысл)');
    });

    it('secondary-overlay модалки закрываются ПРИОРИТЕТНО — confirm/message/input/reset/' +
       'duplicateImport/reapplyConfirm/vatPolicyChoice идут перед общим списком', () => {
        // Эти модалки могут быть открыты поверх основной — Esc должен закрыть сначала их.
        // Проверяем, что они явно перечислены в case-body (как hardcoded priority-array).
        const SECONDARY = ['confirm', 'message', 'input', 'reset',
                           'duplicateImport', 'reapplyConfirm', 'vatPolicyChoice'];
        for (const name of SECONDARY) {
            assert.match(caseBody, new RegExp(`['"]${name}['"]`),
                `secondary-modal '${name}' должен явно лидировать в порядке закрытия`);
        }
    });

    it('case закрывает только ОДНУ модалку за нажатие (return после первой найденной)', () => {
        // Любой Esc → закрываем ровно одну верхнюю модалку, не каскадом всё разом.
        assert.match(caseBody, /\bstore\.closeModal\s*\(/,
            'case должен вызывать store.closeModal');
        assert.match(caseBody, /\breturn\s*;/,
            'после закрытия одной модалки — return, чтобы не закрывать остальные');
    });
});
