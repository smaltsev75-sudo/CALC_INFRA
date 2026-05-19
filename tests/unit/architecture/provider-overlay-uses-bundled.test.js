/**
 * Stage VAT-2 Phase 4 — Architecture: providerOverlay.js использует bundled JSON
 * как source of truth для provider-specific цен, а НЕ hardcoded литералы.
 *
 * Инвариант: после Phase 4 числовые тарифы провайдеров живут ТОЛЬКО в
 * `data/providers/*-latest.json` → `js/data/providers-bundled.generated.js`.
 * `js/domain/providerOverlay.js` — лёгкий wrapper, который трансформирует
 * bundled v2 entries (gross/net/vatRate) в downstream-формат
 * (`pricePerUnit = net`, + meta для UI/audit).
 *
 * Параллельный линтер архитектуры:
 *   - `providers-bundled-sync.test.js` — generated module ≡ JSON.
 *   - `bundled-providers-v2-shape.test.js` — JSON в schema v2.
 *   - этот файл — providerOverlay.js использует generated module, а не литералы.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripJsComments } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const OVERLAY_PATH = join(REPO_ROOT, 'js', 'domain', 'providerOverlay.js');
const JS_ROOT = join(REPO_ROOT, 'js');

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
            if (s.isDirectory()) stack.push(full);
            else if (s.isFile() && full.endsWith('.js')) out.push(full);
        }
    }
    return out;
}

describe('Stage VAT-2 Phase 4: providerOverlay.js imports BUNDLED_PROVIDER_PRICES', () => {
    it('overlay имеет статический import из providers-bundled.generated.js', () => {
        const src = readFileSync(OVERLAY_PATH, 'utf8');
        assert.match(src,
            /import\s*\{\s*BUNDLED_PROVIDER_PRICES\s*\}\s*from\s*['"]\.\.?\/data\/providers-bundled\.generated\.js['"]/,
            'providerOverlay.js должен импортировать BUNDLED_PROVIDER_PRICES.');
    });
});

describe('Stage VAT-2 Phase 4: providerOverlay.js НЕ содержит независимые price maps', () => {
    it('нет блоков типа Object.freeze({ "cpu-vcpu-shared": Object.freeze({ pricePerUnit: 840 ... }) })', () => {
        /* В legacy-стиле hardcoded SBERCLOUD_PRICES было ~14 строк формата
         *   'item-id': Object.freeze({ pricePerUnit: <number>, ... })
         * После Phase 4 такого паттерна в overlay быть НЕ должно. */
        const src = stripJsComments(readFileSync(OVERLAY_PATH, 'utf8'));
        const matches = src.match(
            /['"][a-z][a-z0-9-]+['"]\s*:\s*Object\.freeze\(\s*\{[^}]*pricePerUnit\s*:\s*\d+/g
        ) || [];
        assert.equal(matches.length, 0,
            `Найдены hardcoded provider price entries (${matches.length}):\n` +
            matches.slice(0, 3).map(s => '  ' + s).join('\n'));
    });

    it('нет hardcoded строк "cloud.ru/2026-Q2" / "realistic-stub yandex.cloud" / "realistic-stub vkcloud" (старые priceSource)', () => {
        /* Эти строки были маркерами legacy hardcoded baselines. После Phase 4
         * priceSource приходит из bundled JSON (с другим текстом — «Cloud.ru
         * Evolution договорные тарифы 2026-Q3» / «realistic-stub vkcloud.ru
         * Q3-2026», etc.). */
        const src = stripJsComments(readFileSync(OVERLAY_PATH, 'utf8'));
        assert.doesNotMatch(src, /cloud\.ru\/2026-Q2/,
            'legacy literal "cloud.ru/2026-Q2" должен исчезнуть из overlay');
        assert.doesNotMatch(src, /realistic-stub yandex\.cloud\/services Q2-2026/,
            'legacy literal "realistic-stub yandex.cloud/services Q2-2026" должен исчезнуть');
        assert.doesNotMatch(src, /realistic-stub vkcloud\.ru\/services Q2-2026/,
            'legacy literal "realistic-stub vkcloud.ru/services Q2-2026" должен исчезнуть');
    });

    it('количество числовых литералов >= 100 в overlay ≤ 5 (после Phase 4 их быть не должно)', () => {
        /* Sanity-check на отсутствие массовых price-цифр. До Phase 4 их было
         * 42 (3 провайдера × 14 цен). После — лимит 5 (на всякий случай для
         * метаданных типа MAX_ALIAS_DEPTH=3 или подобных). */
        const src = stripJsComments(readFileSync(OVERLAY_PATH, 'utf8'));
        const matches = src.match(/\b\d{3,}\b/g) || [];
        assert.ok(matches.length <= 5,
            `Найдено ${matches.length} 3+-значных литералов в overlay — ожидалось ≤5. ` +
            `Возможно, остались hardcoded prices.`);
    });
});

describe('Stage VAT-2 Phase 4: PROVIDER_OVERLAYS.prices[id].pricePerUnit === bundled.pricePerUnitNet', () => {
    it('каждый provider/entry: overlay.prices[id].pricePerUnit равен net из bundled', async () => {
        const overlay = await import('../../../js/domain/providerOverlay.js');
        const bundled = await import('../../../js/data/providers-bundled.generated.js');

        const offenders = [];
        for (const [providerId, providerOverlay] of Object.entries(overlay.PROVIDER_OVERLAYS)) {
            const bundledProvider = bundled.BUNDLED_PROVIDER_PRICES[providerId];
            if (!bundledProvider) continue;          /* onprem stub */
            if (!providerOverlay.prices) continue;   /* inactive stub */
            for (const [entryId, overlayEntry] of Object.entries(providerOverlay.prices)) {
                const bundledEntry = bundledProvider.prices[entryId];
                if (!bundledEntry) {
                    offenders.push(`${providerId}.${entryId}: в overlay есть, в bundled нет`);
                    continue;
                }
                if (overlayEntry.pricePerUnit !== bundledEntry.pricePerUnitNet) {
                    offenders.push(
                        `${providerId}.${entryId}: ` +
                        `overlay.pricePerUnit=${overlayEntry.pricePerUnit}, ` +
                        `bundled.pricePerUnitNet=${bundledEntry.pricePerUnitNet}`
                    );
                }
            }
        }
        assert.deepEqual(offenders, [],
            'Overlay prices разошлись с bundled net:\n' + offenders.join('\n'));
    });
});

describe('Stage VAT-2 Phase 4: нет runtime fetch к data/providers/', () => {
    it('ни один js-файл не делает fetch("data/providers/...")', () => {
        const files = walkJs(JS_ROOT);
        const offenders = [];
        for (const file of files) {
            const src = stripJsComments(readFileSync(file, 'utf8'));
            /* Ловит: fetch('data/providers/sbercloud-latest.json'),
             *        fetch(`./data/providers/${id}.json`), и т.д. */
            if (/\bfetch\s*\(\s*['"`][^'"`]*data\/providers\/[^'"`]*['"`]/.test(src)) {
                const rel = file.replace(REPO_ROOT, '').replace(/\\/g, '/').replace(/^\//, '');
                offenders.push(rel);
            }
        }
        assert.deepEqual(offenders, [],
            'Runtime fetch к data/providers/* запрещён (используйте generated module):\n' +
            offenders.join('\n'));
    });
});
