/**
 * Внешний аудит «Жёсткая проверка» (2026-05-20, седьмой по счёту в серии аудитов
 * этого месяца). Регрессионный набор по 7 фиксам PATCH 2.20.8.
 *
 *   P1#1 — BFCache + pageshow re-acquire (app.js).
 *   P1#2 — read-back после write в acquireAppInstanceLock (race).
 *   P2#3 — empty input в itemEditModal pricePerUnit сбрасывает draft в undefined,
 *           не оставляет старое значение (stale-draft).
 *   P2#4 — на mobile viewport (≤720px) topbar wrap'ает actions без overflow.
 *   P2#5 — formulaModal использует buildContext, AI/per-resource override
 *           отражается в evaluate-результате и в таблице переменных.
 *   P3#6 — закрыто параллельной сессией (NUMBER_INPUT_FRACTION_DIGITS=2,
 *           applyDecimalInputPrecision).
 *   P3#7 — invariant ловит `attrs: { type: 'number' }` и
 *           `setAttribute('type', 'number')` (не только inline type).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installLocalStorage } from './storage-mock.js';

const __filename = fileURLToPath(import.meta.url);
const ROOT = join(dirname(__filename), '..', '..');  // tests/integration → project root

installLocalStorage();

const {
    acquireAppInstanceLock,
    releaseAppInstanceLock,
    heartbeatAppInstanceLock,
    checkAppInstanceLock
} = await import('../../js/services/appInstanceLock.js');
const { STORAGE_KEYS } = await import('../../js/utils/constants.js');
const { buildContext } = await import('../../js/domain/calculator.js');
const { formatDecimalInputValue } = await import('../../js/ui/decimalInput.js');

beforeEach(() => {
    installLocalStorage();
});

/* ----------------------------- P1#2 race ------------------------------- */

describe('Audit «Жёсткая проверка» P1#2 — race lost detected via read-back', () => {
    it('первая acquire-попытка успешна', () => {
        const r = acquireAppInstanceLock({
            uuid: () => 'owner-A',
            now: () => 1_700_000_000_000
        });
        assert.equal(r.ok, true);
        assert.equal(r.ownerId, 'owner-A');
    });

    it('если между write и read-back другой owner перезаписал lock — return race-lost', () => {
        /* Симулируем: после нашего write кто-то ещё успел писать.
         * Прокси setItem подменяет наш ownerId на чужой, ровно перед нашим
         * read-back. Это и есть race-окно, которое read-back закрывает. */
        const orig = globalThis.localStorage;
        const proxy = new Proxy(orig, {
            get(target, prop) {
                if (prop === 'setItem') {
                    return (k, v) => {
                        target.setItem(k, v);
                        if (k === STORAGE_KEYS.APP_INSTANCE_LOCK) {
                            // Мгновенно «крадём» lock — как другая вкладка.
                            const stolen = JSON.parse(v);
                            stolen.ownerId = 'evil-owner-B';
                            target.setItem(k, JSON.stringify(stolen));
                        }
                    };
                }
                return target[prop];
            }
        });
        Object.defineProperty(globalThis, 'localStorage', {
            value: proxy, configurable: true, writable: true
        });

        const r = acquireAppInstanceLock({
            uuid: () => 'owner-A',
            now: () => 1_700_000_000_000
        });
        assert.equal(r.ok, false);
        assert.equal(r.reason, 'race-lost');
        assert.equal(r.existing?.ownerId, 'evil-owner-B');

        Object.defineProperty(globalThis, 'localStorage', {
            value: orig, configurable: true, writable: true
        });
    });

    it('heartbeat остаётся корректным после успешного acquire', () => {
        const r = acquireAppInstanceLock({
            uuid: () => 'owner-A',
            now: () => 1_700_000_000_000
        });
        assert.equal(r.ok, true);
        const hb = heartbeatAppInstanceLock('owner-A', { now: () => 1_700_000_000_500 });
        assert.equal(hb.ok, true);
    });

    it('releaseAppInstanceLock освобождает lock (sanity)', () => {
        acquireAppInstanceLock({ uuid: () => 'owner-A', now: () => 1_700_000_000_000 });
        const r = releaseAppInstanceLock('owner-A');
        assert.equal(r.ok, true);
        const check = checkAppInstanceLock();
        assert.equal(check.status, 'free');
    });
});

/* ----------------------------- P1#1 BFCache ---------------------------- */

