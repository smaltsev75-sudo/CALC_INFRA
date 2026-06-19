# Claude Inbox

## Active Task: Package 9H / RAG stale-flag defense-in-depth — ANALYSIS ONLY

Mode: analysis-only. Do **not** edit production code, tests, docs, versions, or
golden files for this task. Write the report to `CLAUDE_OUTBOX.md`.

Stable live point: v2.22.36. Codex is releasing v2.22.37 text-only
(`one-pentest-external` / `one-pentest-internal`) in parallel; do not touch
code, tests, docs, version files, or golden files.

## Package 9G Status

Your Package 9G report has been received.

Confirmed as by-design, no action unless you find contradictory evidence:

- on-prem GPU: external token/embedding billable rows can be 0 while
  operational Dashboard metrics stay visible;
- managed RAG and self-hosted vector DB are mutually exclusive;
- embeddings remain a separate billable EK and are not included in managed RAG;
- low-latency reserve activates only for `<500ms`.

Do not implement 9G.

## New Audit Target

Verify the two LOW findings from Package 9G and decide whether they deserve a
small follow-up package or should be deferred. Do not change files.

Areas to inspect:

- `rag-managed-knowledge-base-gb`;
- `rag-vector-db-gb`;
- `rag-embeddings-1m`;
- question cascade / dependency behavior for `ai_llm_used` and `rag_needed`;
- calculation health checks for stale/inconsistent RAG flags;
- legacy enrichment and formula refresh lists for RAG items.

Questions to answer with facts:

1. Is `ai_llm_used=false && rag_needed=true` reachable through normal UI after
   the master-toggle cascade, or only via inconsistent imported JSON?
2. Does any Health Check already warn when RAG flags are stale while AI is off?
   Search the actual health-check registry, not just filenames.
3. If no health check exists, compare two options:
   - add `Q.ai_llm_used &&` to `rag-vector-db-gb` and
     `rag-managed-knowledge-base-gb`;
   - add/adjust a Health Check only.
4. Estimate drift on existing golden/business scenarios for each option.
5. For `rag_corpus_size_gb=0`, should query embeddings remain billable because
   queries are still vectorized, or should they be gated on corpus>0? Verify
   current text/formulaHelp before recommending.
6. Check refresh-list impact if any formula change is recommended.

Report format in `CLAUDE_OUTBOX.md`:

```text
Task: Package 9H / RAG stale-flag defense-in-depth
Status: analysis-only
Files touched: none
Commands run:
Findings by severity:
Recommended next mini-package:
Refresh-list impact:
Questions for Codex/user:
Next recommended step:
```

## No-Idle Rule

If Codex does not answer within one coordination cycle, continue with safe
read-only work inside this task: expand the inventory, verify another profile,
or cross-check docs/tests. Do not sit idle unless the next step would require
editing files or inventing domain coefficients.

Also watch `CLAUDE_WATCHDOG.md`: if it reports WARN/ALERT, write a fresh
status line to `CLAUDE_OUTBOX.md` explaining whether you are still working,
blocked, or need a new task.

No-idle heartbeat rule: if you have no final report yet, append a short status
line to `CLAUDE_OUTBOX.md` at least every 10 minutes. If Package 9G becomes
blocked by a domain decision, immediately continue safe read-only fallback work:
scan the same AI/RAG/GPU scope for stale documentation or tests that mention
old billing semantics, and report facts only. Do not wait silently.

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
