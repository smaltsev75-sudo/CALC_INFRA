# Codex Status

## Coordinator State

- Stable live version confirmed: v2.22.32.
- Package 8B-light is released and live.
- Coordination protocol is released and live.
- Claude's next active task is Package 9A / CPU Dedicated Semantics implementation.

## Parallel Codex Work

Current independent Codex track: Package 8C-light provider-overlay documentation guard.

- Codex owns `docs/assistant/WIZARD_PROFILES.md` and
  `tests/unit/architecture/provider-overlay-doc-guard-8c.test.js`.
- RED confirmed: the new guard failed on old MVP/stub/TBD §6 provider-overlay
  documentation.
- GREEN confirmed: targeted `provider-overlay-doc-guard-8c.test.js` is now
  4/4 PASS after updating §6 to runtime bundled providers.
- Codex does not touch `js/domain/seed.js` while Claude owns Package 9A.

Current coordination/verification track: Package 9A CPU Dedicated Semantics.

Current finding:

- `cpu-vcpu-shared` counts full `peak_rps / 50`.
- `cpu-vcpu-dedicated` additionally counts overage above 100 RPS.
- Verified double-count in RPS-dominated cases.
- Decision: replacement semantics. Cap shared RPS at 100 only on PSI/PROD/LOAD; keep RAM from full CPU base.
- Claude has been assigned implementation via `CLAUDE_INBOX.md`.
- Codex read-only verification:
  - Targeted `cpu-dedicated-replacement-9a.test.js` is now 7/7 PASS.
  - Full `npm test` is 6033/6039 PASS.
  - Remaining 9A collateral sent to Claude: update old CPU-base arch invariant,
    update 3 golden snapshots with expected drifts, update quantity-trace qty
    expectation from 18 to 17 and verify capped-base trace.
  - Additional coordinator decision sent to Claude: advanced CPU mode must use
    the same replacement split. Capped shared advanced RPS uses first 100 RPS;
    dedicated advanced overage uses `peak_rps - 100` with the same
    `cpu_ms_per_request / target_util` conversion. RAM stays on full base.
  - Follow-up check found current WIP still says advanced mode is not capped;
    this is a 9A blocker and has been sent back to Claude.

Additional read-only scan: SERVICES/NETWORK flat baselines.

- `network-lb-l7`: cheap threshold model; text explicitly says qty does not scale by stand size. No HIGH finding.
- `network-cdn-edge`: geography-driven contour count; traffic is separate in TRAFFIC ЭК. No HIGH finding.
- `network-realtime-gateway`: already scales by PCU. No HIGH finding.
- `antifraud` and `EDO`: formulas are defensible baseline flat estimates, but question text mentions wider market ranges / per-document economics. Candidate for later text-only clarification or opt-in tier/count model, not a blocking formula bug.
- Codex will not edit `seed.js` for this while Claude is doing Package 9A analysis against the same file.

Additional inventory after 9A started:

- Candidate next audits after 9A:
  - AI service-contours with `LOAD-ratio`: `ai-safety-layer-service`,
    `ai-sensitive-data-gateway`, `ai-low-latency-inference-reserve`.
  - SECURITY/SERVICES flat project/licence contours that are probably
    defensible baselines but need text/driver review before any model change:
    antifraud, EDO, SSO/IdP, pentests/audits, FSTEC certification.
  - Existing scaled items that should be treated carefully, not reworked
    blindly: WAF/DDoS/SIEM/DLP/audit-log and traffic/email/SMS/push have recent
    guard coverage.
  - Storage/security storage cross-check candidate: `storage-secure-gb`.

## Next Coordinator Actions

1. Keep monitoring `CLAUDE_OUTBOX.md`; do not wait silently if no report lands.
2. Finish non-overlapping Package 8C-light verification.
3. When Claude reports Package 9A, verify diff, tests, and drift independently.
4. Decide combined or separate release packaging after both tracks are known.

## No-Idle Commitment

- Codex checks `CLAUDE_OUTBOX.md` and the monitor log before starting each next work slice.
- Claude question to Codex must be answered by Codex in the next coordination pass unless it truly needs a user-owned domain decision.
- While Claude owns `seed.js` for Package 9A, Codex will use only read-only verification or non-overlapping coordination/docs work.
