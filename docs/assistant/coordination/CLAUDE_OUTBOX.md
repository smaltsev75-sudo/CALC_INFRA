# Claude Outbox

Claude writes reports, blockers, and questions here.

## Latest Report

Task: Package 9D / Remaining Flat SECURITY & SERVICES Contours

Status: analysis-only (no code/test/doc/version/golden changes; live point v2.22.33)

Files touched: none. Read-only repro: `d:/tmp/9d-repro.mjs` (outside repo).

Commands run:
- `node d:/tmp/9d-repro.mjs` — EK qty + ₽/мес on a small (1k users) vs large (10M users) profile.
- Read-only: seed.js SECURITY/SERVICES EK defs; cross-check vs question impact text.

Inventory table — flag-fixed `if(flag,1,0)` contours (the flat set):
- `one-payment-gateway-integration` SERVICES/ONE_TIME oneTime 300000 [PROD] `if(Q.payment_gateway,1,0)`.
- `one-sso-integration` SERVICES/ONE_TIME oneTime 600000 [PROD] `if(Q.sso_required,1,0)`.
- `service-identity-provider` SERVICES/SERVICE monthly 50000 [PROD] `if(Q.sso_required,1,0)`.
- `one-antifraud-integration` SERVICES/ONE_TIME oneTime 700000 [PROD] `if(Q.antifraud_required,1,0)`.
- `service-antifraud-license` SERVICES/LICENSE annual 1000000 [PROD] `if(Q.antifraud_required,1,0)`.
- `one-edo-integration` SERVICES/ONE_TIME oneTime 600000 [PROD] `if(Q.edo_required,1,0)`.
- `service-edo-operator` SERVICES/SERVICE annual 50000 [PROD] `if(Q.edo_required,1,0)`.
- `one-fstec-certification` SECURITY/ONE_TIME oneTime 2500000 [PROD] `if(Q.fstec_certification_required,1,0)`.
- `one-source-code-audit` SECURITY/ONE_TIME oneTime 500000 [PROD] `if(Q.pdn_152fz||Q.iso_27001_required,1,0)`.
- `one-pentest-external` / `one-pentest-internal` SECURITY oneTime 600000 [PROD] `if(Q.pentest_*,1,0)`.
- `one-load-test-prelaunch` SERVICES oneTime 800000 [LOAD] `if(Q.load_test_before_prod,1,0)`.
(ekClass = flag-fixed for all above.)

Reproduction table (flags on; small=1k users / large=10M users, 5000 RPS, 5 DB):
- Every flat EK above returns qty=1 and IDENTICAL ₽/мес on small and large. Examples:
  service-edo-operator 8 778 ₽/мес (both); service-antifraud-license 175 550 ₽/мес (both);
  one-fstec-certification 504 707 ₽/мес amortized (both); one-source-code-audit 100 941 ₽/мес (both).
- Confirms: no scale term in any of these formulas — cost is invariant to users/transactions/docs/LOC.

Findings by severity:

1) Text-only honesty fix (LOW; drift 0) — terse descriptions missing the range/КП disclaimer that
   the comparable SSO/payment EKs already carry ("фиксированная медианная оценка … крупные … КП"):
   - `one-antifraud-integration` (700k): desc = bare "1 проект интеграции"; question impact gives the
     range 500–1500k. Add median/КП disclaimer.
   - `service-antifraud-license` (1M/year): bare "1 защищаемый контур в год"; question gives 1–5M/year.
   - `one-edo-integration` (600k): bare "1 проект интеграции".
   - `service-edo-operator` (50k/year): bare "1 контур в год"; ignores EDO per-document economics.
   These are honesty/consistency fixes only — no formula, no drift.

2) Opt-in scale-driver candidates (MEDIUM; real cost scales but needs a DOMAIN coefficient — I do NOT
   invent; recommend defer unless you supply coefficients + a new Q field):
   - `service-edo-operator` — strongest case. Real EDO is per-document (Диадок/СБИС ≈ 5–25 ₽/doc); flat
     50k/year is a weak proxy that can undercount high-volume B2B by 10–100×. Needs docs/year + ₽/doc.
   - `service-antifraud-license` — antifraud SaaS scales with transaction/operation volume; flat 1M/year
     undercounts high-volume fintech. Needs transactions/month or vendor tier.
   - `one-fstec-certification` — cost scales with protection class (КИИ K1/K2/K3, ГИС class); flat 2.5M.
     Needs a cert-class Q + class multipliers.
   - `one-source-code-audit` — cost scales with LOC; flat 500k. Needs a LOC/size Q + tiers.
   (All four descriptions already say "зависит от … получите КП", so the text is honest; the gap is
   model granularity, which is a deliberate domain choice.)

3) Defensible flat (no change): `one-payment-gateway-integration` (6C text-stabilized),
   `one-sso-integration` + `service-identity-provider` (already carry the median/КП disclaimer),
   `one-pentest-external/internal`, `one-load-test-prelaunch` — fixed project/engagement medians from a
   cited market source (BI.ZONE); a pentest/load-test is a per-engagement unit, not volume-scaled.
   No false positives — gates verified (qty 0 when flag off).

Already covered / excluded (listed, NOT reworked):
- Count-driven (already scaled): `one-pentest-regular` (pentest_per_year), `one-load-test-regular`
  (load_test_per_year), `one-security-audit` (security_audit_per_year), `one-deployment` (mln₽ override),
  `one-staff-training` (staff_training_cycles), `one-schedule-acceleration` (tolerance).
- Recently guarded/scaled: WAF (waf_domains), DDoS (ddos_tier), SIEM (sources + log_gb/tier), DLP
  (channels), audit-log (events), email/SMS/push (7A LOAD-cap), traffic egress/ingress, payment/SSO text
  (6C), DR (5A), OS/DB license, storage no-payload floors, Managed RAG.

Recommended next mini-package: a small **9E text-only honesty pass** — add the median-of-range + "КП for
your volume" disclaimer to the 4 terse antifraud/EDO descriptions (matches SSO/payment precedent).
Drift 0, no coefficients, low risk. The four scale-driver candidates → keep DEFERRED as a separate
opt-in-driver package (model like SIEM/DLP scaling) ONLY if you decide to model them; each needs a domain
decision + new Q field + coefficients I will not invent.

Drift/golden impact: 0 for 9E text-only. Scale-driver options are opt-in (zero drift unless the new
driver is set); exact drift deferred until coefficients are chosen.

Refresh-list impact:
- Text-only honesty fix changes only `description` — NOT propagated by `_AGENT_FORMULA_REFRESH_IDS`
  (that refreshes qtyFormulas/applicableStands, not descriptions); legacy calcs keep old description text
  (cosmetic, shown in Passport/tooltip). No action needed.
- None of these 8 flat EKs are in `_AGENT_FORMULA_REFRESH_IDS` today (correct — never had formula churn).
  IF a scale driver is later added (e.g. service-edo-operator), that EK must be added to
  `_AGENT_FORMULA_REFRESH_IDS`; a unit change (annual contour → per-document) would also need
  `_AGENT_UNIT_PRICE_REFRESH_IDS`.

Questions for Codex/user:
1. Approve a 9E text-only honesty pass for the 4 terse antifraud/EDO descriptions (drift 0)?
2. Do you want any of the 4 scale-driver candidates modeled as opt-in drivers? Each needs a domain
   decision + new Q + coefficients (I will not invent). If yes, which, and supply the coefficients/КП.

Next recommended step: Codex verify the inventory + repro (flat cost invariant to scale), then decide
9E text-only vs defer. No implementation or release now (analysis-only).
