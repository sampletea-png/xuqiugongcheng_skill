# 读取正在处理的那一条，用已有的需求名称和需求 UUID 准备需求目录。不新起名称，不新生成 UUID。
param(
    [string]$Workspace = (Get-Location).Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$lib = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\..\capture-uncharted\scripts\inbox-lib.ps1"))
. $lib

$buckets = Load-Inbox $Workspace
$active = $null
foreach ($pair in $buckets.GetEnumerator()) {
    if ($pair.Key -eq "正在处理的需求") {
        $active = $pair.Value
    }
}
if ($null -eq $active -or $active.Count -eq 0) {
    Write-Error "没有正在处理的需求。"
    exit 1
}
if ($active.Count -gt 1) {
    Write-Error "正在处理的需求不止一条。"
    exit 1
}
$entry = $active[0]
if ([string]::IsNullOrWhiteSpace($entry.Name) -or [string]::IsNullOrWhiteSpace($entry.Uuid)) {
    Write-Error "正在处理的需求还没有需求名称或需求 UUID。"
    exit 1
}
try {
    Test-RequirementDirectory $Workspace $entry.Name $entry.Uuid
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
$requirementDir = Join-Path (Join-Path $Workspace ".scratch\需求工程") $entry.Name
if (-not (Test-Path -LiteralPath $requirementDir)) {
    New-Item -ItemType Directory -Force -Path $requirementDir | Out-Null
}
$meta = Join-Path $requirementDir "需求.md"
$content = "需求 UUID：$($entry.Uuid)`r`n需求名称：$($entry.Name)`r`n"
$encoding = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText($meta, $content, $encoding)
Write-Output "需求名称：$($entry.Name)"
Write-Output "需求 UUID：$($entry.Uuid)"
exit 0