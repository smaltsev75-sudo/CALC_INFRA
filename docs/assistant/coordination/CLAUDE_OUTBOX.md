# Claude Outbox

Claude writes reports, blockers, and questions here.

## Latest Report

Task: Package 9F / Security Certification & Audit Scaling

Status: analysis-only (no code/test/doc/version/golden changes; live point v2.22.35)

Files touched: none. Read-only repro: `d:/tmp/9f-repro.mjs` (outside repo).

Commands run:
- `node d:/tmp/9f-repro.mjs` — qty + ₽/мес for each EK on count=1 vs count=3 profiles.
- Read-only: seed.js SECURITY cert/audit EK defs + `security-pdn-category-hardening`.

Inventory table (SECURITY cert/audit EKs):
- `one-fstec-certification` SECURITY/ONE_TIME oneTime 2500000 [PROD] flag-fixed `if(Q.fstec_certification_required,1,0)`.
- `one-source-code-audit` SECURITY/ONE_TIME oneTime 500000 [PROD] flag-fixed `if(Q.pdn_152fz||Q.iso_27001_required,1,0)`.
- `one-pentest-external` SECURITY/ONE_TIME oneTime 600000 [PROD] flag-fixed `if(Q.pentest_external,1,0)`.
- `one-pentest-internal` SECURITY/ONE_TIME oneTime 600000 [PROD] flag-fixed `if(Q.pentest_internal,1,0)`.
- `one-pentest-regular` SECURITY/ONE_TIME annual 350000 [PROD] count-driven `Q.pentest_per_year`.
- `one-security-audit` SECURITY/ONE_TIME annual 450000 [PROD] count-driven `if(Q.iso_27001_required||Q.pdn_152fz, Q.security_audit_per_year, 0)`.
- Related: `security-pdn-category-hardening` SECURITY/SERVICE monthly 50000 [PROD] class-driven
  `if(Q.pdn_152fz, if(pdn_category=="1",3, "2"→2, "3"→1, else 0), 0)`.

Reproduction table (flags on; P1 counts=1, P2 counts=3):
- one-pentest-regular: qty 1→3, 61 443 → 184 328 ₽/мес → SCALES by count. ✓
- one-security-audit:  qty 1→3, 78 998 → 236 993 ₽/мес → SCALES by count. ✓
- one-fstec-certification: qty 1 (both), 504 707 ₽/мес flat → does NOT scale (class promised in text).
- one-source-code-audit:  qty 1 (both), 100 941 ₽/мес flat → does NOT scale (LOC promised in text).
- one-pentest-external / -internal: qty 1, 121 130 ₽/мес flat → per-engagement (no scale promised).
- security-pdn-category-hardening: my repro showed 0 — HONEST NOTE: I passed `pdn_category:"K1/K2"` but
  the formula expects `"1"/"2"/"3"`, so it returned 0. By formula inspection it DOES scale 3/2/1 by ПДн
  category; not a defect — it is the existing class-tier precedent. (Repro mis-encoded the value, EK is fine.)

Findings by severity:

1) Opt-in scale-driver candidates (MEDIUM; description promises scaling the formula does not implement;
   DEFER — needs a new Q field + domain coefficients I will NOT invent):
   - `one-fstec-certification` — description: "Стоимость зависит от класса защищённости, регулятора
     (ФСТЭК/ФСБ)". Real FSTEC cost scales with protection class (КИИ значимость К1/К2/К3; ГИС класс;
     АСУ ТП). Formula is flat 2.5M regardless. The codebase ALREADY has a class-tier precedent
     (`security-pdn-category-hardening` = 3/2/1 by ПДн category), so a class multiplier is design-consistent.
     Needs: a cert-class Q (e.g. `fstec_class` К1/К2/К3) + per-class multipliers (domain/КП).
   - `one-source-code-audit` — description: "Стоимость зависит от объёма кода (LOC)…". Real SAST/DAST
     scales with LOC / number of repositories. Formula is flat 500k. Needs: a codebase-size Q
     (LOC or repo count) + tier breakpoints + multipliers (domain/КП). Precedent: SIEM log_gb tiers, DLP channels.

2) Text-only honesty (LOW; optional; drift 0):
   - `one-pentest-external` / `one-pentest-internal` carry only a generic "уточняйте по тарифу"; the sibling
     `one-pentest-regular` already discloses "зависит от scope (web/api/mobile), уровня (Black/Grey/White Box)".
     Adding the same scope/level note to external/internal would be consistent. Not required.

3) Confirmed formula bugs: NONE.

No-change items (defensible as-is):
- `one-pentest-external`, `one-pentest-internal` — fixed per-engagement medians (cited BI.ZONE market);
  a pentest is a per-engagement unit, scope is a КП detail.
- `one-pentest-regular`, `one-security-audit` — already scale by an explicit frequency count question
  (pentest_per_year / security_audit_per_year); honest text on scope/standard → КП.
- `security-pdn-category-hardening` — already class-driven (3/2/1 by ПДн category); the precedent, not a finding.

Recommended next mini-package: NONE requiring code now. Both opt-in drivers (FSTEC class-tier,
source-audit LOC-tier) are DEFERRED pending user domain coefficients. If the user supplies them, model
each as an opt-in tier driver (pattern: pdn-category-hardening / SIEM / DLP). The optional pentest
external/internal scope-text note could fold into the in-progress 9E text pass if desired.

Required domain decisions/coefs (must come from user/КП — not invented):
- FSTEC: which class taxonomy to use (КИИ К1/К2/К3 vs ГИС class), the gating Q, and base×class multipliers.
- Source-code audit: LOC/repo-size tiers (breakpoints) and per-tier multipliers (or ₽/100k LOC).

Refresh-list impact: none now (no formula change). If a driver is later added, that EK must be added to
`_AGENT_FORMULA_REFRESH_IDS` (none of these are currently in it). Applying a multiplier to qty keeps unit
(`мероприятие`) and base price intact → no `_AGENT_UNIT_PRICE_REFRESH_IDS`. (Only a unit-semantics change
would need it.)

Questions for Codex/user:
1. Model FSTEC certification as an opt-in class-tier driver? If yes, user must supply the class taxonomy
   + multipliers (I will not invent them).
2. Model source-code audit as an opt-in LOC/repo-tier driver? If yes, user must supply tier breakpoints
   + multipliers.
3. Optional: fold the pentest external/internal scope-text note into 9E, or skip?

Next recommended step: Codex verify the inventory + repro (count-scaling vs flat; pdn-hardening already
class-scaled). No formula bug → no required change. Both scale candidates await a user domain decision.
No implementation or release now (analysis-only).
