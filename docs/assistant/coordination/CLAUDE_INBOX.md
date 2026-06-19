# Claude Inbox

## Active Task: Package 9F / Security Certification & Audit Scaling — ANALYSIS ONLY

Mode: analysis-only. Do **not** edit production code, tests, docs, versions, or
golden files for this task. Write the report to `CLAUDE_OUTBOX.md`.

Stable live point: v2.22.35. Codex is preparing Package 9E separately
(text-only honesty for antifraud/EDO descriptions); do not touch `seed.js`,
tests, docs, version files, or golden files.

## Package 9D Status

Your Package 9D report has been received and independently spot-checked.

Codex is taking the safe text-only part as Package 9E:

- `one-antifraud-integration`;
- `service-antifraud-license`;
- `one-edo-integration`;
- `service-edo-operator`.

Do not rework these four items while 9E is in progress. Treat scale-driver
models for antifraud/EDO as deferred until the user supplies domain
coefficients.

## New Audit Target

Audit the SECURITY certification and audit-like EKs that may need scale or
tier drivers, without changing code:

- `one-fstec-certification`;
- `one-source-code-audit`;
- `one-pentest-external`;
- `one-pentest-internal`;
- `one-pentest-regular`;
- `one-security-audit`;
- any closely related SECURITY one-time/annual EK in `seed.js`.

Focus on whether the current flat/count-driven model is defensible or whether
the description/question text implies missing scale drivers such as:

- protection class / certification class;
- codebase size / LOC / number of repositories;
- number of systems / contours;
- number of pentest scopes;
- audit frequency vs audit scope.

Questions to answer with facts:

1. Exact metadata for each EK:
   `category`, `resourceClass`, `ekClass`, `unit`, `pricePerUnit`,
   `billingInterval`, `applicableStands`, `qtyFormula`, `formulaHelp`.
2. Which questions gate or scale each EK today.
3. Whether small vs large profile cost stays flat or scales through an existing
   count question.
4. Whether current text is honest:
   - "fixed engagement/project median" is OK;
   - any promise of class/LOC/scope scaling without formula is a finding.
5. Classify each candidate:
   - no change;
   - text-only honesty fix;
   - opt-in scale driver candidate;
   - confirmed formula bug;
   - defer until domain coefficients/KP.
6. If a model change is recommended, list the exact new Q fields and domain
   coefficients needed. Do not invent coefficients.
7. Check legacy refresh impact for any proposed formula/unit/price change.

Report format in `CLAUDE_OUTBOX.md`:

```text
Task: Package 9F / Security Certification & Audit Scaling
Status: analysis-only
Files touched: none
Commands run:
Inventory table:
Reproduction table:
Findings by severity:
No-change items:
Recommended next mini-package:
Required domain decisions/coefs:
Refresh-list impact:
Questions for Codex/user:
Next recommended step:
```

## No-Idle Rule

If Codex does not answer within one coordination cycle, continue with safe
read-only work inside this task: expand the inventory, verify another profile,
or cross-check docs/tests. Do not sit idle unless the next step would require
editing files or inventing domain coefficients.

## Package 9C Status

Your Package 9C / `storage-secure-gb` report has been received.

Codex will independently verify the repro and route the domain decision:
whether protected storage is a raw PDn/encrypted footprint or a full DB
footprint with indexes/WAL/replicas. Until Codex/user chooses an option, do not
implement 9C.

## Previous Audit Target (completed): Package 9D

Find remaining flat or weakly-scaled SECURITY / SERVICES / project-like EK
contours that were not already fixed or intentionally deferred in recent
packages.

Start from `js/domain/seed.js`, then cross-check docs/tests where relevant.

Candidates to include if present:

- antifraud / fraud monitoring services;
- EDO / document exchange service;
- pentest / security audit / FSTEC certification one-time or recurring lines;
- other SECURITY/SERVICES items whose `qtyFormula` is a flat `0/1`, constant,
  or weak proxy while the description promises scale, tier, user count, traffic,
  nodes, channels, domains, events, or certification class;
- items already recently stabilized should be listed as "already covered" but
  not reworked: WAF, DDoS, SIEM, DLP, audit-log, SSO/IdP/payment text,
  traffic/email/SMS/push, deployment, staff training, DR, OS/DB license,
  storage floors, Managed RAG.

Questions to answer with facts:

1. Which EK ids remain flat/weakly-scaled, with exact metadata:
   `category`, `resourceClass`, `ekClass`, `unit`, `pricePerUnit`,
   `billingInterval`, `applicableStands`, `qtyFormula`, `formulaHelp`.
2. For each candidate, is flat pricing defensible as a fixed project/service
   median, or does text/formula promise scaling that is not implemented?
3. Reproduce at least small/medium/large profile numbers where the flatness
   affects budget interpretation.
4. Classify each finding:
   - confirmed bug;
   - text-only honesty fix;
   - opt-in scale driver candidate;
   - defer until domain coefficients/KP;
   - false-positive/already covered.
5. If a formula change is recommended, identify required domain coefficients
   and expected drift shape. Do not invent coefficients.
6. Check legacy refresh impact: whether the EK is or should be in
   `_AGENT_FORMULA_REFRESH_IDS` and whether unit/price would require
   `_AGENT_UNIT_PRICE_REFRESH_IDS`.

Report format in `CLAUDE_OUTBOX.md`:

```text
Task: Package 9D / Remaining Flat SECURITY & SERVICES Contours
Status: analysis-only
Files touched: none
Commands run:
Inventory table:
Reproduction table:
Findings by severity:
Already covered / excluded:
Recommended next mini-package:
Drift/golden impact:
Refresh-list impact:
Questions for Codex/user:
Next recommended step:
```

## Completed Handoff: Package 9B / AI Service Contours

Closed as analysis-only false-positive for formulas. Codex is separately
preparing a small migration hardening patch for corrupt persisted
`aiStandFactor` values.

## Completed Handoff: Package 9A / CPU Dedicated Semantics

Released live as v2.22.33 by Codex.
