---
name: open-rough-map
description: >-
  从一句粗诉求做初始调研，划出粗边界并写成地图。
  在已经有一条正在处理的需求，并要求粗开图时使用。
  不做精细功能调研，不建票，不决定第一版做到哪一档。
disable-model-invocation: true
---

# 粗开图

一句粗诉求是起点。开图是这次需求工程的正式起点。一个工作区不同时进行多次开图。本技能写下地图。初始调研和粗边界由 `research-rough-boundary` 完成。图形如何展示、数据如何交互，留给 `open-fine-map`。

## 步骤

1. 运行本技能目录下的 `scripts/init-requirement-dir.ps1`，工作目录参数用当前仓库根目录。脚本读取 `capture-uncharted` 里正在处理的那一条。需求名称和需求 UUID 必须已经写在那里。本技能不另起需求名称，也不另生成需求 UUID。脚本停下时，本技能停下。
2. 先分辨任务，再对齐这份分辨。用 `align-utterance` 确认三件事：分辨出的任务是不是用户期望的，有没有理解错，哪一条优先处理。原话保留。重述只写这三件事。没有该次对齐的 `结论.md` 之前，不追加待处理，也不做下一步对齐。本技能不代替它做复述或术语对齐。
3. 按已确认的结论处理。优先的一条留在或改为正在处理。若它不是当前正在处理的那一条，先运行 `capture-uncharted` 的 `scripts/return-to-pending.ps1` 把当前这条退回待处理，再开始处理优先的那一条，然后重新运行 `scripts/init-requirement-dir.ps1`。其余任务各追加为待处理，一次一条。
4. 再对齐当前正在处理的这件工作。使用 `align-utterance`，把对齐写进 `.scratch/需求工程/<需求名称>/对齐/<对齐名称>/`。没有该次对齐的 `结论.md` 之前，不进入后面的步骤。本技能不代替它做复述或术语对齐。
5. 写下这条需求的需求简述。需求简述来自已确认的结论，写入 `.scratch/需求工程/<需求名称>/简述.md`。文件以 `需求 UUID：` 一行开头，下面写简述。
6. 使用 `research-rough-boundary` 做初始调研并请人确认粗边界。本技能不代替它写两份材料，也不代替它提出粗边界。它交回的、与当前需求无关或当前不便处理的事项，先按步骤 2 对齐这份分辨，确认后再调用 `capture-uncharted` 追加进「待处理需求」，一次一条。`粗边界.md` 状态不是已确认时，不写地图。
7. `粗边界.md` 已确认之后写地图。`Destination` 使用确认一节。`这一步说不细` 写入 `Not yet specified`。只有人在确认里明确放下的，才写入 `Out of scope`。
8. 地图写好，开图结束。运行本技能目录下的 `scripts/enqueue-unspecified.ps1 -RequirementName <需求名称>`，工作目录参数用当前仓库根目录。脚本只读 `map.md` 的 `Not yet specified`，把每一行交给 `capture-uncharted` 追加为待处理需求。地图上的这些行保留。这一节没有内容时，脚本输出「（无）」。

## 地图

人确认粗边界之后，创建 `.scratch/需求工程/<需求名称>/map.md`。目录用需求名称。`Decisions so far` 保持为空。写完后执行步骤 8。

```markdown
## 需求 UUID

<写在本文件。由 `capture-uncharted` 分配。改需求名称时不变。不是对齐 UUID。>

## 需求名称

<正在处理的那一条上已有的需求名称。也是本目录名。>

## 需求简述

<这条需求是什么。与需求简述相同。>

## Destination

<确认后的一件工作，以及软件辅助的粗边界。不写精细交互。>

## Notes

<从工作里直接认出的名词。>

## Decisions so far

## Not yet specified

<属于这件工作、但这一步说不细的事项。>

## Out of scope

<人明确放到这件工作之外的事项。没表态则空着。>
```

## 示例

原话：「我期望实现小说编辑器」。

`research-rough-boundary` 写下工作流和竞品两份材料，并请人确认粗边界。人物表、情节顺序若是工作里已经依赖的做法，可以出现在确认后的粗边界里。章内格式、图示如何交互，不在这一步研究。

确认后的 `.scratch/需求工程/小说编辑器/map.md`：

```markdown
## 需求 UUID

7f3a9c2e-4b18-4d6a-9c0e-1a2b3c4d5e6f

## 需求名称

小说编辑器

## 需求简述

一位作者用来写一部小说的工具。

## Destination

一位作者写一部小说。软件辅助正文的撰写，以及写作时查阅这部小说自己的人物与情节。

## Notes

小说、正文、人物、情节

## Decisions so far

## Not yet specified

人物与情节以何种形式查阅。

## Out of scope
```

## 不做

- 不把已有目录当作同一次开图。
- 不研究图形如何展示、数据如何交互。
- 不建票，不写规格，不关闭决定。
- 不代替 `research-rough-boundary` 做初始调研或提出粗边界。
- 调用 `align-utterance`、`capture-uncharted` 和 `research-rough-boundary`。除此之外不调用其他技能。

目的确认之后，精细功能由 `open-fine-map` 再调研。本技能不调用它。
