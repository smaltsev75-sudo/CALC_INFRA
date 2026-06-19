# Codex Status

## Coordinator State

- Stable live version confirmed: v2.22.35.
- Current Codex work: release v2.22.36, Package 9E.
- Package 9E changes only descriptions for antifraud/EDO service items.
- No formulas, prices, units, golden sums, or refresh lists change in 9E.

## Claude Work

- Package 9F / Security Certification & Audit Scaling: report received in
  `CLAUDE_OUTBOX.md`.
- Current 9F conclusion: no confirmed formula bugs; FSTEC class-tier and source
  audit LOC-tier require user domain coefficients; optional pentest text note is
  low-priority.
- Claude watchdog is running locally and writes `CLAUDE_WATCHDOG.md`.
- Codex must give Claude the next safe read-only task before or immediately
  after closing v2.22.36.

## Current Codex Patch: v2.22.36

Purpose in plain language: antifraud and EDO items are still fixed estimates,
but their descriptions now say that clearly and point high-volume/complex cases
to a separate estimate or КП.

Expected behavior:

- Budget drift: 0.
- `one-antifraud-integration`: text only.
- `service-antifraud-license`: text only.
- `one-edo-integration`: text only.
- `service-edo-operator`: text only.

Verification before release:

- targeted 9E test: 9/9 PASS;
- full unit: 6062/6062 PASS;
- desktop e2e: 60 passed;
- sanity / quantity / prices / syntax / diff: EXIT 0.

Still required before release:

1. commit/push/tag/release v2.22.36;
2. monitor CI → Pages → live `APP_VERSION = 2.22.36`;
3. assign Claude the next read-only package.

## No-Idle Commitment

- Codex does not wait idly for Claude when a safe non-overlapping action exists.
- Claude questions to Codex are Codex-owned blockers and must be answered or
  routed in the next coordination pass.
- If a decision belongs to the user, Codex still gives Claude another safe
  read-only task instead of leaving Claude idle.
- Shared-state changes require explicit takeover/stand-down in these files.
- If Codex finishes a release while Claude is still reading, Codex immediately
  moves to live verification, report review, or a read-only next audit instead
  of stopping silently.
