---
name: write-research-ticket
description: >-
  把一个已经说得准的外部事实问题写成一张调研票。
  在某个决定被一件可核查事实挡住时使用。
  不核查事实，不决定做不做，不扩大范围。
---

# 写调研票

只建一张票。问题必须是目录之外的一个事实。问题里若夹着「要不要做」，停，改用 `write-grilling-ticket`。

在 `.scratch/需求工程/<努力>/issues/` 取下一个两位序号 `NN`，写入 `NN-<短名>.md`：

```markdown
Type: research
Status: open
Blocked by:

## Question

<要核查的那一个事实>
```

`Blocked by` 只填已经存在、且确实挡住这张票的序号；没有就空着。不写答案，不改地图正文。未关闭的票不记入 `Decisions so far`。
