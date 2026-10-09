# 打印一个尚未占用的 UUID。
# 只按需求工程临时文件的既定字段和章节读取，不在正文里搜索。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File new-uuid.ps1 -Workspace <仓库根目录>

param(
    [string]$Workspace = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
$fieldLine = "^\s*(需求 UUID|对齐 UUID|会话 UUID)\s*[：:]\s*($uuid)\s*$"
$uuidLine = "^($uuid)$"
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

function Read-Text {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    return Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
}

function Add-FieldLines {
    param([string]$Text, [scriptblock]$Accept)
    if ([string]::IsNullOrEmpty($Text)) {
        return
    }
    foreach ($line in ($Text -split "\r?\n")) {
        if (-not (& $Accept $line)) {
            continue
        }
        $match = [regex]::Match($line, $fieldLine)
        if ($match.Success) {
            [void]$seen.Add($match.Groups[2].Value.ToLowerInvariant())
        }
    }
}

function Add-HeadingValue {
    param([string]$Text, [string]$Heading)
    if ([string]::IsNullOrEmpty($Text)) {
        return
    }
    $capture = $false
    foreach ($line in ($Text -split "\r?\n")) {
        $headingMatch = [regex]::Match($line, "^##\s+(.+?)\s*$")
        if ($headingMatch.Success) {
            if ($capture) {
                break
            }
            $capture = $headingMatch.Groups[1].Value -eq $Heading
            continue
        }
        if (-not $capture) {
            continue
        }
        $trimmed = $line.Trim()
        if ($trimmed.Length -eq 0) {
            continue
        }
        if ($trimmed -match $uuidLine) {
            [void]$seen.Add($trimmed.ToLowerInvariant())
        }
        break
    }
}

$scratch = Join-Path $Workspace ".scratch\需求工程"

$inbox = Read-Text (Join-Path $scratch "inbox.md")
$section = ""
$inItem = $false
Add-FieldLines $inbox {
    param($line)
    $headingMatch = [regex]::Match($line, "^##\s+(.+?)\s*$")
    if ($headingMatch.Success) {
        $script:section = $headingMatch.Groups[1].Value
        $script:inItem = $false
        return $false
    }
    if ($script:section -ne "待处理需求" -and $script:section -ne "正在处理的需求" -and $script:section -ne "处理完成的需求") {
        return $false
    }
    if ($line -match "^- ") {
        $script:inItem = $true
        return $false
    }
    return $script:inItem
}
if (-not [string]::IsNullOrEmpty($inbox)) {
    $blockerLine = "^\s*当前需求被\s+($uuid)\s+阻塞\s*$"
    $section = ""
    $inItem = $false
    foreach ($line in ($inbox -split "\r?\n")) {
        $headingMatch = [regex]::Match($line, "^##\s+(.+?)\s*$")
        if ($headingMatch.Success) {
            $section = $headingMatch.Groups[1].Value
            $inItem = $false
            continue
        }
        if ($section -ne "待处理需求" -and $section -ne "正在处理的需求" -and $section -ne "处理完成的需求") {
            continue
        }
        if ($line -match "^- ") {
            $inItem = $true
            continue
        }
        if (-not $inItem) { continue }
        $blocked = [regex]::Match($line, $blockerLine)
        if ($blocked.Success) {
            [void]$seen.Add($blocked.Groups[1].Value.ToLowerInvariant())
        }
    }
}

if (Test-Path -LiteralPath $scratch) {
    Get-ChildItem -LiteralPath $scratch -Directory | ForEach-Object {
        $requirement = $_.FullName
        foreach ($name in @("需求.md", "简述.md")) {
            Add-FieldLines (Read-Text (Join-Path $requirement $name)) { param($line) return $true }
        }
        Add-HeadingValue (Read-Text (Join-Path $requirement "map.md")) "需求 UUID"

        $alignment = Join-Path $requirement "对齐"
        if (-not (Test-Path -LiteralPath $alignment)) {
            return
        }
        Get-ChildItem -LiteralPath $alignment -Directory | ForEach-Object {
            foreach ($name in @("过程.md", "结论.md")) {
                $text = Read-Text (Join-Path $_.FullName $name)
                if ([string]::IsNullOrEmpty($text)) {
                    continue
                }
                $header = ($text -split "\r?\n##\s", 2)[0]
                Add-FieldLines $header { param($line) return $true }
            }
        }
    }
}

$limit = 16
for ($i = 0; $i -lt $limit; $i++) {
    $id = [guid]::NewGuid().ToString().ToLowerInvariant()
    if (-not $seen.Contains($id)) {
        Write-Output $id
        exit 0
    }
}

Write-Error "无法生成未重复的 UUID：$scratch"
exit 1