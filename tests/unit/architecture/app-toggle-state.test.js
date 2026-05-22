import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { nextCollapsedIds, nextGlobalExpandedIds } from '../../../js/app/toggleState.js';

describe('app toggleState helpers', () => {
    it('nextCollapsedIds: null означает все свёрнуты, первый клик раскрывает выбранный id', () => {
        assert.deepEqual(
            nextCollapsedIds(null, 'storage', ['infra', 'storage', 'ai']),
            ['infra', 'ai']
        );
    });

    it('nextCollapsedIds: collapsed id раскрывается', () => {
        assert.deepEqual(
            nextCollapsedIds(['infra', 'ai'], 'infra', ['infra', 'storage', 'ai']),
            ['ai']
        );
    });

    it('nextCollapsedIds: opened id сворачивается', () => {
        assert.deepEqual(
            nextCollapsedIds(['infra', 'ai'], 'storage', ['infra', 'storage', 'ai']),
            ['infra', 'ai', 'storage']
        );
    });

    it('nextGlobalExpandedIds: раскрывает все, если не все раскрыты', () => {
        assert.deepEqual(
            nextGlobalExpandedIds(['DEV'], ['DEV', 'IFT', 'PROD']),
            ['DEV', 'IFT', 'PROD']
        );
    });

    it('nextGlobalExpandedIds: сворачивает все, если все раскрыты', () => {
        assert.deepEqual(
            nextGlobalExpandedIds(['DEV', 'IFT', 'PROD'], ['DEV', 'IFT', 'PROD']),
            []
        );
    });
});
