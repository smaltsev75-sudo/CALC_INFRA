/**
 * Регресс-тест: renderModals сохраняет .modal-body.scrollTop между перерисовками.
 *
 * Контекст: _modalsRoot.replace() пересоздаёт overlay'и при каждом store-апдейте.
 * Без явного snapshot'а scrollTop сбрасывается в 0 → пользователь видит «прыжок
 * наверх» на каждое внутри-модалочное действие (toggle accordion, edit lever,
 * draft-keystroke). Жертва: модалка «План оптимизации стоимости» (Stage 18.1.1
 * grouped accordion), но фикс применим ко всем модалкам.
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

describe('renderModals scroll-preserve', () => {
    const src = stripJsComments(read('js/ui/index.js'));

    it('overlay получает data-modal-name при append для последующей идентификации', () => {
        assert.match(src, /overlay\.dataset\.modalName\s*=\s*name/);
    });

    it('перед replace() снимается scrollTop у каждой остающейся открытой модалки', () => {
        assert.match(src, /scrollSnapshot\s*=\s*new Map\(\)/);
        assert.match(src, /dataset\?\.modalName/);
        assert.match(src, /querySelector\(\s*['"]\.modal-body['"]\s*\)/);
        assert.match(src, /scrollSnapshot\.set\(\s*name\s*,\s*body\.scrollTop\s*\)/);
    });

    it('после append восстанавливается savedTop через body.scrollTop = savedTop', () => {
        assert.match(src, /scrollSnapshot\.get\(\s*name\s*\)/);
        assert.match(src, /body\.scrollTop\s*=\s*savedTop/);
    });

    it('snapshot только для модалок, остающихся открытыми (nextOpen.has(name))', () => {
        assert.match(src, /nextOpen\.has\(\s*name\s*\)/);
    });
});