describe('Audit «Жёсткая проверка» P1#1 — pageshow re-acquire после BFCache', () => {
    it('app.js подписывает pageshow на handleInstanceLockPageshow', () => {
        const src = readFileSync(join(ROOT,'js', 'app.js'), 'utf8');
        assert.match(src, /handleInstanceLockPageshow/,
            'Должен существовать handler для pageshow с BFCache-restore');
        assert.match(src, /addEventListener\(\s*['"]pageshow['"]\s*,\s*handleInstanceLockPageshow/,
            'pageshow должен быть подписан на handleInstanceLockPageshow');
    });

    it('instanceLockRuntime при BFCache-restore проверяет e.persisted и вызывает acquireAppInstanceLock', () => {
        const src = readFileSync(join(ROOT,'js', 'app', 'instanceLockRuntime.js'), 'utf8');
        const fnMatch = src.match(/function handlePageshow\(e\)\s*\{([\s\S]*?)\n\}/);
        assert.ok(fnMatch, 'handlePageshow должен быть в instanceLockRuntime.js');
        const body = fnMatch[1];
        assert.match(body, /e\.persisted/,
            'Handler обязан проверять e.persisted (BFCache marker)');
        assert.match(body, /acquireAppInstanceLock\(/,
            'handler обязан вызвать acquireAppInstanceLock после BFCache-restore');
        assert.match(body, /start\s*\(\s*r\.ownerId\s*\)/,
            'handler обязан перезапустить runtime heartbeat после re-acquire');
    });
});

/* --------------------- P1#1+P1#2 — listener ДО acquire ----------------- */

describe('Audit «Жёсткая проверка» P1#2 — storage-listener устанавливается ДО acquire', () => {
    it('addEventListener для storage идёт до acquireAppInstanceLock в boot()', () => {
        const src = readFileSync(join(ROOT,'js', 'app.js'), 'utf8');
        const bootStart = src.indexOf('function boot()');
        assert.ok(bootStart > 0, 'boot() должна существовать');
        const bootBody = src.slice(bootStart);
        const acquireIdx = bootBody.indexOf('acquireAppInstanceLock()');
        const storageListenerIdx = bootBody.indexOf("addEventListener('storage'");
        assert.ok(storageListenerIdx >= 0, 'storage listener должен быть в boot()');
        assert.ok(acquireIdx >= 0, 'acquireAppInstanceLock должен быть в boot()');
        assert.ok(storageListenerIdx < acquireIdx,
            'storage listener обязан подписаться ДО acquireAppInstanceLock — иначе ' +
            'overtake между existing-check и read-back не отлавливается через DOM-event.');
    });
});

/* --------------------- P2#3 — itemEditModal stale draft ---------------- */

describe('Audit «Жёсткая проверка» P2#3 — empty input сбрасывает pricePerUnit в undefined', () => {
    it('itemEditModal:onInput обрабатывает raw === ""', () => {
        const src = readFileSync(join(ROOT,'js', 'ui', 'modals', 'itemEditModal.js'), 'utf8');
        /* Должна быть ветка: empty → patchDraft({pricePerUnit: undefined}).
         * Это закрывает stale-draft: пользователь стёр поле → видит пусто →
         * draft.pricePerUnit становится undefined → save отвергается. */
        assert.match(src, /raw\s*===\s*['"]['"]\s*\)\s*\{[^}]*patchDraft\([^)]*pricePerUnit:\s*undefined/,
            'itemEditModal должен очищать draft.pricePerUnit при пустом инпуте');
    });
});

/* --------------------- P2#4 — mobile topbar overflow ------------------- */

describe('Audit «Жёсткая проверка» P2#4 — mobile topbar не вылезает за viewport', () => {
    it('layout.css на ≤720px wraps app-topbar и actions занимают полную ширину', () => {
        const src = readFileSync(join(ROOT,'css', 'layout.css'), 'utf8');
        /* В @media (max-width: 720px) должны быть правила .app-topbar
         * flex-wrap: wrap и .app-topbar-actions width: 100%. */
        const mediaMatch = src.match(/@media\s*\(max-width:\s*720px\)\s*\{([\s\S]*?)\n\}/g);
        assert.ok(mediaMatch && mediaMatch.length > 0,
            'Должна быть @media (max-width: 720px) в layout.css');
        const allBodies = mediaMatch.join('\n');
        assert.match(allBodies, /\.app-topbar\s*\{[^}]*flex-wrap:\s*wrap/,
            '.app-topbar должен flex-wrap: wrap на mobile');
        assert.match(allBodies, /\.app-topbar-actions\s*\{[^}]*width:\s*100%/,
            '.app-topbar-actions должны занимать полную ширину на mobile');
        assert.match(allBodies, /\.app-main-col\s*\{[^}]*min-width:\s*0/,
            '.app-main-col min-width:0 возвращается на mobile (PATCH 2.4.35 убрал глобально)');
    });
});

/* --------------------- P2#5 — formulaModal scope ----------------------- */

describe('Audit «Жёсткая проверка» P2#5 — Formula scope = реальный buildContext', () => {
    it('buildContext экспортирован из calculator', () => {
        assert.equal(typeof buildContext, 'function');
    });

    it('для AI-item ratio в context — это aiStandFactor, не общий standSizeRatio', () => {
        const settings = {
            standSizeRatio: { DEV: 0.2, IFT: 0.4, PSI: 0.5, PROD: 1.0, LOAD: 1.2 },
            aiStandFactor: { DEV: 0.02, IFT: 0.2, PSI: 0.5, PROD: 1.0, LOAD: 1.0 }
        };
        const answers = { ai_agent_mode: false };
        const aiItem = {
            id: 'llm-tokens-input-1m',
            category: 'AI',
            dashboardAiMetric: 'TOKENS'
        };
        const ctx = buildContext(answers, settings, {}, 'DEV', aiItem);
        assert.equal(ctx.S.standSizeRatio.DEV, 0.02,
            'AI-item на DEV должен использовать aiStandFactor (0.02), не standSizeRatio (0.2)');
        assert.equal(ctx.S.standSizeRatio.PROD, 1.0,
            'PROD AI-фактор заперт = 1.00');
    });

    it('hardware-item с dashboardResource использует resourceRatio override', () => {
        const settings = {
            standSizeRatio: { DEV: 0.2, IFT: 0.4, PSI: 0.5, PROD: 1.0, LOAD: 1.2 },
            resourceRatio: {
                DEV: { CPU: 0.05, RAM: 0.3 },
                IFT: { CPU: 0.5, RAM: 0.5 }
            }
        };
        const cpuItem = { id: 'cpu-vcpu-shared', dashboardResource: 'CPU', category: 'HW' };
        const ctxDev = buildContext({}, settings, {}, 'DEV', cpuItem);
        assert.equal(ctxDev.S.standSizeRatio.DEV, 0.05,
            'CPU-item на DEV должен использовать resourceRatio.DEV.CPU (0.05)');
        const ctxIft = buildContext({}, settings, {}, 'IFT', cpuItem);
        assert.equal(ctxIft.S.standSizeRatio.IFT, 0.5,
            'CPU-item на IFT должен использовать resourceRatio.IFT.CPU (0.5)');
    });

    it('formulaModal импортирует buildContext и передаёт item', () => {
        const src = readFileSync(join(ROOT,'js', 'ui', 'modals', 'formulaModal.js'), 'utf8');
        assert.match(src, /import\s*\{[^}]*buildContext[^}]*\}\s*from\s*['"]\.\.\/\.\.\/domain\/calculator\.js['"]/,
            'formulaModal должен импортировать buildContext из calculator.js');
        assert.match(src, /buildContext\(\s*calc\.answers/,
            'formulaModal должен звать buildContext с calc.answers');
        assert.match(src, /renderResolvedRefs\([^,]+,\s*calc,\s*stand,\s*item\)/,
            'renderResolvedRefs должен принимать item для AI/per-resource override');
    });
});

/* --------------------- P3#6 — точность дробей -------------------------- */

describe('Audit «Жёсткая проверка» P3#6 — domain choice: 2 знака для денег (копейки)', () => {
    it('formatDecimalInputValue по умолчанию ограничен 2 знаками — параллельная сессия', () => {
        /* Параллельная сессия выбрала «копейки» как domain-инвариант для
         * данного денежного калькулятора. 0.0000004 (микро-цена за токен) при
         * этом теряется — это осознанное ограничение модели данных, не баг.
         * Для коэффициентов риска / процентов 2 знака достаточны
         * (kInflation=0.08, kSeasonal=0.15, и т.д.). */
        assert.equal(formatDecimalInputValue(0.0000004), '0',
            'микро-числа округляются до 2 знаков (denomination = копейки)');
        assert.equal(formatDecimalInputValue(123.456), '123,46');
        assert.equal(formatDecimalInputValue(123), '123');
    });
});
