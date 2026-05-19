/**
 * Layer enforcement: UI-слой не должен напрямую импортировать
 * controllers/* или state/* — только через ctx-обёртки из app.js.
 *
 * Архитектура (см. CLAUDE.md):
 *   ui → controllers → state/store → domain
 *   ui НЕ ИМЕЕТ права знать о существовании controllers и state.
 *
 * Тест проходит по всем .js в js/ui/ (рекурсивно) и проверяет,
 * что в исходниках нет import-выражений, ссылающихся на ../controllers/
 * или ../state/ (любая глубина relative-пути).
 *
 * Это линтер: каждый UI-файл — отдельный тест-кейс, чтобы при регрессии
 * было сразу видно конкретный нарушитель.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const UI_ROOT          = join(REPO_ROOT, 'js', 'ui');
const CONTROLLERS_ROOT = join(REPO_ROOT, 'js', 'controllers');
const DOMAIN_ROOT      = join(REPO_ROOT, 'js', 'domain');

/* ---------- Рекурсивный обход ---------- */

function walkJs(rootDir) {
    const out = [];
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        let entries;
        try { entries = readdirSync(dir); }
        catch { continue; }
        for (const name of entries) {
            const full = join(dir, name);
            let s;
            try { s = statSync(full); }
            catch { continue; }
            if (s.isDirectory()) {
                stack.push(full);
            } else if (s.isFile() && full.endsWith('.js')) {
                out.push(full);
            }
        }
    }
    out.sort();
    return out;
}

/* ---------- Запрещённый паттерн ---------- */

// Ловит:
//   import { X } from '../controllers/...'
//   import * as X from '../../controllers/...'
//   import '../../state/...'
// и т.п. (любая глубина relative-пути, любой стиль кавычек).
const FORBIDDEN_RE =
    /import\s+(?:[^'"`;]+?\s+from\s+)?['"][^'"]*?\.\.?\/(?:\.\.\/)*(?:controllers|state)\/[^'"]*['"]/;

/* 12.U31 (E.3 widening): controllers НЕ импортируют ui (поток UI ← ctx ← controller). */
const CONTROLLERS_FORBIDDEN_RE =
    /import\s+(?:[^'"`;]+?\s+from\s+)?['"][^'"]*?\.\.?\/(?:\.\.\/)*ui\/[^'"]*['"]/;

/* 12.U31 (E.3 widening): domain НЕ импортирует ui/controllers/state/services
   (чистая логика, никаких side effects). Разрешены только utils и собственный domain. */
const DOMAIN_FORBIDDEN_RE =
    /import\s+(?:[^'"`;]+?\s+from\s+)?['"][^'"]*?\.\.?\/(?:\.\.\/)*(?:ui|controllers|state|services)\/[^'"]*['"]/;

/* ---------- Тесты ---------- */

const uiFiles          = walkJs(UI_ROOT);
const controllersFiles = walkJs(CONTROLLERS_ROOT);
const domainFiles      = walkJs(DOMAIN_ROOT);

describe('Layer enforcement: UI не импортирует controllers/state напрямую', () => {
    // Sanity: убедимся, что обход вообще нашёл файлы — иначе тест-кейсов
    // не будет сгенерировано и регрессия пройдёт незамеченной.
    it('обход js/ui/ нашёл хотя бы один .js файл', () => {
        assert.ok(uiFiles.length > 0,
            'Не найден ни один .js в ' + UI_ROOT + ' — возможно, изменилась структура каталогов');
    });

    for (const file of uiFiles) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        it(`${rel}: нет прямых импортов из controllers/* или state/*`, () => {
            const content = readFileSync(file, 'utf8');
            const m = content.match(FORBIDDEN_RE);
            assert.equal(m, null,
                `Файл ${rel} содержит запрещённый импорт: ${m && m[0]}\n` +
                `Используй ctx-обёртку из js/app.js (метод ctx.xxx) вместо прямого импорта.`);
        });
    }
});

/* 12.U31 (E.3): controllers ↛ ui (был не покрыт линтером, держался дисциплиной). */
describe('Layer enforcement: controllers не импортируют ui напрямую', () => {
    it('обход js/controllers/ нашёл хотя бы один .js файл', () => {
        assert.ok(controllersFiles.length > 0,
            'Не найден ни один .js в ' + CONTROLLERS_ROOT);
    });

    for (const file of controllersFiles) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        it(`${rel}: нет прямых импортов из ui/*`, () => {
            const content = readFileSync(file, 'utf8');
            const m = content.match(CONTROLLERS_FORBIDDEN_RE);
            assert.equal(m, null,
                `Файл ${rel} содержит запрещённый импорт: ${m && m[0]}\n` +
                `Контроллер не должен знать о UI. Передавай DOM-данные через аргументы или ctx-методы.`);
        });
    }
});

/* 12.U31 (E.3): domain ↛ ui/controllers/state/services. Чистая логика без side-effects. */
describe('Layer enforcement: domain — чистая логика (не импортирует ui/controllers/state/services)', () => {
    it('обход js/domain/ нашёл хотя бы один .js файл', () => {
        assert.ok(domainFiles.length > 0,
            'Не найден ни один .js в ' + DOMAIN_ROOT);
    });

    for (const file of domainFiles) {
        const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
        it(`${rel}: нет прямых импортов из ui/controllers/state/services`, () => {
            const content = readFileSync(file, 'utf8');
            const m = content.match(DOMAIN_FORBIDDEN_RE);
            assert.equal(m, null,
                `Файл ${rel} содержит запрещённый импорт: ${m && m[0]}\n` +
                `Domain — чистая логика. Разрешены только utils/* и собственный domain/*.\n` +
                `Если нужны IO/state — это уже не domain, переноси в services/ или controllers/.`);
        });
    }
});
