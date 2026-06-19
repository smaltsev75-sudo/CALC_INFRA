param(
    [int]$IntervalSeconds = 120,
    [int]$IdleMinutes = 10
)

$ErrorActionPreference = 'Stop'

$coord = $PSScriptRoot
$inbox = Join-Path $coord 'CLAUDE_INBOX.md'
$outbox = Join-Path $coord 'CLAUDE_OUTBOX.md'
$watchdog = Join-Path $coord 'CLAUDE_WATCHDOG.md'

function Write-WatchdogStatus {
    param(
        [string]$Status,
        [string]$Detail
    )

    $now = Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz'
    $inboxTime = if (Test-Path $inbox) { (Get-Item $inbox).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'missing' }
    $outboxTime = if (Test-Path $outbox) { (Get-Item $outbox).LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss') } else { 'missing' }

    $content = @"
# Claude Watchdog

Last check: $now
Status: $Status

Detail: $Detail

Inbox mtime: $inboxTime
Outbox mtime: $outboxTime

Rule: Claude must always have an active non-overlapping task. If blocked by a
domain decision, Claude continues safe read-only work in the assigned scope
instead of waiting silently.
"@
    Set-Content -LiteralPath $watchdog -Value $content -Encoding UTF8
}

while ($true) {
    try {
        if (-not (Test-Path $inbox)) {
            Write-WatchdogStatus -Status 'ALERT' -Detail 'CLAUDE_INBOX.md is missing.'
        } elseif (-not (Test-Path $outbox)) {
            Write-WatchdogStatus -Status 'ALERT' -Detail 'CLAUDE_OUTBOX.md is missing.'
        } else {
            $inboxText = Get-Content -LiteralPath $inbox -Raw
            $outboxItem = Get-Item -LiteralPath $outbox
            $idleFor = (New-TimeSpan -Start $outboxItem.LastWriteTime -End (Get-Date)).TotalMinutes
            $hasActiveTask = $inboxText -match '## Active Task:'
            $hasNoIdleRule = $inboxText -match 'No-Idle|continue safe read-only|safe read-only|instead of waiting silently'

            if (-not $hasActiveTask) {
                Write-WatchdogStatus -Status 'ALERT' -Detail 'No active Claude task found in CLAUDE_INBOX.md.'
            } elseif (-not $hasNoIdleRule) {
                Write-WatchdogStatus -Status 'WARN' -Detail 'Active task exists, but no explicit no-idle rule found.'
            } elseif ($idleFor -ge $IdleMinutes) {
                $minutes = [math]::Round($idleFor, 1)
                Write-WatchdogStatus -Status 'WARN' -Detail "CLAUDE_OUTBOX.md has not changed for $minutes minutes. Codex must check whether Claude needs a new task or can continue read-only work."
            } else {
                $minutes = [math]::Round($idleFor, 1)
                Write-WatchdogStatus -Status 'OK' -Detail "Claude has an active task; outbox changed $minutes minutes ago."
            }
        }
    } catch {
        Write-WatchdogStatus -Status 'ALERT' -Detail "Watchdog error: $($_.Exception.Message)"
    }

    Start-Sleep -Seconds $IntervalSeconds
}
