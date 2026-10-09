# 开图结束后，把 map.md 的 Not yet specified 每一行追加为待处理需求。不改地图。
param(
    [Parameter(Mandatory = $true)][string]$RequirementName,
    [string]$Workspace = (Get-Location).Path
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$mapPath = Join-Path $Workspace ".scratch\需求工程\$RequirementName\map.md"
if (-not (Test-Path -LiteralPath $mapPath)) {
    Write-Error "没有地图：$mapPath"
    exit 1
}
$encoding = New-Object System.Text.UTF8Encoding $false
$text = [System.IO.File]::ReadAllText($mapPath, $encoding)
$capture = $false
$lines = New-Object System.Collections.Generic.List[string]
foreach ($line in ($text -split "\r?\n")) {
    $heading = [regex]::Match($line, "^##\s+(.+?)\s*$")
    if ($heading.Success) {
        if ($capture) { break }
        $capture = $heading.Groups[1].Value -eq "Not yet specified"
        continue
    }
    if (-not $capture) { continue }
    $trimmed = $line.Trim()
    if ($trimmed.Length -eq 0) { continue }
    if ($trimmed -match "^<.+>$") { continue }
    $lines.Add($trimmed)
}
if ($lines.Count -eq 0) {
    Write-Output "（无）"
    exit 0
}
$add = Join-Path $PSScriptRoot "..\..\capture-uncharted\scripts\add-requirement.ps1"
$add = [System.IO.Path]::GetFullPath($add)
$source = "开图结束 · $RequirementName · Not yet specified"
foreach ($body in $lines) {
    & powershell -NoProfile -ExecutionPolicy Bypass -File $add -Status "待处理" -Source $source -Body $body -Workspace $Workspace
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    Write-Output ""
}
exit 0