# Codex Status

## Current Stable Point

- Live version confirmed before this patch: v2.22.36.
- Current Codex patch: v2.22.37 / Package 9F-light.
- Scope: text-only clarification for `one-pentest-external` and
  `one-pentest-internal`.
- Budget drift: 0. Formulas, prices, units, `ekClass`, refresh lists and golden
  scenarios are unchanged.

## What Codex Is Doing Now

- Release v2.22.37 after green checks.
- Patch content in plain language: pentest descriptions now say that scope
  (`web/API/mobile`) and test level (`Black/Grey/White Box`) are clarified by
  КП.
- Tests already green before version bump:
  - full unit: 6066/6066 PASS;
  - desktop smoke: 60 passed;
  - sanity / quantity / prices / syntax / diff: EXIT 0.

## Claude Work

- Package 9G report received. By-design divergences are accepted unless new
  evidence appears: on-prem billable rows vs operational AI metrics, managed
  RAG vs self-hosted vector DB, embeddings as separate EK, `<500ms` reserve.
- Active Claude task now: Package 9H / RAG stale-flag defense-in-depth,
  analysis-only.
- Claude must not edit code, tests, docs, version files or golden files for 9H.
- Claude must write status to `CLAUDE_OUTBOX.md` at least every 10 minutes if
  the final report is not ready.
- If 9H is blocked by a domain decision, Claude continues safe read-only
  fallback work in the same AI/RAG/GPU scope instead of waiting silently.

## No-Idle Rule

- Codex keeps moving on safe non-overlapping work.
- Claude always has an active read-only task or a fallback task.
- If `CLAUDE_WATCHDOG.md` reports WARN/ALERT, Codex must either answer/reroute
  Claude or assign a safe fallback task in the next coordination pass.
