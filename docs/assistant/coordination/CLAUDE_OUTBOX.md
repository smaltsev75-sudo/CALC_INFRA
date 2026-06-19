# Claude Outbox

Claude writes reports, blockers, and questions here.

## Latest Report

Task: Package 9A / CPU Dedicated Semantics — TDD Implementation (replacement, incl. advanced-mode per coordinator decision)

Status: WIP — near-GREEN, blocked on a shared-file ownership question (see below). Not releasing.

Files touched by me (Claude):
- `js/domain/seed.js` — initial simple-mode cap (CPU_BASE_VCPU_SHARED_CAPPED), cpu-vcpu-shared
  PSI/PROD/LOAD → capped base (DEV/IFT + ram-gb full), added `cpu-vcpu-dedicated` to
  `_AGENT_FORMULA_REFRESH_IDS`, updated descriptions/formulaHelp.
- `tests/unit/architecture/cpu-base-single-source.test.js` — rewrote invariant for the split.
- `tests/unit/domain/cpu-dedicated-replacement-9a.test.js` — NEW (created RED, now GREEN).

Shared-file collision (IMPORTANT — please clarify ownership):
- After my edits, `js/domain/seed.js` was modified again by another actor (not me): the CPU base was
  refactored into extracted constants `CPU_RPS_FULL` / `CPU_RPS_CAPPED_100` / `CPU_RPS_OVERAGE_100`
  (simple+advanced), and `CPU_BASE_VCPU_SHARED_CAPPED` + `cpu-vcpu-dedicated` now implement the
  advanced-mode replacement EXACTLY as the coordinator decision specified.
- `cpu-base-single-source.test.js` and `quantity-trace.test.js` were also updated by another actor
  (advanced-aware invariant; qty 18→17).
- My two follow-up seed.js edits (to add the advanced cap myself) failed with "file modified since
  read" — the harness stopped me before any clobber. I did NOT overwrite anything.
- CODEX_STATUS.md states "Codex does not touch seed.js while Claude owns Package 9A", yet seed.js
  changed. Per anti-clobber rules I stopped and am surfacing this instead of racing. Who owns the
  seed.js implementation finish now — me or the other actor?

Commands run (read-only, current tree after the parallel edits):
- `node tests/run.js` (full unit) → tests 6043 / pass 6040 / fail 3, EXIT 1.
- The 3 failures are ONLY the golden snapshots (smb_b2b_m, fintech_b2b_m, b2g_m_ru_cis).
- The 9A test (incl. the advanced tests added by the other actor), the rewritten
  cpu-base-single-source invariant, and quantity-trace ALL PASS. Implementation is correct.

Drift/golden impact (independently regenerated via GOLDEN_REGEN=1 — verified against Codex's expected):
- smb_b2b_m:     3_279_676 → 3_275_987  (−3_689). HW 354_790 → 351_102. RESERVES 0. annual 39_311_849.
- fintech_b2b_m: 11_218_834 → 11_210_300 (−8_534). HW 846_629 → 842_941 (−3_688) + RESERVES 789_415 → 784_570 (−4_845). annual 134_523_603.
- b2g_m_ru_cis:  6_072_505 → 6_065_130  (−7_375). HW 354_790 → 351_102 (−3_688) + RESERVES 62_320 → 58_634 (−3_686). annual 72_781_561.
- All other golden (incl. PCU-dominated AI scenarios) and ALL 6 business golden: 0 drift.

KEY FINDING (not obvious — flagging): the drift for fintech/b2g is NOT only HW. Capping shared PROD
vCPU lowers `S.prodComputeVcpu`, which the DR post-pass uses to size reserves — so RESERVES cascade
DOWN too (−4_845 / −3_686). smb has no DR → HW-only. This is the correct consequence of the fix (the
reserve was previously oversized on the double-counted PROD CPU), and it makes the totals match
Codex's expected drift exactly (−3_689 / −8_534 / −7_375).

The ONLY remaining collateral = the 3 golden snapshots (not yet updated; still the 3 failures). I have
NOT edited `tests/unit/domain/golden-scenarios.test.js` to avoid clobbering the other actor.

Questions for Codex:
1. Ownership: should I apply the 3 golden snapshot updates (values above are ready), or is the other
   actor finishing them? I will apply immediately on your confirmation — no clobber meanwhile.
2. seed.js: confirm the refactored advanced implementation is the intended final form (it passes all
   targeted tests + invariant); I will not touch it further unless asked.

Next recommended step: Codex confirms golden ownership. On "go" I apply the 3 snapshots, then run all
gates (sanity:check / quantity:audit:check / prices:freshness:check / syntax-check / git diff --check)
and report the final GREEN + drift table for release go/no-go (release is coordinator-only).
