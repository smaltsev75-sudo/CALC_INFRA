/**
 * PATCH 2.22.16 — forcing function против рецидива класса «формула ЭК переведена
 * на новый Q-драйвер, но ЭК забыт в _AGENT_FORMULA_REFRESH_IDS» (латентный
 * no-drift баг для legacy-расчётов: при открытии старого расчёта формула не
 * обновляется → ввод пользователя в новые поля тихо игнорируется).
 *
 * Аудит 5B-Sec: SIEM/DDoS/WAF были добавлены в список явно (пользователь
 * поправлял каждый раз), а audit-log (первый срез серии, v2.22.12) выпал — оси
 * A/B/E сошлись на этом независимо.
 *
 * Инвариант: любой SEED-ЭК, чья qtyFormula ссылается на 5B-Sec scaling-драйвер,
 * ОБЯЗАН присутствовать в _AGENT_FORMULA_REFRESH_IDS.
 *
 * Список refresh-id парсится из исходника seed.js (константа module-private, не
 * экспортируется) — статический скан в стиле архитектурных инвариантов проекта.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEED_ITEMS } from '../../../js/domain/seed.js';

const SEED_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../js/domain/seed.js');
const SEED_SRC = readFileSync(SEED_PATH, 'utf8');

// Драйверы масштаба, введённые в 5B-Sec для security/network ЭК.
const DRIVERS_5B_SEC = [
    'audit_events_per_day', 'audit_bytes_per_event', 'audit_retention_years', 'audit_log_compression_ratio',
    'siem_log_gb_per_day', 'siem_sources_count', 'siem_tier',
    'ddos_tier', 'waf_domains_count'
];
const DRIVER_RE = new RegExp('\\bQ\\.(' + DRIVERS_5B_SEC.join('|') + ')\\b');

function parseRefreshIds(src) {
    const m = src.match(/_AGENT_FORMULA_REFRESH_IDS\s*=\s*\[([\s\S]*?)\]/);
    assert.ok(m, '_AGENT_FORMULA_REFRESH_IDS массив не найден в seed.js');
    const ids = new Set();
    const re = /'([^']+)'/g;
    let mm;
    while ((mm = re.exec(m[1])) !== null) ids.add(mm[1]);
    return ids;
}

function itemsReferencingDrivers() {
    const out = [];
    for (const item of SEED_ITEMS) {
        const formulas = item && item.qtyFormulas;
        if (!formulas || typeof formulas !== 'object') continue;
        const refsDriver = Object.values(formulas)
            .some(src => typeof src === 'string' && DRIVER_RE.test(src));
        if (refsDriver) out.push(item.id);
    }
    return out;
}

describe('2.22.16 — _AGENT_FORMULA_REFRESH_IDS покрывает все 5B-Sec driver-ЭК', () => {
    const refreshIds = parseRefreshIds(SEED_SRC);
    const driverItems = itemsReferencingDrivers();

    it('тест реально находит driver-ЭК (защита от ложно-зелёного)', () => {
        // Минимум 5: audit-log, one-siem-integration, security-siem-monitoring,
        // network-ddos-protection, network-waf. Если detection вернул пусто —
        // инвариант ниже тривиально-зелёный и бесполезен (§6.ter.8).
        assert.ok(driverItems.length >= 5,
            `ожидалось ≥5 ЭК со ссылкой на 5B-Sec драйверы, найдено ${driverItems.length}: ${driverItems.join(', ')}`);
        for (const expected of ['security-audit-log-storage-gb', 'one-siem-integration',
            'security-siem-monitoring', 'network-ddos-protection', 'network-waf']) {
            assert.ok(driverItems.includes(expected),
                `driver-detection должен покрывать ${expected}`);
        }
    });

    it('каждый driver-ЭК присутствует в _AGENT_FORMULA_REFRESH_IDS', () => {
        const missing = driverItems.filter(id => !refreshIds.has(id));
        assert.deepEqual(missing, [],
            `ЭК со сменившейся на 5B-Sec драйвер формулой ОБЯЗАНЫ быть в _AGENT_FORMULA_REFRESH_IDS, ` +
            `иначе legacy-расчёт не получит новую формулу и ввод пользователя будет проигнорирован. ` +
            `Отсутствуют: ${missing.join(', ')}`);
    });
});
