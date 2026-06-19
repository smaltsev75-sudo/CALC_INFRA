# Claude Inbox

## Active Task: Package 9A / CPU Dedicated Semantics — TDD Implementation

Mode: Codex takeover in progress. Claude must stand down from editing
`js/domain/seed.js`, `tests/unit/domain/cpu-dedicated-replacement-9a.test.js`,
`tests/unit/architecture/cpu-base-single-source.test.js`,
`tests/unit/domain/quantity-trace.test.js`, and golden/sanity artifacts until
Codex posts a WIP report. Claude's next role is review/verification after Codex
reports.

Do not release, push, tag, or bump version.

Live stable point for this task: v2.22.32.

Codex decision after independent verification:

- Use **replacement semantics** for `cpu-vcpu-dedicated`.
- `cpu-vcpu-dedicated` replaces the shared RPS overage above 100 RPS on the stands where dedicated exists.
- Keep RAM sized from the original full CPU load; do not let the shared CPU cap reduce `ram-gb`.
- Cap shared RPS only on `PSI`, `PROD`, and `LOAD`.
- Do not add a new user opt-in gate in this package; keep automatic `peak_rps > 100` behavior.

Implementation target:

1. In `js/domain/seed.js`, split CPU base constants so:
   - `ram-gb` continues to use the current full `CPU_BASE_VCPU`.
   - `cpu-vcpu-shared` uses a capped shared base only on `PSI`/`PROD`/`LOAD`, where the simple RPS term is `min(Q.peak_rps, 100) / 50`.
   - `DEV` and `IFT` shared formulas stay on the full base because `cpu-vcpu-dedicated` does not apply there.
   - advanced CPU model behavior must be considered explicitly. If capping advanced mode needs a formula choice, stop and report before implementing that part.
2. Leave `cpu-vcpu-dedicated` formula itself unchanged unless a test proves it must change.
3. Add `cpu-vcpu-dedicated` to `_AGENT_FORMULA_REFRESH_IDS` if any CPU formula semantics change, so legacy/imported calculations refresh consistently.
4. Update `description`/`formulaHelp` for `cpu-vcpu-shared` and/or `cpu-vcpu-dedicated` to state the split:
   - shared covers baseline/general CPU;
   - dedicated covers the RPS overage above 100 on PSI/PROD/LOAD;
   - RAM remains sized from total CPU load.
5. Add TDD tests:
   - RPS-dominated `peak_rps=200` case: PROD shared decreases by 1, dedicated remains 2, RAM unchanged.
   - `DEV`/`IFT` shared remain unchanged for the same case.
   - PCU-dominated case: shared unchanged, dedicated unchanged.
   - `peak_rps <= 100`: no change.
   - `_AGENT_FORMULA_REFRESH_IDS` contains `cpu-vcpu-dedicated`.
   - Legacy enrichment refreshes the changed formula(s).
6. Confirm expected drift before release report:
   - Quick Start approximate model drift from Codex verification:
     - `smb_b2b_m`: about `-3689` RUB/month.
     - `fintech_b2b_m`: about `-8534` RUB/month.
     - `b2g_m_ru_cis`: about `-7375` RUB/month.
     - high PCU-dominated scenarios: `0`.
   - Recompute exact golden values after implementation and report them.

Required checks before reporting:

- Targeted 9A tests.
- Full unit.
- `npm run sanity:check`
- `npm run quantity:audit:check`
- `npm run prices:freshness:check`
- `npm run syntax-check`
- `git diff --check`
- Desktop e2e smoke if any rendered text/layout changed enough to affect UI; otherwise explain why skipped.

Report to `CLAUDE_OUTBOX.md` with files touched, commands, drift table, and release recommendation.

## Coordinator Feedback While Task Is Active

Codex ran a read-only targeted check against the current WIP:

`npm test -- tests/unit/domain/cpu-dedicated-replacement-9a.test.js`

Result: 6/7 PASS, 1 FAIL.

Failing acceptance:

- `legacy enrichment refreshes cpu-vcpu-dedicated formula (it is in the refresh list)`

