# 按 inbox.md 的三节和条目字段读写。由同目录下的脚本点用，不要直接运行。

$script:InboxSections = @("待处理需求", "正在处理的需求", "处理完成的需求")
$script:StatusToSection = @{
    "待处理" = "待处理需求"
    "正在处理" = "正在处理的需求"
    "处理完成" = "处理完成的需求"
    "待处理需求" = "待处理需求"
    "正在处理的需求" = "正在处理的需求"
    "处理完成的需求" = "处理完成的需求"
}

function Resolve-RequirementStatus {
    param([string]$Status)
    if (-not $script:StatusToSection.ContainsKey($Status)) {
        throw "状态只能是待处理、正在处理或处理完成。"
    }
    return $script:StatusToSection[$Status]
}

function Get-InboxPath {
    param([string]$Workspace)
    return (Join-Path $Workspace ".scratch\需求工程\inbox.md")
}

function Read-InboxText {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) {
        return ""
    }
    $encoding = New-Object System.Text.UTF8Encoding $false
    return [System.IO.File]::ReadAllText($Path, $encoding)
}

function New-InboxBuckets {
    $buckets = [ordered]@{}
    foreach ($name in $script:InboxSections) {
        $buckets[$name] = New-Object System.Collections.Generic.List[object]
    }
    return $buckets
}

function ConvertTo-InboxEntry {
    param([string[]]$Lines)
    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($line in $Lines) {
        $kept.Add($line)
    }
    while ($kept.Count -gt 0 -and [string]::IsNullOrWhiteSpace($kept[$kept.Count - 1])) {
        $kept.RemoveAt($kept.Count - 1)
    }
    if ($kept.Count -eq 0) {
        return $null
    }
    $bullet = $kept[0]
    $date = ""
    $source = ""
    $name = ""
    $matched = [regex]::Match($bullet, "^- (\d{4}-\d{2}-\d{2}) · (.*)$")
    if ($matched.Success) {
        $date = $matched.Groups[1].Value
        $parts = $matched.Groups[2].Value -split " · ", 2
        $source = $parts[0].Trim()
        if ($parts.Count -gt 1) {
            $name = $parts[1].Trim()
        }
    }
    $uuid = ""
    $blockedBy = New-Object System.Collections.Generic.List[string]
    $bodyLines = New-Object System.Collections.Generic.List[string]
    $uuidPattern = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
    for ($i = 1; $i -lt $kept.Count; $i++) {
        $field = [regex]::Match($kept[$i], "^\s*需求 UUID\s*[：:]\s*($uuidPattern)\s*$")
        if ($field.Success -and [string]::IsNullOrEmpty($uuid)) {
            $uuid = $field.Groups[1].Value.ToLowerInvariant()
            continue
        }
        $blocked = [regex]::Match($kept[$i], "^\s*当前需求被(?:\s+($uuidPattern))?\s+阻塞\s*$")
        if ($blocked.Success) {
            if ($blocked.Groups[1].Success) {
                $blockedId = $blocked.Groups[1].Value.ToLowerInvariant()
                if (-not $blockedBy.Contains($blockedId)) {
                    $blockedBy.Add($blockedId)
                }
            }
            continue
        }
        $bodyLines.Add(($kept[$i] -replace "^\s{2}", ""))
    }
    return [pscustomobject]@{
        Date = $date
        Source = $source
        Name = $name
        Uuid = $uuid
        BlockedBy = $blockedBy.ToArray()
        Body = (($bodyLines.ToArray()) -join "`n").Trim()
        Bullet = $bullet
    }
}

function Import-Inbox {
    param([string]$Text)
    $buckets = New-InboxBuckets
    if ([string]::IsNullOrEmpty($Text)) {
        return $buckets
    }
    $section = ""
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($line in ($Text -split "\r?\n")) {
        $heading = [regex]::Match($line, "^##\s+(.+?)\s*$")
        if ($heading.Success) {
            if ($section -and $lines.Count -gt 0) {
                $entry = ConvertTo-InboxEntry @($lines.ToArray())
                if ($null -ne $entry) { $buckets[$section].Add($entry) }
            }
            $lines.Clear()
            $name = $heading.Groups[1].Value
            if ($buckets.Contains($name)) { $section = $name } else { $section = "" }
            continue
        }
        if (-not $section) { continue }
        if ($line -match "^- ") {
            if ($lines.Count -gt 0) {
                $entry = ConvertTo-InboxEntry @($lines.ToArray())
                if ($null -ne $entry) { $buckets[$section].Add($entry) }
                $lines.Clear()
            }
            $lines.Add($line)
            continue
        }
        if ($lines.Count -gt 0 -and $line -match "^\s+\S") {
            $lines.Add($line)
            continue
        }
        if ([string]::IsNullOrWhiteSpace($line) -and $lines.Count -gt 0) {
            $entry = ConvertTo-InboxEntry @($lines.ToArray())
            if ($null -ne $entry) { $buckets[$section].Add($entry) }
            $lines.Clear()
        }
    }
    if ($section -and $lines.Count -gt 0) {
        $entry = ConvertTo-InboxEntry @($lines.ToArray())
        if ($null -ne $entry) { $buckets[$section].Add($entry) }
    }
    return $buckets
}

