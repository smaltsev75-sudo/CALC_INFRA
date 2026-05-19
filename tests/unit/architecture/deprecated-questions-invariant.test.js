/**
 * PATCH 2.18.2 (внешний аудит #9, 2026-05-19, forcing function §5.quat):
 * любой id, который удаляется из `dict.questions` через миграцию, обязан
 * присутствовать в `DEPRECATED_QUESTION_IDS` из seed.js.
 *
 * Без этого инварианта дисциплина «после каждой удаляющей миграции
 * синхронно расширить blacklist» держится только на памяти разработчика —
 * и проваливается через 6-12 месяцев (см. mau_growth_rate_percent, 2.18.0:
 * миграция добавлена, render-blacklist обновлён НЕ был → audit-9 P1).
 *
 * Линтер сканирует migrations.js на pattern `dict.questions.filter(q => q.id !== 'X')`
 * и проверяет, что каждый X есть в whitelist seed.js.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEPRECATED_QUESTION_IDS } from '../../../js/domain/seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

describe('architecture: deprecated questions invariant', () => {
    it('каждый id, удаляемый миграцией из dict.questions, есть в DEPRECATED_QUESTION_IDS', () => {
        const src = readFileSync(join(REPO_ROOT, 'js', 'state', 'migrations.js'), 'utf8');

        // Ловит: dict.questions = dict.questions.filter(q => q.id !== 'XXX');
        // и: dict.questions.filter(q => q.id !== "XXX")
        const filterPattern = /dict\.questions(?:\s*=\s*dict\.questions)?\.filter\s*\(\s*q\s*=>\s*q\.id\s*!==?\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/g;
        const removedIds = new Set();
        let m;
        while ((m = filterPattern.exec(src)) !== null) {
            removedIds.add(m[1]);
        }

        assert.ok(removedIds.size >= 3,
            `ожидалось ≥3 удаляющих миграций (dau_target, mau_target, mau_growth_rate_percent); найдено ${removedIds.size}: ${[...removedIds].join(', ')}`);

        const missing = [];
        for (const id of removedIds) {
            if (!DEPRECATED_QUESTION_IDS.has(id)) missing.push(id);
        }
        assert.deepEqual(missing, [],
            `id ${missing.join(', ')} удаляются миграцией, но отсутствуют в DEPRECATED_QUESTION_IDS (seed.js). Добавьте их в Set — иначе render-фильтр и countAnswered пропустят stale данные при snapshot уже-LATEST schemaVersion.`);
    });

    it('symmetric: каждый id из DEPRECATED_QUESTION_IDS либо удаляется миграцией, либо отсутствует в текущем SEED_QUESTIONS', async () => {
        // Защита от другой стороны drift: id попал в blacklist, но миграция не добавлена.
        // Это нестрашно (защита всё равно сработает на render-time), но сигналит о
        // забытой миграции — legacy snapshot будет иметь stale id вечно.
        const { SEED_QUESTIONS } = await import('../../../js/domain/seed.js');
        const seedIds = new Set(SEED_QUESTIONS.map(q => q.id));
        const overlap = [];
        for (const deprecatedId of DEPRECATED_QUESTION_IDS) {
            if (seedIds.has(deprecatedId)) overlap.push(deprecatedId);
        }
        assert.deepEqual(overlap, [],
            `id ${overlap.join(', ')} помечены deprecated, но всё ещё присутствуют в SEED_QUESTIONS — удалите их из seed.`);
    });
});
