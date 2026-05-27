import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeRiskContribution } from '../../../js/ui/dashboardRiskCard.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
    join(__dirname, '..', '..', '..', 'js', 'ui', 'dashboardRiskCard.js'),
    'utf8'
);

function approx(actual, expected, message) {
    assert.ok(
        Math.abs(actual - expected) < 1e-9,
        `${message}: expected ${expected}, got ${actual}`
    );
}

describe('dashboardRiskCard', () => {
    it('computes multiplicative risk contribution from active stands only', () => {
        const result = {
            stands: {
                DEV: {
                    items: [{
                        costBase: 100,
                        riskBreakdown: {
                            total: 1.32,
                            bufferFactor: 1.2,
                            inflationMul: 1.1,
                            seasonalMul: 1,
                            scheduleMul: 1,
                            contingencyMul: 1
                        }
                    }]
                },
                PROD: {
                    items: [{
                        costBase: 900,
                        riskBreakdown: {
                            total: 2,
                            bufferFactor: 2,
                            inflationMul: 1,
                            seasonalMul: 1,
                            scheduleMul: 1,
                            contingencyMul: 1
                        }
                    }]
                }
            }
        };

        const data = computeRiskContribution(result, ['PROD']);

        assert.ok(data);
        approx(data.overall, 1.32, 'overall multiplier');
        approx(data.surplus, 0.32, 'surplus multiplier');

        const byId = Object.fromEntries(data.items.map(item => [item.id, item]));
        const lnBuffer = Math.log(1.2);
        const lnInflation = Math.log(1.1);
        const lnTotal = lnBuffer + lnInflation;

        approx(byId.bufferFactor.multiplier, 1.2, 'buffer multiplier');
        approx(byId.inflationMul.multiplier, 1.1, 'inflation multiplier');
        approx(byId.bufferFactor.shareOfSurplus, lnBuffer / lnTotal, 'buffer share');
        approx(byId.inflationMul.shareOfSurplus, lnInflation / lnTotal, 'inflation share');
        approx(
            data.items.reduce((sum, item) => sum + item.contribution, 0),
            data.surplus,
            'component contributions sum'
        );
    });

    it('returns null when no active item has a risk surplus', () => {
        assert.equal(
            computeRiskContribution({
                stands: {
                    DEV: {
                        items: [{
                            costBase: 100,
                            riskBreakdown: {
                                total: 1,
                                bufferFactor: 1,
                                inflationMul: 1,
                                seasonalMul: 1,
                                scheduleMul: 1,
                                contingencyMul: 1
                            }
                        }]
                    }
                }
            }),
            null
        );
    });

    it('does not render duplicate "если применить" copy under the surcharge amount', () => {
        assert.doesNotMatch(source, /dash-risk-surplus-note/,
            'не добавлять отдельную строку под суммой: режим уже указан в подзаголовке');
        assert.doesNotMatch(source, /text:\s*['"]если применить['"]/,
            'нижняя строка "если применить" дублирует подзаголовок карточки');
    });
});
