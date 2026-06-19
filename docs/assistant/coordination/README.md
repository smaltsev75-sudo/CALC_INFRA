# Codex / Claude Coordination

This folder is the project-local coordination channel for parallel Codex and Claude work.

## Roles

- Codex is the coordinator: owns task routing, conflict checks, final verification, release go/no-go, and user-facing status.
- Claude owns only the task currently assigned in `CLAUDE_INBOX.md`.
- Both agents must treat uncommitted changes from the other agent as user-owned work.

## File Ownership

- `CLAUDE_INBOX.md` is written by Codex. Claude reads it and must not edit it.
- `CLAUDE_OUTBOX.md` is written by Claude. Codex reads it and may reset/archive it only after consuming the report.
- `CODEX_STATUS.md` is written by Codex. Claude reads it for current coordination state.
- Production source, tests, docs outside this folder are edited only by the agent that owns the active task scope.

## Anti-Clobber Rules

1. Before editing, run `git status --short --branch`.
2. If files outside your assigned scope are modified, stop and report.
3. Do not overwrite, revert, rename, format, or clean files touched by the other agent.
4. If a task requires a file currently touched by the other agent, ask through the outbox and wait.
5. Release, push, tag, and GitHub release are coordinator-only unless Codex explicitly delegates them.

## Dispute Resolution

Disputes are handled by stop-and-escalate, not by unilateral edits.

1. **Domain uncertainty**: if a formula needs a business coefficient, market price,
   edition/tier multiplier, or policy decision, Claude must stop and write the
   options to `CLAUDE_OUTBOX.md`. Codex verifies the facts and asks the user or
   chooses only when the existing project policy already decides it.
2. **Formula vs text disagreement**: do not silently make formulas match prose or
   prose match formulas. Report both surfaces, reproduce the current number, and
   propose `text-only`, `formula-change`, and `defer` options with drift impact.
3. **Shared-file conflict**: if both agents need the same file, the active owner
   keeps the file. The other agent switches to read-only review or waits for a
   handoff in `CLAUDE_OUTBOX.md`.
4. **Test disagreement**: a failing test is not waived by summary. The agent must
   provide command output, explain whether it is a real regression or known flaky
   behavior, and Codex decides whether to fix, rerun, or defer.
5. **Release disagreement**: no release happens while there is an unresolved
   dispute. Codex performs final verification and user-facing release go/no-go.
6. **Tie-breaker**: if Codex and Claude disagree after factual verification, the
   user decides. Until then, code stays unchanged except for agreed read-only
   docs/notes.

## Task Flow

1. Codex writes a scoped task in `CLAUDE_INBOX.md`.
2. Claude works only within that scope.
3. Claude writes findings, changed files, tests, blockers, and questions in `CLAUDE_OUTBOX.md`.
4. Codex verifies results independently before any release or next task.
5. If Claude asks a question addressed to Codex, Codex must answer or route it in
   the next coordination pass. Do not wait for the user to ping unless the
   question truly requires a domain decision from the user.

## No-Idle Rule

The user must not have to ping either agent to keep the work moving.

1. **Every coordination pass starts by checking the monitor/outbox.** Codex must
   read recent `coordination-monitor.log` entries and `CLAUDE_OUTBOX.md` before
   starting unrelated work.
2. **Questions addressed to Codex are Codex-owned blockers.** If Claude asks
   `Questions for Codex/user:` and the question can be decided from verified
   project policy or current evidence, Codex must answer by updating
   `CLAUDE_INBOX.md` or `CODEX_STATUS.md` in the next pass. Codex must not wait
   for the user to repeat the prompt.
3. **Questions that truly require domain ownership go to the user immediately.**
   Examples: new market prices, business coefficients, edition/tier multipliers,
   release-risk acceptance. Codex must state the exact decision needed and keep
   Claude on a safe independent task if one exists.
4. **Claude must never idle silently.** If Claude is blocked, it writes the
   blocker and the smallest useful next step to `CLAUDE_OUTBOX.md`. If the active
   task is finished, Claude reports completion and waits only after the outbox is
   complete.
5. **Codex must not idle while Claude works.** If Claude owns a shared file such
   as `seed.js`, Codex switches to read-only verification, independent docs,
   test planning, or a non-overlapping package. Codex must not edit shared files
   until the handoff is explicit.
6. **If no safe parallel work exists, make the blocker explicit.** Update
   `CODEX_STATUS.md` with `blocked-by`, `waiting-for`, and the next action that
   will resume work. A silent pause is a process bug.
7. **After each Claude report, Codex must close the loop.** Verify facts, choose
   or route the decision, assign the next task, or ask the user. Leaving a report
   unanswered in `CLAUDE_OUTBOX.md` is not allowed.
8. **The coordination files are the source of truth.** Verbal/user-chat task
   routing should be mirrored into `CLAUDE_INBOX.md`/`CODEX_STATUS.md` so both
   agents can continue without re-reading the whole conversation.

## Local Monitoring

Codex may run a local watcher for this folder:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/monitor-claude-coordination.ps1
```

Runtime files are written under `.claude/coordination-monitor/`, which is ignored by git:

- `coordination-monitor.log` — append-only task/question event journal.
- `coordination-monitor-state.json` — file hash state.
- `coordination-monitor.pid` — current watcher process id.

The watcher observes `CLAUDE_INBOX.md`, `CLAUDE_OUTBOX.md`, and `CODEX_STATUS.md`. It logs every content change and extracts the `Questions for Codex/user:` block from Claude reports when present. It does not edit project files.

## Report Format For Claude

Use this structure in `CLAUDE_OUTBOX.md`:

```text
Task:
Status: analysis-only | WIP-ready | blocked | released
Files touched:
Commands run:
Findings:
Drift/golden impact:
Questions for Codex/user:
Next recommended step:
```

## Current Policy

- Analysis-only tasks must not change code.
- TDD is required for implementation tasks.
- Domain coefficients, prices, and tier multipliers are not invented by agents.
- If a change affects formulas, legacy refresh lists must be checked.
- If unit or price semantics change, unit/price refresh must be checked.
