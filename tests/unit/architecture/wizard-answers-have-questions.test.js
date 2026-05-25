import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SEED_QUESTIONS } from '../../../js/domain/seed.js';
import {
    ACTIVITY_LABELS,
    GEOGRAPHY_LABELS,
    INDUSTRY_PROFILES,
    SCALE_RULES
} from '../../../js/domain/wizardProfileData.js';
import { wizardToAnswers } from '../../../js/domain/wizardProfiles.js';

const PRODUCT_TYPES = ['internal', 'b2b', 'b2c', 'b2g'];

describe('wizard profile contract: generated answers have seed questions', () => {
    it('не создаёт orphan answers, которые формулы/UI не смогут объяснить', () => {
        const questionIds = new Set(SEED_QUESTIONS.map(q => q.id));
        const orphan = new Set();

        for (const product_type of PRODUCT_TYPES) {
            for (const industry of Object.keys(INDUSTRY_PROFILES)) {
                for (const scale of Object.keys(SCALE_RULES)) {
                    for (const geography of Object.keys(GEOGRAPHY_LABELS)) {
                        for (const activity of Object.keys(ACTIVITY_LABELS)) {
                            const { answers } = wizardToAnswers({
                                product_type,
                                industry,
                                scale,
                                geography,
                                pdn: true,
                                activity,
                                ai_used: true
                            });
                            for (const id of Object.keys(answers)) {
                                if (!questionIds.has(id)) orphan.add(id);
                            }
                        }
                    }
                }
            }
        }

        assert.deepEqual([...orphan].sort(), []);
    });
});
