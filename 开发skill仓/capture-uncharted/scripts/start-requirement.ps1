# 开始处理一条已有需求。已是正在处理则保持不动。待处理则移入正在处理。已有另一条正在处理则停下。
param(
    [Parameter(Mandatory = $true)][string]$RequirementUuid,
    [string]$Name = "",
    [string]$Workspace = (Get-Location).Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "inbox-lib.ps1")
$buckets = Load-Inbox $Workspace
$found = Find-InboxEntry $buckets $RequirementUuid
if ($null -eq $found) {
    Write-Error "inbox.md 里没有这个需求 UUID。"
    exit 1
}
$activeName = "正在处理的需求"
$active = $buckets[$activeName]
if ($Name.Trim().Length -gt 0) {
    if ([string]::IsNullOrWhiteSpace($found.Entry.Date)) {
        Write-Error "条目首行无法写入需求名称。"
        exit 1
    }
    $found.Entry.Name = $Name.Trim()
}
if ($found.Section -eq $activeName) {
    if ($active.Count -ne 1) {
        Write-Error "正在处理的需求不止一条。"
        exit 1
    }
    if ([string]::IsNullOrWhiteSpace($found.Entry.Name)) {
        Write-Error "正在处理的需求必须有需求名称。"
        exit 1
    }
    try {
        Test-RequirementDirectory $Workspace $found.Entry.Name $found.Entry.Uuid
    } catch {
        Write-Error $_.Exception.Message
        exit 1
    }
    Save-Inbox $Workspace $buckets
    Write-Output (Format-InboxEntry $found.Entry)
    exit 0
}
if ($found.Section -eq "处理完成的需求") {
    Write-Error "这一条已经在处理完成的需求里。"
    exit 1
}
if ($active.Count -gt 0) {
    Write-Error "正在处理的需求已有另一条。"
    exit 1
}
$unfinished = @(Get-UnfinishedBlockers $buckets $found.Entry)
if ($unfinished.Count -gt 0) {
    Write-Error ("当前需求被 {0} 阻塞，该前提尚未处理完成。" -f ($unfinished -join "、"))
    exit 1
}
if ([string]::IsNullOrWhiteSpace($found.Entry.Name)) {
    Write-Error "正在处理的需求必须有需求名称。"
    exit 1
}
try {
    Test-RequirementDirectory $Workspace $found.Entry.Name $found.Entry.Uuid
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
$buckets[$found.Section].RemoveAt($found.Index)
$active.Add($found.Entry)
Save-Inbox $Workspace $buckets
Write-Output (Format-InboxEntry $found.Entry)
exit 0