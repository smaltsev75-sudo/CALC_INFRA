/**
 * Desktop UI hardening: modal footers must tolerate long Russian action labels.
 *
 * The app is desktop-first, so this is not a mobile-stack rule. It protects
 * 600-880px desktop dialogs from footer overflow when several `.btn`
 * elements keep their default `white-space: nowrap`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ruleBody } from '../../_helpers/source.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

const modalsCss = readFileSync(resolve(repoRoot, 'css/modals.css'), 'utf8');
const dashboardCss = readFileSync(resolve(repoRoot, 'css/dashboard.css'), 'utf8');

test('generic modal-footer-actions wraps long desktop action rows', () => {
    const body = ruleBody(modalsCss, '.modal-footer-actions');
    assert.match(body, /display\s*:\s*flex/);
    assert.match(body, /justify-content\s*:\s*flex-end/);
    assert.match(body, /flex-wrap\s*:\s*wrap/);
});

test('modal title can wrap without pushing close button out of header', () => {
    const headerBody = ruleBody(modalsCss, '.modal-header');
    const titleBody = ruleBody(modalsCss, '.modal-title');
    const closeBody = ruleBody(modalsCss, '.modal-close');

    assert.match(headerBody, /gap\s*:\s*12px/);
    assert.match(titleBody, /min-width\s*:\s*0/);
    assert.match(titleBody, /overflow-wrap\s*:\s*anywhere/);
    assert.match(closeBody, /flex-shrink\s*:\s*0/);
});

test('Health and Budget modal custom footers also wrap on desktop', () => {
    const m = dashboardCss.match(/\.budget-modal-footer\s*,\s*\.health-modal-footer\s*\{([^}]+)\}/);
    assert.ok(m, 'combined .budget-modal-footer / .health-modal-footer rule must exist');
    const body = m[1];
    assert.match(body, /display\s*:\s*flex/);
    assert.match(body, /justify-content\s*:\s*flex-end/);
    assert.match(body, /flex-wrap\s*:\s*wrap/);
});

test('Cost Optimization Planner desktop footer and rollback row wrap safely', () => {
    const footerBody = ruleBody(dashboardCss, '.cop-modal-footer');
    const rollbackBody = ruleBody(dashboardCss, '.cop-rollback-text');
    const rollbackTextBody = ruleBody(dashboardCss, '.cop-rollback-text span:last-child');

    assert.match(footerBody, /display\s*:\s*flex/);
    assert.match(footerBody, /justify-content\s*:\s*flex-end/);
    assert.match(footerBody, /align-items\s*:\s*center/);
    assert.match(footerBody, /flex-wrap\s*:\s*wrap/);
    assert.match(rollbackBody, /flex\s*:\s*1\s+1\s+260px/);
    assert.match(rollbackBody, /min-width\s*:\s*0/);
    assert.match(rollbackTextBody, /overflow-wrap\s*:\s*anywhere/);
});

test('Cost Optimization Planner desktop grid controls can shrink inside 880px modal', () => {
    const levelTabBody = ruleBody(dashboardCss, '.cop-level-tab');
    const levelTitleBody = ruleBody(dashboardCss, '.cop-level-tab-title');
    const constraintBody = ruleBody(dashboardCss, '.cop-modal-constraint');
    const constraintLabelBody = ruleBody(dashboardCss, '.cop-modal-constraint-label');
    const summaryCardBody = ruleBody(dashboardCss, '.cop-summary-card');
    const summaryValueBody = ruleBody(dashboardCss, '.cop-summary-card-value');

    assert.match(levelTabBody, /min-width\s*:\s*0/);
    assert.match(levelTitleBody, /overflow-wrap\s*:\s*anywhere/);
    assert.match(constraintBody, /min-width\s*:\s*0/);
    assert.match(constraintLabelBody, /min-width\s*:\s*0/);
    assert.match(constraintLabelBody, /overflow-wrap\s*:\s*anywhere/);
    assert.match(summaryCardBody, /min-width\s*:\s*0/);
    assert.match(summaryValueBody, /overflow-wrap\s*:\s*anywhere/);
});

test('Cost Optimization Planner accordion headers preserve badges and long Russian labels', () => {
    const groupHeaderBody = ruleBody(dashboardCss, '.cop-lever-group-header');
    const groupTitleBody = ruleBody(dashboardCss, '.cop-lever-group-title');
    const groupMetaBody = ruleBody(dashboardCss, '.cop-lever-group-meta');
    const leverBody = ruleBody(dashboardCss, '.cop-lever');
    const leverHeadBody = ruleBody(dashboardCss, '.cop-lever-head');
    const leverTitleBody = ruleBody(dashboardCss, '.cop-lever-title');
    const riskBadgeBody = ruleBody(dashboardCss, '.cop-risk-badge');

    assert.match(groupHeaderBody, /min-width\s*:\s*0/);
    assert.match(groupTitleBody, /flex\s*:\s*1\s+1\s+auto/);
    assert.match(groupTitleBody, /min-width\s*:\s*0/);
    assert.match(groupTitleBody, /overflow-wrap\s*:\s*anywhere/);
    assert.match(groupMetaBody, /min-width\s*:\s*0/);
    assert.match(leverBody, /min-width\s*:\s*0/);
    assert.match(leverHeadBody, /align-items\s*:\s*flex-start/);
    assert.match(leverHeadBody, /min-width\s*:\s*0/);
    assert.match(leverTitleBody, /min-width\s*:\s*0/);
    assert.match(leverTitleBody, /overflow-wrap\s*:\s*anywhere/);
    assert.match(riskBadgeBody, /flex-shrink\s*:\s*0/);
});
