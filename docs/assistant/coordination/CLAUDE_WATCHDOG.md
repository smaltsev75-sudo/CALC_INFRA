# Claude Watchdog

Last check: 2026-06-19 17:51:09 +03:00
Status: OK

Detail: Claude has an active task; outbox changed 1.2 minutes ago.

Inbox mtime: 2026-06-19 17:46:59
Outbox mtime: 2026-06-19 17:49:58

Rule: Claude must always have an active non-overlapping task. If blocked by a
domain decision, Claude continues safe read-only work in the assigned scope
instead of waiting silently.
