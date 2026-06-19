# Claude Watchdog

Last check: 2026-06-19 18:05:09 +03:00
Status: OK

Detail: Claude has an active task; outbox changed 1.5 minutes ago.

Inbox mtime: 2026-06-19 18:02:24
Outbox mtime: 2026-06-19 18:03:39

Rule: Claude must always have an active non-overlapping task. If blocked by a
domain decision, Claude continues safe read-only work in the assigned scope
instead of waiting silently.
