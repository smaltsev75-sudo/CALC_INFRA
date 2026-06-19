# Claude Resume Runbook (auto-restart after context compaction/clear)

This file is Claude-owned. Read it FIRST on any wake-up / fresh session, then act.
Purpose: zero-idle continuation of the Codex↔Claude coordination loop even after the
context window is compacted or cleared.

## Role
- I am Claude, paired with Codex. **Codex is the coordinator (boss).** Questions and
  decisions go to **Codex via `CLAUDE_OUTBOX.md`**, NOT to the user.
- Implementation/release (bump/commit/push/tag/GitHub release) is **coordinator-only**.
  I never release. I do the assigned task (almost always **analysis-only**) and report.

## Resume procedure (do this on every wake-up)
1. Read `docs/assistant/coordination/README.md`, `CODEX_STATUS.md`, and the
   `## Active Task` in `CLAUDE_INBOX.md`. Also check `CLAUDE_WATCHDOG.md` (if WARN/ALERT,
   write a fresh status line to `CLAUDE_OUTBOX.md`).
2. Re-arm the coordination Monitor if it is not running (persistent Monitor over
   INBOX/CODEX_STATUS/OUTBOX md5 changes; prior task id was `bmt9pnxib`). Command body:
   poll every 20s, emit a line when any of the three files' md5 changes.
3. Do the Active Task:
   - **Verify money/formulas/golden PERSONALLY** via a throwaway `node` repro in `d:/tmp/`
     (import project modules with `pathToFileURL`). Do NOT delegate to subagents.
   - **Do NOT invent** domain coefficients/prices/multipliers → raise as a question to Codex.
   - Read facts with file:line; reproduce; classify (bug / text-only / opt-in driver / defer / false-positive).
4. Write the report to `CLAUDE_OUTBOX.md` in the exact format the INBOX specifies. `git status`
   before edits; never clobber files Codex touched (harness blocks stale-write — re-read, don't force).
5. **Never idle**: if blocked, write the smallest precise question to OUTBOX and continue a safe
   read-only subcheck (expand inventory, verify another profile, cross-check docs/tests).

## Hard rules (from user)
- Analysis-only tasks change NO code/tests/docs/versions/golden.
- Don't touch `seed.js` while a release is in flight unless explicitly handed off.
- Don't reopen closed packages (9A/9B/9C-A/8x/Package 4/Managed RAG/OS-DB license/DR/etc.).
- Markdown-lint (MD032/MD060/MD004) warnings are NOT gates — ignore.

## State (update as work progresses)
- Live: v2.22.36 (9E text-only); Codex is releasing v2.22.37 (9F-light pentest text-only).
  Prior: 9A→v2.22.33, 9B migration→v2.22.34, 9C-A LOAD-cap→v2.22.35.
- Completed & accepted: 9A (released), 9B (no-defect), 9C (9C-A LOAD-cap shipped; 9C-B full SSD-parity
  DEFERRED pending compliance-scope domain decision), 9D (→ Codex took text-only as 9E; scale-drivers
  deferred), 9F (no bug; FSTEC class-tier + source-audit LOC-tier deferred pending user coefficients).
- NOTE: this state line lags — `CLAUDE_INBOX.md` Active Task + `CLAUDE_OUTBOX.md` are GROUND TRUTH on resume.
- 9G / AI-RAG-GPU Edge Consistency: **report DELIVERED** to OUTBOX. Repro `d:/tmp/9g-repro.mjs`.
  Findings: intended divergences CONFIRMED (on-prem GPU: external token/embedding bill=0, GPU>0,
  operational TOKENS/EMBEDDINGS shown via `applyAiMetricDemandFallback` — by design; Managed vs
  self-hosted RAG mutually exclusive, embeddings always separate; latency reserve only at "<500ms";
  vector-db storage bills even on-prem = real local cost). LOW finding: `rag-vector-db-gb` /
  `rag-managed-knowledge-base-gb` gate only on `Q.rag_needed`, NOT `Q.ai_llm_used` → asymmetric with
  llm-tokens under inconsistent imported state (ai_llm_used=false + rag_needed=true) — UI cascade
  prevents normally; import-only-reachable; recommend Codex add `ai_llm_used &&` guard or confirm
  Health Check covers it. Edge: RAG corpus=0 still bills query-embeddings (rag-embeddings-1m) while
  vector-db=0. NEXT: follow the current `CLAUDE_INBOX.md` Active Task, which supersedes this resume note.
  At the time of this update it is Package 9H / RAG stale-flag defense-in-depth, analysis-only.
