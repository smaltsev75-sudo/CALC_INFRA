import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync('js/ui/questionnaire.js', 'utf8');

describe('questionnaire formula impact badges', () => {
    it('marks agent-derived fields as calculation-affecting', () => {
        for (const id of [
            'ai_model_tier',
            'ai_agent_type',
            'agent_complexity',
            'agent_parallel_specialists',
            'agent_tool_use_share'
        ]) {
            assert.match(SRC, new RegExp(`['"]${id}['"]`),
                `${id} is used indirectly through calculator S.agent* factors and must not be shown as informational`);
        }
        assert.match(SRC, /DERIVED_CALCULATION_QUESTION_IDS\.has\(q\.id\)/);
    });
});
