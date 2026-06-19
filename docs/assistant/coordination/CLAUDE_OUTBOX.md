# Claude Outbox

Claude writes reports, blockers, and questions here.

## Latest Report

Task: Package 8B-light / DB License Edition Text Cleanup (text/doc-only, no formula/price change)

Status: WIP-ready

Files touched:
- `docs/assistant/WIZARD_PROFILES.md` (M) — §13.6 provider-overlay rewritten.
- `js/domain/seed.js` (M) — `license-db-per-vcpu` description block only.
- `tests/unit/architecture/db-license-doc-guard-8b.test.js` (NEW, untracked) — 8-check doc guard.

Commands run (fresh, after all edits):
- `node --test tests/unit/architecture/db-license-doc-guard-8b.test.js` -> 8/8 pass, fail 0, EXIT 0.
- `node tests/run.js` (full unit) -> tests 6028 / pass 6028 / fail 0, EXIT 0.
- `npm run sanity:check` -> EXIT 0.
- `npm run quantity:audit:check` -> EXIT 0.
- `npm run prices:freshness:check` -> EXIT 0.
- `npm run syntax-check` -> EXIT 0.
- `git diff --check` -> EXIT 0.

Findings:
- WIZARD §13.6 was stale beyond the DB row: the whole "14 ЭК / cloud.ru/services 2026-Q2"
  provider table was outdated. Rewrote it to point at
  `js/data/providers-bundled.generated.js` as source of truth (prevents future per-SKU drift).
- Runtime facts now documented: Cloud.ru/`sbercloud` = 16 SKU (no DB-license SKU -> seed
  Tantor SE fallback); Yandex/`yandex` = 15 SKU (no DB-license SKU -> seed fallback);
  VK/`vk` = 10 SKU, `license-db-per-vcpu` = MS SQL Enterprise 598 214.75 RUB/vCPU/year net
  (gross 729 822). License units fixed: DB = RUB/vCPU/year, OS/SIEM = RUB/node/year.
  Removed the incorrect `license-db-per-vcpu | 167 000 RUB/month` row.
- seed.js `license-db-per-vcpu` description: clarified seed baseline = Tantor SE
  167000 RUB/vCPU/year; Postgres Pro Enterprise / Oracle / MS SQL Enterprise are higher and
  require provider overlay / price import / commercial quote. Formula, pricePerUnit,
  billingInterval, unit, gate, applicableStands, refresh lists NOT changed.

Drift/golden impact: 0. Both golden suites (business-golden + Quick Start) are inside the
6028 full-unit pass with no regen; the doc-guard asserts the invariant (pricePerUnit 167000,
unit vCPU, billing annual, formula reads `Q.db_license_vcpu_per_node`).

Questions for Codex/user:
- e2e (`npm run smoke:desktop`) NOT run. Per the active-task scope it is optional for strict
  docs/text with no UI behavior change. The seed description text does render in the ЭК
  Passport/tooltip, but layout/behavior is unchanged. Decide whether to gate release on a
  smoke run.
- Backlog (NOT this task): the queued Package 8B tier-model (DB edition selector) still needs
  domain RUB/vCPU/year for Postgres Pro Enterprise and Oracle (MS SQL already has VK 598214.75).

Next recommended step: Codex independently verifies the diff + the 7 commands above, then makes
the release go/no-go for 8B-light (next PATCH, likely 2.22.32). I do not bump/commit/release
(coordinator-only per README).
