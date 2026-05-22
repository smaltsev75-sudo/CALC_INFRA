/**
 * Этап 13.U5: SETTINGS_DESCRIPTIONS — единый источник пояснений для
 * параметров расчёта. Тест защищает контракт:
 *   1. Ключи покрывают все settings, которые рендерит renderSettingsTable
 *      в js/ui/printAnswers.js (ничего не упало в '—').
 *   2. Все значения — непустые осмысленные строки (≥ 30 символов: иначе
 *      это «зашёл и забыл», без пользы для согласования).
 *   3. Объект заморожен (Object.freeze) — не мутируется случайно.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SETTINGS_DESCRIPTIONS } from '../../../js/utils/constants.js';

const REQUIRED_KEYS = [
    'phaseDurationMonths',
    'daysPerMonth',
    'planningHorizonYears',
    'bufferTask',
    'bufferProject',
    'kInflation',
    'kSeasonal',
    'kScheduleShift',
    'kContingency',
    'vatEnabled',
    'vatRate',
    'standSizeRatio'
];

describe('SETTINGS_DESCRIPTIONS', () => {

    it('экспортируется и заморожен', () => {
        assert.ok(SETTINGS_DESCRIPTIONS, 'SETTINGS_DESCRIPTIONS должен быть экспортирован');
        assert.ok(Object.isFrozen(SETTINGS_DESCRIPTIONS),
            'мапа должна быть заморожена через Object.freeze для защиты от мутаций');
    });

    it('покрывает все settings, которые попадают в PDF (renderSettingsTable)', () => {
        for (const key of REQUIRED_KEYS) {
            assert.ok(
                key in SETTINGS_DESCRIPTIONS,
                `SETTINGS_DESCRIPTIONS["${key}"] должен существовать — на него ссылается ` +
                `renderSettingsTable в printAnswers.js. Если поле удалено — также убрать ` +
                `соответствующую строку из items[] в printAnswers.js.`
            );
        }
    });

    it('все описания — непустые строки длиной ≥ 30 символов', () => {
        for (const [key, value] of Object.entries(SETTINGS_DESCRIPTIONS)) {
            assert.equal(typeof value, 'string', `${key}: должен быть строкой`);
            assert.ok(value.trim().length >= 30,
                `${key}: описание слишком короткое (${value.length} симв.) — ` +
                `пояснение должно быть осмысленным для согласования с заказчиком в PDF.`);
        }
    });

    it('используется в UI настройках опросника (грубая проверка через импорт)', async () => {
        // Простейший контр-линтер: settings UI импортирует SETTINGS_DESCRIPTIONS.
        // Если кто-то удалит импорт и вернёт inline-строки — этот тест упадёт.
        const fs = await import('node:fs');
        const path = await import('node:path');
        const url = await import('node:url');
        const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
        const src = [
            'questionnaireSettings.js',
            'questionnaireVatSettings.js',
            'questionnairePercentField.js'
        ].map(file => fs.readFileSync(
            path.join(__dirname, '..', '..', '..', 'js', 'ui', file),
            'utf8'
        )).join('\n');
        assert.match(src, /SETTINGS_DESCRIPTIONS/,
            'UI настройки опросника должны импортировать и использовать SETTINGS_DESCRIPTIONS — ' +
            'иначе пояснения в опроснике и в PDF разъедутся.');
    });
});
