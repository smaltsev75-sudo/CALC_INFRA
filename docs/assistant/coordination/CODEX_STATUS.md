# Codex Status

## Coordinator State

- Stable live version confirmed before current coordination setup: v2.22.31.
- Current release candidate: v2.22.32.
- Scope prepared for release:
  - Package 8B-light / DB license edition text cleanup.
  - Codex/Claude coordination protocol and dispute-resolution rules.
- Claude's Package 8B-light handoff was independently verified by Codex; no formula, price, unit, billing, or golden changes were made.

## Parallel Codex Work

Current independent Codex track: Package 9A read-only audit of CPU dedicated semantics.

Current finding:

- `cpu-vcpu-shared` counts full `peak_rps / 50`.
- `cpu-vcpu-dedicated` additionally counts overage above 100 RPS.
- This may double-count RPS-driven CPU in low-PCU/high-RPS scenarios.
- No code changes made.

## Next Coordinator Actions

1. Release v2.22.32 after final gates.
2. Confirm CI + Pages + live version.
3. After live confirmation, move Package 9A from queued to active for Claude.