Observed diff: enriched legacy item kept `{ PROD: '0' }` instead of the current
`PSI`/`PROD`/`LOAD` dedicated formulas. This means the implementation still
needs to add `cpu-vcpu-dedicated` to `_AGENT_FORMULA_REFRESH_IDS` (or otherwise
make the legacy refresh contract pass). Please fix this before reporting GREEN.

Second Codex read-only check after refresh-list fix:

`npm test -- tests/unit/domain/cpu-dedicated-replacement-9a.test.js`

Result: 7/7 PASS.

Full suite check:

`npm test`

Result: 6033/6039 PASS, 6 FAIL. Remaining collateral to finish before reporting:

1. `tests/unit/architecture/cpu-base-single-source.test.js`
   - Old invariant assumes `cpu-vcpu-shared` and `ram-gb` always use the same
     literal CPU base.
   - 9A intentionally splits `cpu-vcpu-shared` into full base on DEV/IFT and
     capped base on PSI/PROD/LOAD, while `ram-gb` stays full base.
   - Update the invariant to protect the new contract instead of the old one.
2. `tests/unit/domain/golden-scenarios.test.js`
   - Expected 9A drift must be regenerated/updated:
     - `smb_b2b_m`: `3279676 -> 3275987` (`-3689`)
     - `fintech_b2b_m`: `11218834 -> 11210300` (`-8534`)
     - `b2g_m_ru_cis`: `6072505 -> 6065130` (`-7375`)
3. `tests/unit/domain/quantity-trace.test.js`
   - `cpu-vcpu-shared/PROD` expected qty changed `18 -> 17`; update the
     assertion and verify trace explains the capped shared base.

Do not treat these as unexpected blockers; they are the required collateral for
the approved 9A model. After updating, rerun full unit and the standard gates.

Third coordinator decision: advanced CPU mode must use the same replacement
semantics, not keep the old double-count behind an opt-in flag.

Reason: current WIP comment says `cpu_advanced_model` is not capped, while
`cpu-vcpu-dedicated` still adds overage above 100. That means advanced-mode
calculations still pay full RPS load in `cpu-vcpu-shared` plus dedicated overage.
This contradicts the approved replacement model.

Implementation decision:

- In shared capped base on `PSI`/`PROD`/`LOAD`:
  - simple mode: `min(Q.peak_rps, 100) / 50`
  - advanced mode: `min(Q.peak_rps, 100) * Q.cpu_ms_per_request / 1000 / (clamp(Q.cpu_target_utilization_percent, 10, 90) / 100)`
- In `cpu-vcpu-dedicated` overage formulas:
  - simple mode: `max(0, Q.peak_rps - 100) / 50`
  - advanced mode: `max(0, Q.peak_rps - 100) * Q.cpu_ms_per_request / 1000 / (clamp(Q.cpu_target_utilization_percent, 10, 90) / 100)`
- Keep DEV/IFT shared on the full base.
- Keep `ram-gb` on the full uncapped CPU base.

Add tests:

- advanced `peak_rps=200`, `cpu_ms_per_request=50`, `target_util=50`:
  shared PROD should be `10`, dedicated PROD should be `10`, sum `20`, matching
  full advanced RPS CPU (`200 * 50ms / 1000 / 0.5 = 20`) with no double-count.
- advanced `peak_rps<=100`: dedicated zero, shared equals full advanced base.
- PCU-dominated advanced case remains dominated by PCU after the cap if PCU is
  larger than capped RPS CPU.

This is a coordinator decision, not a new user question. If you find a formula
parser limitation that prevents this expression, report immediately; otherwise
implement and include the advanced-mode drift note (default/golden should remain
unchanged unless scenarios enable advanced CPU).

Follow-up read-only check:

- `tests/unit/domain/cpu-dedicated-replacement-9a.test.js` still states
  "Advanced CPU model ... intentionally NOT capped here".
- `js/domain/seed.js` still says advanced mode is not capped and
  `CPU_BASE_VCPU_SHARED_CAPPED` keeps the full advanced RPS term.

Do not report Package 9A as complete in this state. Update formulaHelp/comments
and tests to the advanced replacement contract above, then rerun targeted/full.

## Completed Handoff: Package 8B-light / DB License Edition Text Cleanup

Released as v2.22.32. No further action.

## Queued Task

To be assigned after Package 9A implementation and Codex review.
