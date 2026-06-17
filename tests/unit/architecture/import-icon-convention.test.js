/**
 * Конвенция иконок импорта/экспорта (forcing function).
 *
 * Это offline-приложение: данные импортируются ИЗ локального файла (file-picker)
 * и экспортируются В локальный файл. Понятия «загрузка на сервер» нет. Поэтому
 * иконка `upload` (стрелка вверх/наружу) семантически неверна — пользователь
 * читает её как ЭКСПОРТ/отправку (реальная жалоба 2026-06-17 по кнопкам импорта
 * прайса провайдера, которые выглядели как экспорт).
 *
 * Конвенция проекта:
 *   - импорт-из-файла → `folder-open` (открыть файл);
 *   - экспорт-в-файл  → `save` / `package` / `download`.
 *
 * Если когда-нибудь появится настоящая выгрузка на удалённый сервер — осознанно
 * добавьте файл в EXEMPT с комментарием-обоснованием.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.resolve(__dirname, '../../../js/ui');

const EXEMPT = new Set([
    // пусто: настоящей upload-на-сервер функциональности в offline-приложении нет.
]);

function walk(dir) {
    const out = [];
    for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(full));
        else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
}

describe('import/export icon convention', () => {
    const files = walk(UI_DIR);

    it('ни один js/ui файл не использует icon(\'upload\') (стрелка наружу = экспорт)', () => {
        const offenders = [];
        for (const file of files) {
            if (EXEMPT.has(path.basename(file))) continue;
            const src = stripJsComments(readFileSync(file, 'utf8'));
            if (/icon\(\s*['"]upload['"]/.test(src)) {
                offenders.push(path.relative(UI_DIR, file));
            }
        }
        assert.deepEqual(offenders, [],
            `icon('upload') в: ${offenders.join(', ')}. Импорт-из-файла → folder-open.`);
    });

    it('кнопки импорта прайса провайдера используют folder-open', () => {
        const src = stripJsComments(readFileSync(path.join(UI_DIR, 'providerUpdateRow.js'), 'utf8'));
        const count = (src.match(/icon\(\s*['"]folder-open['"]/g) || []).length;
        assert.ok(count >= 2, `ожидалось ≥2 folder-open в providerUpdateRow.js, найдено ${count}`);
    });
});
