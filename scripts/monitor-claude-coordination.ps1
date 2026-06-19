param(
    [string] $Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
    [int] $IntervalSeconds = 15,
    [string] $RuntimeDir = $null
)

$ErrorActionPreference = 'Stop'

if (-not $RuntimeDir) {
    $RuntimeDir = Join-Path $Root '.claude/coordination-monitor'
}

$coordDir = Join-Path $Root 'docs/assistant/coordination'
$files = @(
    'CLAUDE_INBOX.md',
    'CLAUDE_OUTBOX.md',
    'CODEX_STATUS.md'
) | ForEach-Object { Join-Path $coordDir $_ }

New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
$logPath = Join-Path $RuntimeDir 'coordination-monitor.log'
$statePath = Join-Path $RuntimeDir 'coordination-monitor-state.json'
$pidPath = Join-Path $RuntimeDir 'coordination-monitor.pid'

function Write-Log {
    param([string] $Message)
    $ts = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    Add-Content -LiteralPath $logPath -Encoding UTF8 -Value "[$ts] $Message"
}

function Get-FileSnapshot {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return [ordered]@{
            exists = $false
            length = 0
            mtimeUtc = $null
            hash = $null
        }
    }

    $item = Get-Item -LiteralPath $Path
    if (Get-Command Get-FileHash -ErrorAction SilentlyContinue) {
        $hash = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    } else {
        $stream = [System.IO.File]::OpenRead($Path)
        try {
            $sha = [System.Security.Cryptography.SHA256]::Create()
            $hashBytes = $sha.ComputeHash($stream)
            $hash = -join ($hashBytes | ForEach-Object { $_.ToString('X2') })
        } finally {
            $stream.Dispose()
        }
    }
    return [ordered]@{
        exists = $true
        length = $item.Length
        mtimeUtc = $item.LastWriteTimeUtc.ToString('o')
        hash = $hash
    }
}

function Get-FirstHeading {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $line = Get-Content -LiteralPath $Path -Encoding UTF8 -TotalCount 80 |
        Where-Object { $_ -match '^##\s+' } |
        Select-Object -First 1
    if ($line) { return ($line -replace '^##\s+', '').Trim() }
    return ''
}

function Get-OutboxQuestionBlock {
    param([string] $Path)
    if (-not (Test-Path -LiteralPath $Path)) { return '' }
    $lines = Get-Content -LiteralPath $Path -Encoding UTF8
    $start = -1
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^Questions for Codex/user\s*:') {
            $start = $i
            break
        }
    }
    if ($start -lt 0) { return '' }

    $end = $lines.Count
    for ($i = $start + 1; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^(Next recommended step|Task|Status|Files touched|Commands run|Findings|Drift/golden impact)\s*:') {
            $end = $i
            break
        }
    }

    $block = $lines[$start..($end - 1)] -join ' '
    return (($block -replace '\s+', ' ').Trim())
}

function Load-State {
    if (-not (Test-Path -LiteralPath $statePath)) { return @{} }
    try {
        $json = Get-Content -LiteralPath $statePath -Encoding UTF8 -Raw
        if (-not $json.Trim()) { return @{} }
        $obj = ConvertFrom-Json $json
        $table = @{}
        foreach ($property in $obj.PSObject.Properties) {
            $table[$property.Name] = $property.Value
        }
        return $table
    } catch {
        Write-Log "WARN state read failed: $($_.Exception.Message)"
        return @{}
    }
}

function Save-State {
    param($State)
    ($State | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $statePath -Encoding UTF8
}

Set-Content -LiteralPath $pidPath -Encoding UTF8 -Value $PID
Write-Log "START root=$Root interval=${IntervalSeconds}s pid=$PID"

$state = Load-State
while ($true) {
    foreach ($path in $files) {
        $name = Split-Path -Leaf $path
        $snapshot = Get-FileSnapshot $path
        $old = $state[$name]
        $changed = $null -eq $old -or $old.hash -ne $snapshot.hash -or $old.exists -ne $snapshot.exists
        if ($changed) {
            $hashPrefix = if ($snapshot.hash) { $snapshot.hash.Substring(0, 12) } else { 'missing' }
            $heading = Get-FirstHeading $path
            Write-Log "CHANGE file=$name exists=$($snapshot.exists) bytes=$($snapshot.length) hash=$hashPrefix heading=`"$heading`""
            if ($name -eq 'CLAUDE_OUTBOX.md') {
                $questionBlock = Get-OutboxQuestionBlock $path
                if ($questionBlock) {
                    Write-Log "OUTBOX_QUESTIONS $questionBlock"
                }
            }
            $state[$name] = $snapshot
            Save-State $state
        }
    }
    Start-Sleep -Seconds $IntervalSeconds
}
