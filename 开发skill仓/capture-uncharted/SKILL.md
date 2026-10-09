---
name: capture-uncharted
description: >-
  把一条需求写入 .scratch/需求工程/inbox.md 的待处理、正在处理或处理完成。
  在暂存尚未开图的需求、开始处理一条需求，或一条需求处理完成时使用。
  不建地图，不建票，不决定做不做，不分流。
disable-model-invocation: true
---

# 暂存需求

一次只动一条。同一时间仅能存在一个正在处理的需求。文件是 `.scratch/需求工程/inbox.md`。不存在就创建，并写上下面三节。三节都保留，空着也留标题。

```markdown
# 需求暂存

## 待处理需求

## 正在处理的需求

## 处理完成的需求
```

一条的格式。需求 UUID 写在正文，不放进路径：

```markdown
- YYYY-MM-DD · 来源 · <需求名称。待处理时还没有可以省略；进入正在处理前必须写下。>
  需求 UUID：<由 add-requirement.ps1 写入。移动、改名都不更换。>
  当前需求被 <前提需求的需求 UUID；没有则空着> 阻塞
  原话或观察到的能力。它看起来像哪一件工作。
```

来源写人的原话，或产品名加观察到的做法。不写决定，不写验收，不把没人表态的项标成放弃。每一条都写「当前需求被 <需求 UUID> 阻塞」。有多条前提就写多行。没有前提时也保留这一行，写成「当前需求被 阻塞」。前提必须是另一条需求的需求 UUID。移动时这些行保留。

查看和改动 `inbox.md` 都运行本技能目录下的脚本，工作目录参数用当前仓库根目录。不手改这个文件。脚本按三节和条目里的 `需求 UUID：` 读写。新条目的需求 UUID 由 `add-requirement.ps1` 调用 `scripts/new-uuid.ps1` 取得，不要自行另造。

- 查看：`scripts/get-requirements.ps1 -Status 待处理`。状态换成 `正在处理` 或 `处理完成` 即查看另外两节。没有条目时输出「（无）」，这只是输出，不写入文件。
- 追加：`scripts/add-requirement.ps1 -Status 待处理 -Source <来源> -Body <原话或能力> [-Name <需求名称>] [-BlockedBy <前提需求的需求 UUID>]`。状态也可以是 `正在处理`。多个前提就重复 `-BlockedBy`。
- 开始处理已有的一条：`scripts/start-requirement.ps1 -RequirementUuid <需求 UUID> -Name <需求名称>`。需求名称在这一步确定。条目上已有名称时可以不重复传入。`.scratch/需求工程/<需求名称>/` 若已属于另一条需求，更换名称后再开始。前提尚未处理完成时，脚本停下，不移入正在处理。
- 退回待处理：`scripts/return-to-pending.ps1`。可再加 `-RequirementUuid <需求 UUID>`。不标成处理完成。
- 处理完成：`scripts/complete-requirement.ps1`。可再加 `-RequirementUuid <需求 UUID>`，用来核对是不是正在处理的那一条。

## 步骤

1. 调用方给出一条要暂存的需求时，运行 `add-requirement.ps1 -Status 待处理`。
2. 开始处理这一条：需求名称在这里确定。已有需求 UUID 时运行 `start-requirement.ps1`，并传入 `-Name`。条目上已有名称时可以不重复传入。脚本若发现正在处理的已是这一条，保持不动；若在待处理，则移到正在处理，需求 UUID 不变；若正在处理的是另一条，停下。没有需求名称，或该名称的目录已属于另一条需求时，停下。前提里有尚未处理完成的需求 UUID 时，停下，不开始这一条。还没有条目时，运行 `add-requirement.ps1 -Status 正在处理 -Name <需求名称>`。已有前提就传 `-BlockedBy`。
3. 调用方说明这一条处理完成之后，运行 `complete-requirement.ps1`。脚本把正在处理的那一条移到处理完成，需求 UUID 不变。本技能不判断它是否已经处理完成。正在处理为空，或不止一条时，脚本停下。

不删除「处理完成的需求」里的条目。不建地图，不开图，不建票。不判断这条需求属于哪件工作，不分流，不调用 `place-candidate`。
