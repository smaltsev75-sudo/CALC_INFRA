# Claude Inbox

## Active Task: Hold Until v2.22.32 Live

Codex is packaging Package 8B-light and the coordination protocol as release candidate v2.22.32.

Do not edit project files until Codex confirms that v2.22.32 is live or explicitly moves the next package to Active.

## Completed Handoff: Package 8B-light / DB License Edition Text Cleanup

Mode: implementation, text/doc-only, no formula or price changes.

Context:

- Live stable point before this task: v2.22.31.
- `license-db-per-vcpu` formula/gate/8A parameter are correct.
- Issue is semantic/doc drift around DB license editions and provider overlay.

Scope:

1. `docs/assistant/WIZARD_PROFILES.md` provider-overlay section:
   - Update runtime facts:
     - Cloud.ru/sbercloud overlay has 16 SKU and no DB-license SKU, so DB license falls back to seed.
     - Yandex overlay has 15 SKU and no DB-license SKU, so DB license falls back to seed.
     - VK overlay has 10 SKU and includes `license-db-per-vcpu` as MS SQL Enterprise, `598214.75` RUB/vCPU/year net.
   - Fix license units:
     - DB = RUB/vCPU/year.
     - OS/SIEM = RUB/node/year.
   - Remove the incorrect statement/table row implying `license-db-per-vcpu | 167 000 RUB/month` inside sbercloud overlay.

2. `js/domain/seed.js` text for `license-db-per-vcpu`:
   - Clarify seed baseline = Tantor SE `167000` RUB/vCPU/year.
   - Postgres Pro Enterprise / Oracle / MS SQL Enterprise are higher and require provider overlay, price import, or commercial quote.
   - Do not change formula, `pricePerUnit`, `billingInterval`, `unit`, gates, applicable stands, refresh lists.

3. Add/keep a doc guard:
   - Prevent `license-db-per-vcpu` from appearing with `167 000 RUB/month` again.
   - Prefer a focused architecture/doc test.

Required checks before reporting:

- Targeted doc guard.
- Full unit.
- `npm run sanity:check`
- `npm run quantity:audit:check`
- `npm run prices:freshness:check`
- `npm run syntax-check`
- `git diff --check`

Do not release. Report to `CLAUDE_OUTBOX.md`.

## Queued Task: Package 9A / CPU Dedicated Semantics

Mode: analysis-only. Do not start until Codex moves this to Active.

Question:

- Does `cpu-vcpu-dedicated` replace shared overage after 100 RPS, or is it a premium surcharge/reserve?

Known facts from Codex read-only repro:

- Current simple CPU base uses full `peak_rps / 50`.
- Dedicated formula adds `max(0, peak_rps - 100) / 50`.
- Example with low PCU:
  - `peak_rps=300` -> shared `6`, dedicated `4`, total CPU `10`.
  - Dedicated description says `300 RPS -> about 4 dedicated vCPU`.
- Potential model `cap shared RPS component at 100 + dedicated overage` has small but real Quick Start drift:
  - `smb_b2b_m`: about `-8185` RUB/month.
  - `fintech_b2b_m`: about `-19022` RUB/month.
  - `b2g_m_ru_cis`: about `-11871` RUB/month.
  - Business golden profiles observed `0` drift.

Expected analysis when activated:

- Verify facts independently from code and repro.
- Decide whether this is:
  - A: formula bug, dedicated replaces shared overage;
  - B: text/model semantics issue, dedicated is premium surcharge;
  - C: keep formula and clarify description.
- Include legacy refresh requirements. If formulas change, `cpu-vcpu-dedicated` likely needs `_AGENT_FORMULA_REFRESH_IDS`.
- No code changes during analysis.
