/**
 * Regression-тест: ctx.toggleStand() должен вызывать commit() (autosave),
 * чтобы фильтр стендов (calc.view.disabledStands) сохранялся в localStorage
 * и переживал F5.
 *
 * Раньше toggleStand вызывал store.updateActiveCalc(...) напрямую,
 * минуя commit() — изменение оставалось только в памяти, при F5 calc
 * загружался из localStorage без disabledStands → фильтр сбрасывался.
 *
 * Контракт: toggleStand живёт в calcController (или ctx-обёртке, которая
 * после updateActiveCalc вызывает commit()).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const calcController = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'controllers', 'calcController.js'),
    'utf8'
);
const appJs = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'app.js'),
    'utf8'
);

describe('toggleStand: persist via commit() (12.U30 fix)', () => {
    it('toggleStand определён в calcController.js (а не в app.js без commit)', () => {
        assert.match(calcController, /export\s+function\s+toggleStand\s*\(/,
            'toggleStand должна жить в calcController, чтобы вызывать commit() после updateActiveCalc');
    });

    it('toggleStand в calcController вызывает commit() (autosave)', () => {
        // Ищем тело функции toggleStand
        const m = calcController.match(/export\s+function\s+toggleStand\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(m, 'функция toggleStand должна существовать');
        assert.match(m[1], /commit\(\)/,
            'тело toggleStand должно вызывать commit() — иначе изменение в view.disabledStands ' +
            'НЕ сохраняется в localStorage и сбрасывается при F5');
    });

    it('app.js ctx.toggleStand делегирует в calcController (а не дёргает store напрямую)', () => {
        // В ctx.toggleStand должен быть либо `calc.toggleStand(...)`, либо `import { toggleStand }`.
        const m = appJs.match(/toggleStand\(standId\)\s*\{([\s\S]*?)\n\s{4}\}/);
        assert.ok(m, 'ctx.toggleStand должна существовать');
        assert.match(m[1], /calc\.toggleStand|toggleStand\(/,
            'ctx.toggleStand должен делегировать в calcController, не вызывать store.updateActiveCalc сам');
    });
});
