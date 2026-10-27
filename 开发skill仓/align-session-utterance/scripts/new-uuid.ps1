# 打印一个尚未占用的 UUID。
# 只读 .scratch 下 Markdown 文件里、第一个二级标题之前的 UUID 字段，不在正文里搜索。
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File new-uuid.ps1 -Workspace <仓库根目录>

param(
    [string]$Workspace = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$uuid = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
$fieldLine = "^\s*(需求 UUID|对齐 UUID|会话 UUID)\s*[：:]\s*($uuid)\s*$"
$seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

function Read-Text {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }
    return Get-Content -LiteralPath $Path -Raw -ErrorAction SilentlyContinue
}

function Add-FieldLines {
    param([string]$Text)
    if ([string]::IsNullOrEmpty($Text)) {
        return
    }
    foreach ($line in ($Text -split "\r?\n")) {
        $match = [regex]::Match($line, $fieldLine)
        if ($match.Success) {
            [void]$seen.Add($match.Groups[2].Value.ToLowerInvariant())
        }
    }
}

$scratch = Join-Path $Workspace ".scratch"
if (Test-Path -LiteralPath $scratch) {
    Get-ChildItem -LiteralPath $scratch -Recurse -File -Filter *.md | ForEach-Object {
        $text = Read-Text $_.FullName
        if ([string]::IsNullOrEmpty($text)) {
            return
        }
        $header = ($text -split "\r?\n##\s", 2)[0]
        Add-FieldLines $header
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
