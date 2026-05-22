import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyPriceImportAction,
    handleItemPricesImportResult,
    importItemPricesAction
} from '../../../js/app/priceImportActions.js';

function createSnackbarSpy() {
    const calls = [];
    return {
        calls,
        success(message) { calls.push(['success', message]); },
        warning(message) { calls.push(['warning', message]); },
        info(message) { calls.push(['info', message]); },
        error(message) { calls.push(['error', message]); }
    };
}

describe('app priceImportActions', () => {
    it('applyPriceImportAction показывает warning при full refresh-failure', () => {
        const snackbar = createSnackbarSpy();
        const result = {
            ok: true,
            summary: {
                partial: true,
                refreshReason: 'locked-by-other-tab',
                refreshMessage: 'занято другой вкладкой',
                refreshErrors: [],
                providerId: 'cloud',
                priceCount: 12
            }
        };

        assert.equal(
            applyPriceImportAction({
                priceImportCtl: { applyPriceImport: () => result },
                snackbar
            }),
            result
        );

        assert.equal(snackbar.calls.length, 1);
        assert.equal(snackbar.calls[0][0], 'warning');
        assert.match(snackbar.calls[0][1], /Закройте параллельную вкладку/);
    });

    it('handleItemPricesImportResult открывает summary-modal для пропущенных аномалий', () => {
        const snackbar = createSnackbarSpy();
        const modals = [];
        const store = {
            openModal(name, payload) { modals.push([name, payload]); }
        };

        handleItemPricesImportResult({
            store,
            snackbar,
            res: {
                ok: true,
                fileName: 'prices.csv',
                updatesCount: 2,
                unchanged: 1,
                safeUpdatesCount: 0,
                anomaliesApplied: 1,
                anomalies: [
                    { id: 'cpu', name: 'CPU', reason: 'x11' },
                    { id: 'ram', name: 'RAM', reason: 'x12' }
                ],
                rejected: [{ rowIndex: 7, id: 'bad', reason: 'нет id' }]
            }
        });

        assert.equal(modals.length, 1);
        assert.equal(modals[0][0], 'message');
        assert.equal(modals[0][1].title, 'Импорт цен — аномалии пропущены');
        assert.match(modals[0][1].message, /АНОМАЛЬНЫЕ ИЗМЕНЕНИЯ/);
        assert.match(modals[0][1].message, /ОТКЛОНЁННЫЕ СТРОКИ/);
        assert.deepEqual(snackbar.calls[0], ['success', 'Обновлено цен: 2 (вкл. аномалий: 1)']);
    });

    it('importItemPricesAction передаёт confirmAnomalies и loading-wrapper', async () => {
        const snackbar = createSnackbarSpy();
        const confirmations = [];
        let wrapped = false;

        await importItemPricesAction({
            triggerEvent: { type: 'click' },
            store: { openModal() {} },
            snackbar,
            withLoadingButton(triggerEvent, run) {
                assert.equal(triggerEvent.type, 'click');
                wrapped = true;
                return run();
            },
            confirmAsync(opts) {
                confirmations.push(opts);
                return Promise.resolve(true);
            },
            itemCtl: {
                async importItemPrices({ confirmAnomalies }) {
                    await confirmAnomalies(Array.from({ length: 11 }, (_, i) => ({
                        id: `it-${i}`,
                        name: `Item ${i}`,
                        reason: `x${i + 10}`
                    })));
                    return {
                        ok: true,
                        fileName: 'prices.csv',
                        updatesCount: 0,
                        unchanged: 3,
                        safeUpdatesCount: 0,
                        anomaliesApplied: 0,
                        anomalies: [],
                        rejected: []
                    };
                }
            }
        });

        assert.equal(wrapped, true);
        assert.equal(confirmations.length, 1);
        assert.equal(confirmations[0].title, 'Аномальные цены: 11');
        assert.match(confirmations[0].message, /…и ещё 1/);
        assert.deepEqual(snackbar.calls[0], ['info', 'Цены в файле совпадают с текущими — обновлять нечего']);
    });
});
