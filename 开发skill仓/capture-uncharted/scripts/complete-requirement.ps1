# 把正在处理的那一条移到处理完成。不判断它是否已经处理完成。需求 UUID 不变。
param(
    [string]$RequirementUuid = "",
    [string]$Workspace = (Get-Location).Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "inbox-lib.ps1")
$buckets = Load-Inbox $Workspace
$activeName = "正在处理的需求"
$active = $buckets[$activeName]
if ($active.Count -eq 0) {
    Write-Error "没有正在处理的需求。"
    exit 1
}
if ($active.Count -gt 1) {
    Write-Error "正在处理的需求不止一条。"
    exit 1
}
if ($RequirementUuid.Trim().Length -gt 0 -and $active[0].Uuid -ne $RequirementUuid.Trim().ToLowerInvariant()) {
    Write-Error "正在处理的不是这个需求 UUID。"
    exit 1
}
$entry = $active[0]
$active.RemoveAt(0)
$buckets["处理完成的需求"].Add($entry)
Save-Inbox $Workspace $buckets
Write-Output (Format-InboxEntry $entry)
exit 0