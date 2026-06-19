# Codex Status

## Coordinator State

- Stable live version confirmed: v2.22.33.
- Current Codex work: release v2.22.34, a small migration hardening patch for
  corrupt saved `settings.aiStandFactor` values.
- No production EK formulas or prices are changed in v2.22.34.
- GitHub CI/Pages for v2.22.33 were green and live checks confirmed
  `APP_VERSION = 2.22.33`.

## Claude Work

- Package 9B / AI Service Contours: completed as formula false-positive.
  Runtime uses `aiStandFactor`, and valid UI/import values cannot make AI LOAD
  exceed PROD.
- Package 9C / `storage-secure-gb`: report received. Codex must independently
  verify before any decision. Main domain question: protected storage as raw
  PDn/encrypted footprint vs full DB footprint with indexes/WAL/replicas.
- Active Claude task now: Package 9D / Remaining Flat SECURITY & SERVICES
  Contours, analysis-only. No code edits.

## Current Codex Patch: v2.22.34

Purpose in plain language: if an old/manual saved calculation contains invalid
AI stand percentages, clamp them when the calculation is opened.

Expected behavior:

- Valid calculations: no budget change.
- Corrupt saved values above 100% or below 0%: normalized into 0..100%.
- PROD AI factor: always restored to 100%.

Verification already run before bump:

- targeted migration tests: 33/33 PASS;
- full unit: 6048/6048 PASS;
- sanity / quantity / prices / syntax / diff: EXIT 0.

Still required before release:

1. bump to 2.22.34;
2. rerun full release gates after bump;
3. commit/push/tag/release;
4. monitor CI → Pages → live `APP_VERSION = 2.22.34`.

## No-Idle Commitment

- Codex does not wait idly for Claude when a safe non-overlapping action exists.
- Claude questions to Codex are Codex-owned blockers and must be answered or
  routed in the next coordination pass.
- If a decision belongs to the user, Codex still gives Claude another safe
  read-only task instead of leaving Claude idle.
- Shared-state changes require explicit takeover/stand-down in these files.
