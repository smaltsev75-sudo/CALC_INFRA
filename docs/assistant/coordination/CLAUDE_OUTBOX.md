# Claude Outbox

Claude writes reports, blockers, and questions here.

## Latest Report

Task: Package 9G / AI-RAG-GPU Edge Consistency

Status: analysis-only (no code/test/doc/version/golden changes; live point v2.22.36)

Files touched: none. Read-only repro: `d:/tmp/9g-repro.mjs` (outside repo).

Commands run:
- `node d:/tmp/9g-repro.mjs` — billable EK qty (PROD) + operational AI metrics (`aggregateAiMetrics`) on 6 edge scenarios.
- Read-only: seed.js (llm-tokens, rag-embeddings, rag-vector-db, rag-managed-kb, cpu-vcpu-gpu, ai-agent-*); `js/ui/dashboardAggregates.js` `aggregateAiMetrics` + `applyAiMetricDemandFallback`.

Inventory table (key gates):
- `llm-tokens-input-1m` / `-output-1m` AI/AI_LLM monthly ai-driven, gate `ai_llm_used && ai_hosting_mode != "on_prem_gpu"`, dashboardAiMetric TOKENS.
- `rag-embeddings-1m` AI/AI_LLM monthly, gate `rag_needed && ai_hosting_mode != "on_prem_gpu"`, dashboardAiMetric EMBEDDINGS. (corpus reindex part + query part)
- `rag-vector-db-gb` AI monthly, gate `rag_needed && !rag_managed_used`, dashboardAiMetric RAG_VECTORS.
- `rag-managed-knowledge-base-gb` AI monthly, gate `rag_needed && rag_managed_used`, dashboardAiMetric RAG_VECTORS.
- `cpu-vcpu-gpu` AI/CPU monthly, gate `ai_llm_used && ai_hosting_mode == "on_prem_gpu"`, dashboardResource GPU.
- `ai-low-latency-inference-reserve` AI/SERVICE monthly, gate `ai_llm_used && ai_inference_latency_ms == "<500ms"`.
- `ai-agent-sandbox-vcpu` (gate ai_agent_mode, dashboardResource CPU + AI metric AGENT_CPU), `ai-agent-memory-storage-tb` (gate ai_agent_mode && agent_memory_used).
- Operational fallback: `applyAiMetricDemandFallback` rebuilds TOKENS (from llm-tokens-* + safety) and EMBEDDINGS (from rag-embeddings) FROM ANSWERS when the billable total is 0.

Reproduction table (PROD billable qty; operational = total across active stands):
- A external + self-hosted RAG: vector-db=16, managed=0, embeddings=60900, llm-in=2700, gpu=0 | ops TOKENS=17970 EMB=260026 RAG_VECTORS=71.
- B external + managed RAG: managed=16, vector-db=0, embeddings=60900 | ops same. (mutually exclusive; embeddings separate)
- C on-prem GPU + self-hosted: llm-in=0, embeddings=0, gpu=15, vector-db=16 | ops TOKENS=17970 EMB=260026 (via fallback).
- D external, RAG corpus=0: embeddings=900 (query part only), vector-db=0 | ops EMB=3843, RAG_VECTORS=0.
- E AI off (ai_llm_used=false) + rag_needed still true: vector-db=16 BILLED, llm-in=0 | ops TOKENS=17970 EMB=260026 RAG_VECTORS=71.
- F low-latency "<500ms": ai-low-latency-inference-reserve=1 (was 0 at "<2s").

Findings by severity:

1) Intended divergence / by-design (CONFIRMED — no action):
   - on-prem GPU: external-API token/embedding BILL = 0, but GPU compute (`cpu-vcpu-gpu`) and local
     `rag-vector-db-gb` storage ARE billed (real local cost), and operational TOKENS/EMBEDDINGS stay
     visible via `applyAiMetricDemandFallback`. Matches documented contract "AI workload ≠ external API billing".
   - Managed vs self-hosted RAG: exactly one of `rag-vector-db-gb` / `rag-managed-knowledge-base-gb` bills;
     embeddings (`rag-embeddings-1m`) are always separate (NOT included in Managed). By design.
   - `ai-low-latency-inference-reserve` activates only at the strictest "<500ms". By design.

2) LOW — consistency / defense-in-depth (scenario E): `rag-vector-db-gb` and `rag-managed-knowledge-base-gb`
   gate ONLY on `Q.rag_needed`, NOT on `Q.ai_llm_used`. The LLM-token EKs gate on `ai_llm_used`. So in an
   inconsistent state (ai_llm_used=false + rag_needed=true) the RAG storage still bills while llm-tokens are 0
   — internally asymmetric. The UI master-toggle cascade nulls `rag_needed` when `ai_llm_used` is turned off,
   so this is reachable ONLY via an inconsistent JSON import (no cascade on import). I did NOT find a guard for
   the rag_needed-without-ai_llm_used case in `calculationHealth.js` (the documented stale-flag token warning
   may live elsewhere — please verify). Recommend: add `Q.ai_llm_used &&` to the two RAG-storage gates
   (symmetry with llm-tokens) OR confirm Health Check + cascade fully cover it.

3) LOW — edge (scenario D): with `rag_corpus_size_gb=0`, `rag-embeddings-1m` still bills the query-embedding
   part (900) while `rag-vector-db-gb`=0 (nothing stored). Embedding search queries against an empty index is
   degenerate. Consider gating the query-embedding term on corpus>0, OR document that queries are embedded
   regardless. Minor.

No confirmed formula bugs. No false positives beyond the by-design items above.

Recommended next mini-package: optional small "9H" consistency guard — add `Q.ai_llm_used &&` to
`rag-vector-db-gb` / `rag-managed-knowledge-base-gb` gates (symmetry with llm-tokens). Golden/business drift
≈ 0 (normal calcs never have rag_needed without ai_llm_used due to the cascade); it only hardens against
inconsistent imports. Low priority — or defer. Corpus=0 query-embedding gate is an even smaller optional follow-up.

Refresh-list impact: `rag-embeddings-1m`, `rag-vector-db-gb`, `rag-managed-knowledge-base-gb` are ALREADY in
`_AGENT_FORMULA_REFRESH_IDS`, so adding an `ai_llm_used` guard would propagate to legacy/imported calcs at
openCalc. No unit/price change → `_AGENT_UNIT_PRICE_REFRESH_IDS` not needed.

Questions for Codex/user:
1. Confirm the on-prem / managed-vs-self-hosted / latency divergences are intended (no action)?
2. RAG-storage `ai_llm_used` asymmetry (finding 2): add the guard for symmetry, or rely on UI cascade +
   Health Check? (Please confirm whether Health Check flags rag_needed-without-ai_llm_used — I did not find it
   in calculationHealth.js.)
3. RAG corpus=0 query-embeddings (finding 3): gate on corpus>0 or document as intended?

Next recommended step: Codex verify the repro (esp. E asymmetry and C fallback). No formula bug requires
change. The two LOW items are defense-in-depth/edge — Codex decides whether to schedule 9H or defer. No
implementation or release now (analysis-only).
