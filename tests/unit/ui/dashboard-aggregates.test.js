import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    aggregateResources,
    distributeRoundingPreservingSum,
    formatResourceQty
} from '../../../js/ui/dashboardAggregates.js';

describe('dashboardAggregates', () => {
    it('aggregateResources uses SEED fallback and excludes disabled stands from total', () => {
        const result = {
            items: {
                'cpu-vm': {
                    stands: {
                        DEV: { qty: 2 },
                        PROD: { qty: 10 }
                    }
                }
            }
        };
        const dictionaryItems = [{
            id: 'cpu-vm',
            unit: 'vCPU',
            dashboardResource: 'CPU',
            applicableStands: ['DEV', 'PROD']
        }];

        const resources = aggregateResources(result, dictionaryItems, ['DEV'], false);

        assert.equal(resources.perStand.DEV.CPU.qty, 2);
        assert.equal(resources.perStand.PROD.CPU.qty, 10);
        assert.equal(resources.total.CPU.qty, 10);
        assert.equal(resources.total.CPU.applicable, true);
    });

    it('aggregateResources applies capacity risks but not inflation or VAT', () => {
        const result = {
            items: {
                cpu: {
                    stands: {
                        PROD: {
                            qty: 10,
                            riskBreakdown: {
                                bufferFactor: 1.2,
                                seasonalMul: 1.5,
                                scheduleMul: 2,
                                contingencyMul: 1.1,
                                inflationMul: 9,
                                vatMul: 9
                            }
                        }
                    }
                }
            }
        };
        const dictionaryItems = [{
            id: 'cpu',
            unit: 'vCPU',
            dashboardResource: 'CPU',
            applicableStands: ['PROD']
        }];

        const resources = aggregateResources(result, dictionaryItems, [], true);

        assert.equal(resources.total.CPU.qty, 10 * 1.2 * 1.5 * 2 * 1.1);
    });

    it('distributeRoundingPreservingSum keeps active stand sum equal to rounded total', () => {
        const resources = {
            total: { CPU: { qty: 2 } },
            perStand: {
                DEV: { CPU: { qty: 0.4 } },
                IFT: { CPU: { qty: 0.4 } },
                PSI: { CPU: { qty: 0.4 } },
                LOAD: { CPU: { qty: 0.4 } },
                PROD: { CPU: { qty: 0.4 } }
            }
        };

        distributeRoundingPreservingSum(resources, ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD']);

        const sum = ['DEV', 'IFT', 'PSI', 'LOAD', 'PROD']
            .reduce((acc, sid) => acc + resources.perStand[sid].CPU.qty, 0);
        assert.equal(resources.total.CPU.qty, 2);
        assert.equal(sum, 2);
    });

    it('formatResourceQty returns null for empty values and integer text otherwise', () => {
        assert.equal(formatResourceQty(0, 'vCPU'), null);
        assert.equal(formatResourceQty(12.6, 'vCPU'), '13');
    });
});