function Format-InboxEntry {
    param($Entry)
    if ([string]::IsNullOrWhiteSpace($Entry.Date) -or [string]::IsNullOrWhiteSpace($Entry.Uuid)) {
        throw "条目缺少日期或需求 UUID，无法按结构写回。"
    }
    if ([string]::IsNullOrWhiteSpace($Entry.Name)) {
        $head = "- $($Entry.Date) · $($Entry.Source)"
    } else {
        $head = "- $($Entry.Date) · $($Entry.Source) · $($Entry.Name)"
    }
    $out = New-Object System.Collections.Generic.List[string]
    $out.Add($head)
    $out.Add("  需求 UUID：$($Entry.Uuid)")
    $blockedBy = @()
    if ($null -ne $Entry.BlockedBy) {
        $blockedBy = @($Entry.BlockedBy)
    }
    $wroteBlock = $false
    foreach ($blockedId in $blockedBy) {
        if (-not [string]::IsNullOrWhiteSpace($blockedId)) {
            $out.Add("  当前需求被 $($blockedId.ToLowerInvariant()) 阻塞")
            $wroteBlock = $true
        }
    }
    if (-not $wroteBlock) {
        $out.Add("  当前需求被 阻塞")
    }
    if (-not [string]::IsNullOrWhiteSpace($Entry.Body)) {
        foreach ($line in ($Entry.Body -split "\r?\n")) {
            $out.Add("  $($line.Trim())")
        }
    }
    return ($out.ToArray() -join "`n")
}

function Format-Inbox {
    param($Buckets)
    $parts = New-Object System.Collections.Generic.List[string]
    $parts.Add("# 需求暂存")
    $parts.Add("")
    foreach ($name in $script:InboxSections) {
        $parts.Add("## $name")
        $parts.Add("")
        foreach ($entry in $buckets[$name]) {
            $parts.Add((Format-InboxEntry $entry))
            $parts.Add("")
        }
    }
    return (($parts.ToArray() -join "`n").TrimEnd() + "`n")
}

function Save-Inbox {
    param([string]$Workspace, $Buckets)
    $path = Get-InboxPath $Workspace
    $parent = Split-Path -Parent $path
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
    $encoding = New-Object System.Text.UTF8Encoding $true
    [System.IO.File]::WriteAllText($path, (Format-Inbox $Buckets), $encoding)
}

function Load-Inbox {
    param([string]$Workspace)
    return Import-Inbox (Read-InboxText (Get-InboxPath $Workspace))
}

function Test-RequirementDirectory {
    param([string]$Workspace, [string]$Name, [string]$Uuid)
    if ([string]::IsNullOrWhiteSpace($Name)) {
        throw "正在处理的需求必须有需求名称。"
    }
    $dir = Join-Path (Join-Path $Workspace ".scratch\需求工程") $Name
    if (-not (Test-Path -LiteralPath $dir)) {
        return
    }
    $meta = Join-Path $dir "需求.md"
    if (Test-Path -LiteralPath $meta) {
        $encoding = New-Object System.Text.UTF8Encoding $false
        $text = [System.IO.File]::ReadAllText($meta, $encoding)
        $found = [regex]::Match($text, "(?m)^需求 UUID\s*[：:]\s*([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$")
        if ($found.Success -and $found.Groups[1].Value.ToLowerInvariant() -eq $Uuid.ToLowerInvariant()) {
            return
        }
    }
    throw "需求名称的目录已存在：$Name"
}

function Get-UnfinishedBlockers {
    param($Buckets, $Entry)
    $pending = New-Object System.Collections.Generic.List[string]
    $blockedBy = @()
    if ($null -ne $Entry.BlockedBy) {
        $blockedBy = @($Entry.BlockedBy)
    }
    foreach ($blockedId in $blockedBy) {
        if ([string]::IsNullOrWhiteSpace($blockedId)) {
            continue
        }
        $id = $blockedId.ToLowerInvariant()
        $hit = Find-InboxEntry $Buckets $id
        if ($null -eq $hit -or $hit.Section -ne "处理完成的需求") {
            $pending.Add($id)
        }
    }
    return $pending.ToArray()
}

function Find-InboxEntry {
    param($Buckets, [string]$Uuid)
    $id = $Uuid.ToLowerInvariant()
    $hits = New-Object System.Collections.Generic.List[object]
    foreach ($name in $script:InboxSections) {
        for ($i = 0; $i -lt $buckets[$name].Count; $i++) {
            if ($buckets[$name][$i].Uuid -eq $id) {
                $hits.Add([pscustomobject]@{ Section = $name; Index = $i; Entry = $buckets[$name][$i] })
            }
        }
    }
    if ($hits.Count -gt 1) {
        throw "需求 UUID 在 inbox.md 里出现了多次：$id"
    }
    if ($hits.Count -eq 0) {
        return $null
    }
    return $hits[0]
}