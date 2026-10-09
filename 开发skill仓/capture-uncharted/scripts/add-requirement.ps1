# 追加一条新需求。状态只能是待处理或正在处理。需求 UUID 由 new-uuid.ps1 分配。
param(
    [Parameter(Mandatory = $true)][string]$Status,
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Body,
    [string]$Name = "",
    [string[]]$BlockedBy = @(),
    [string]$Date = (Get-Date -Format "yyyy-MM-dd"),
    [string]$Workspace = (Get-Location).Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "inbox-lib.ps1")
$heading = Resolve-RequirementStatus $Status
if ($heading -eq "处理完成的需求") {
    Write-Error "新需求不直接写入处理完成的需求。"
    exit 1
}
$buckets = Load-Inbox $Workspace
if ($heading -eq "正在处理的需求" -and $buckets[$heading].Count -gt 0) {
    Write-Error "正在处理的需求已有另一条。"
    exit 1
}
$uuid = (& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "new-uuid.ps1") -Workspace $Workspace | Out-String).Trim()
if ($uuid -notmatch "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$") {
    Write-Error "new-uuid.ps1 没有返回 UUID。"
    exit 1
}
$blocked = New-Object System.Collections.Generic.List[string]
foreach ($item in @($BlockedBy)) {
    if ([string]::IsNullOrWhiteSpace($item)) { continue }
    $id = $item.Trim().ToLowerInvariant()
    if ($id -notmatch "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$") {
        Write-Error "阻塞前提必须是需求 UUID：$item"
        exit 1
    }
    if ($id -eq $uuid) {
        Write-Error "当前需求不能被自己阻塞。"
        exit 1
    }
    if (-not $blocked.Contains($id)) { $blocked.Add($id) }
}
$entry = [pscustomobject]@{
    Date = $Date
    Source = $Source.Trim()
    Name = $Name.Trim()
    Uuid = $uuid
    BlockedBy = $blocked.ToArray()
    Body = $Body.Trim()
    Bullet = ""
}
if ($heading -eq "正在处理的需求") {
    if ([string]::IsNullOrWhiteSpace($entry.Name)) {
        Write-Error "正在处理的需求必须有需求名称。"
        exit 1
    }
    try {
        Test-RequirementDirectory $Workspace $entry.Name $entry.Uuid
    } catch {
        Write-Error $_.Exception.Message
        exit 1
    }
    $unfinished = @(Get-UnfinishedBlockers $buckets $entry)
    if ($unfinished.Count -gt 0) {
        Write-Error ("当前需求被 {0} 阻塞，该前提尚未处理完成。" -f ($unfinished -join "、"))
        exit 1
    }
}
$buckets[$heading].Add($entry)
Save-Inbox $Workspace $buckets
Write-Output (Format-InboxEntry $buckets[$heading][$buckets[$heading].Count - 1])
exit 0