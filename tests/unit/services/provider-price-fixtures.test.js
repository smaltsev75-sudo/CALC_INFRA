/**
 * Stage 8.1.5: bundled JSON fixtures валидны через validateProviderPriceJson
 * и их providerId присутствует в PROVIDER_OVERLAYS.
 *
 * Цель: при добавлении нового файла в `data/providers/` он автоматически
 * проверяется на структурную корректность (защита от опечаток в JSON,
 * рассинхронизации с PROVIDER_OVERLAYS-ключом и т.п.).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateProviderPriceJson } from '../../../js/services/providerPriceFetch.js';
import { PROVIDER_OVERLAYS } from '../../../js/domain/providerOverlay.js';

const __dirname  = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', '..', 'data', 'providers');

function listFixtures() {
    try {
        return readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
    } catch {
        return [];
    }
}

describe('Stage 8.1.5 data/providers fixtures', () => {
    const fixtures = listFixtures();

    it('директория data/providers существует и содержит хотя бы один JSON', () => {
        assert.ok(fixtures.length > 0,
            'data/providers/ должен содержать минимум один JSON-fixture для Stage 8.1');
    });

    for (const file of fixtures) {
        it(`${file}: валиден через validateProviderPriceJson`, () => {
            const raw = readFileSync(join(DATA_DIR, file), 'utf8');
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (e) {
                assert.fail(`${file}: невалидный JSON — ${e.message}`);
            }
            const r = validateProviderPriceJson(parsed, parsed.providerId);
            assert.equal(r.ok, true,
                `${file}: validate fail (reason=${r.reason}, message=${r.message})`);
        });

        it(`${file}: providerId присутствует в PROVIDER_OVERLAYS`, () => {
            const raw = readFileSync(join(DATA_DIR, file), 'utf8');
            const parsed = JSON.parse(raw);
            assert.ok(PROVIDER_OVERLAYS[parsed.providerId],
                `${file}: providerId="${parsed.providerId}" отсутствует в PROVIDER_OVERLAYS — ` +
                'либо опечатка в JSON, либо файл нужно удалить (provider больше не поддерживается).');
        });
    }
});

/* Stage 8.4 (post-Phase-5): для каждого active онлайн-провайдера обязан
   существовать `<id>-latest.json` как maintainer-shipped reference price.
   Bundled-fetch удалён в Stage 17.2 Phase 3a; файлы остаются для:
     • интеграторов — как актуальный snapshot цен, который пользователь может
       вручную загрузить через «Импорт прайса JSON» в Опроснике;
     • тестов — как fixture для validateProviderPriceJson (см. выше).
   On-prem — exception (active=false). */
describe('Stage 8.4 каждый active онлайн-провайдер имеет <id>-latest.json', () => {
    const onlineActive = Object.values(PROVIDER_OVERLAYS)
        .filter(p => p.active && p.id !== 'onprem')
        .map(p => p.id);

    for (const id of onlineActive) {
        it(`провайдер "${id}" имеет файл ${id}-latest.json`, () => {
            const expected = `${id}-latest.json`;
            const fixtures = listFixtures();
            assert.ok(fixtures.includes(expected),
                `Stage 8.4: для активного провайдера "${id}" обязателен файл data/providers/${expected}. ` +
                'Если провайдер временно без обновлений — переключите его active=false в providerOverlay.js.');
        });
    }

    it('on-prem не имеет latest.json (active=false, обновление через file-picker)', () => {
        const fixtures = listFixtures();
        assert.ok(!fixtures.includes('onprem-latest.json'),
            'on-prem НЕ должен иметь bundled latest.json — обновление должно идти только через file-picker.');
    });

    it('каждый -latest.json имеет version и timestamp в правильном формате', () => {
        const latests = listFixtures().filter(f => f.endsWith('-latest.json'));
        assert.ok(latests.length >= 1, 'минимум один -latest.json должен существовать');
        for (const file of latests) {
            const parsed = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
            assert.ok(parsed.version && typeof parsed.version === 'string' && parsed.version.length > 0,
                `${file}: version должен быть непустой строкой`);
            assert.ok(parsed.timestamp && !Number.isNaN(new Date(parsed.timestamp).getTime()),
                `${file}: timestamp должен быть парсимой ISO-датой`);
        }
    });
});
