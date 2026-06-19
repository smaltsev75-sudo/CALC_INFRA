# Codex Status

## Coordinator State

- Stable live version confirmed: v2.22.34.
- Current Codex work: release v2.22.35, Package 9C-A.
- Package 9C-A changes only `storage-secure-gb` on LOAD: НТ no longer buys more
  protected storage than PROD.
- Full SSD parity for protected storage (indexes/WAL/replicas) is deferred to
  Package 9C-B because it needs a domain decision.

## Claude Work

- Active Claude task now: Package 9D / Remaining Flat SECURITY & SERVICES
  Contours, analysis-only. No code edits.
- Claude must write facts and recommendations to `CLAUDE_OUTBOX.md`.
- Codex will verify each actionable finding before implementation or release.

## Current Codex Patch: v2.22.35

Purpose in plain language: if protected storage is required, the load-test stand
must not exceed the production protected footprint just because LOAD ratio is
120%.

Expected behavior:

- `storage-secure-gb` PROD: unchanged.
- `storage-secure-gb` PSI: unchanged.
- `storage-secure-gb` LOAD: capped at PROD multiplier (`min(LOAD ratio, 1)`).
- Known drift: only SECURITY/LOAD in scenarios that already had protected
  storage.

Verification before bump:

- full unit: 6053/6053 PASS;
- desktop e2e: 60 passed;
- sanity / quantity / prices / syntax / diff: EXIT 0.

Still required before release:

1. bump to 2.22.35;
2. rerun full release gates after bump;
3. commit/push/tag/release;
4. monitor CI → Pages → live `APP_VERSION = 2.22.35`.

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
