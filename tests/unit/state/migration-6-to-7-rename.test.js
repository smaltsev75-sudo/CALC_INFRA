/**
 * Тест миграции 6→7: переименование 5 ЭК (LICENSE + TRAFFIC),
 * у которых имя дублировало category-label.
 *
 * Контракт:
 *   - расчёт schemaVersion=6 с items {id: 'license-os-per-node', name: 'Лицензия ОС (на узел)'}
 *     после migrateCalculation получает name = 'ОС (на узел)';
 *   - migration идемпотентна (повторное применение → noop);
 *   - НЕ трогает items с другими id (resourceClass, applicableStands и др. сохраняются).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateCalculation } from '../../../js/state/migrations.js';

describe('migration 6→7: rename items dropping category prefix', () => {
    function build(items) {
        return {
            id: 'test', name: 'test',
            schemaVersion: 6,
            settings: {},
            answers: {},
            dictionaries: { items, questions: [] }
        };
    }

    it('переименовывает 5 целевых ЭК, сохраняя остальные поля', () => {
        const calc = build([
            { id: 'license-db-per-vcpu',       name: 'Лицензия СУБД (на vCPU)', category: 'LICENSE', resourceClass: 'LICENSE' },
            { id: 'license-os-per-node',       name: 'Лицензия ОС (на узел)',   category: 'LICENSE', resourceClass: 'LICENSE' },
            { id: 'license-siem-edr-per-node', name: 'Лицензия СЗИ (на узел)',  category: 'LICENSE', resourceClass: 'LICENSE' },
            { id: 'traffic-egress-tb',         name: 'Исходящий трафик (TB/мес)', category: 'TRAFFIC', resourceClass: 'TRAFFIC' },
            { id: 'traffic-ingress-tb',        name: 'Входящий трафик (TB/мес)',  category: 'TRAFFIC', resourceClass: 'TRAFFIC' },
            { id: 'sec-waf',                   name: 'Web Application Firewall (WAF)', category: 'SECURITY', resourceClass: 'SECURITY' }
        ]);
        const out = migrateCalculation(calc);
        // migrateCalculation поднимает до LATEST (v8 после Этапа 13). Главное — что ЭК переименованы.
        assert.ok(out.schemaVersion >= 7);
        const byId = Object.fromEntries(out.dictionaries.items.map(it => [it.id, it]));
        assert.equal(byId['license-db-per-vcpu'].name,       'СУБД (на vCPU)');
        assert.equal(byId['license-os-per-node'].name,       'ОС (на узел)');
        assert.equal(byId['license-siem-edr-per-node'].name, 'СЗИ (на узел)');
        assert.equal(byId['traffic-egress-tb'].name,         'Исходящий (TB/мес)');
        assert.equal(byId['traffic-ingress-tb'].name,        'Входящий (TB/мес)');
        // Не наш id — нетронут.
        assert.equal(byId['sec-waf'].name, 'Web Application Firewall (WAF)');
        // resourceClass и category не пострадали.
        assert.equal(byId['license-os-per-node'].resourceClass, 'LICENSE');
        assert.equal(byId['traffic-egress-tb'].category,        'TRAFFIC');
    });

    it('идемпотентна: повторное применение к v=7 — шаг rename не запускается, имена не меняются', () => {
        const calc = build([
            { id: 'license-os-per-node', name: 'ОС (на узел)', category: 'LICENSE' }
        ]);
        calc.schemaVersion = 7;
        const out = migrateCalculation(calc);
        assert.ok(out.schemaVersion >= 7);
        assert.equal(out.dictionaries.items[0].name, 'ОС (на узел)');
    });

    it('не падает если dictionaries.items пуст или отсутствует', () => {
        const calc1 = build([]);
        assert.doesNotThrow(() => migrateCalculation(calc1));
        const calc2 = { id: 'x', schemaVersion: 6, settings: {}, answers: {} };
        assert.doesNotThrow(() => migrateCalculation(calc2));
    });
});
