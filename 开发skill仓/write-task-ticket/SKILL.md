---
name: write-task-ticket
description: >-
  把一件挡住决定的准备工作写成一张前置票。
  在没有东西要决定、要原型或要调研，但讨论必须等这件事做完时使用。
  不做那件准备工作，不交付目的地。
---

# 写前置票

只建一张票。这张票存在的理由是解开后面的决定，不是把目的地做出来。

在 `.scratch/需求工程/<努力>/issues/` 取下一个两位序号 `NN`，写入 `NN-<短名>.md`：

```markdown
Type: task
Status: open
Blocked by:

## Question

<必须先做完的那一件准备工作>
```

`Blocked by` 只填已经存在、且确实挡住这张票的序号；没有就空着。不写完成记录，不改地图正文。
