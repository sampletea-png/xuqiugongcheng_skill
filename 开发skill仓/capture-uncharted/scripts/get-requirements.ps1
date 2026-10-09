# 打印某一节里的需求。状态：待处理、正在处理、处理完成。
param(
    [Parameter(Mandatory = $true)][string]$Status,
    [string]$Workspace = (Get-Location).Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "inbox-lib.ps1")
$heading = Resolve-RequirementStatus $Status
$buckets = Load-Inbox $Workspace
Write-Output "## $heading"
Write-Output ""
if ($buckets[$heading].Count -eq 0) {
    Write-Output "（无）"
    exit 0
}
foreach ($entry in $buckets[$heading]) {
    Write-Output (Format-InboxEntry $entry)
    Write-Output ""
}
exit 0