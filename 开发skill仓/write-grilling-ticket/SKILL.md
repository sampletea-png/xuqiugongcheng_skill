---
name: write-grilling-ticket
description: >-
  把一个只有人能拍板的问题写成一张拷问票。
  在范围、深浅或取舍已经能说成一个问题时使用。
  不代替人选择，不核查外部事实，不写规格。
---

# 写拷问票

只建一张票。问题要让人在候选项里定深浅、范围或取舍。事实本身还没查清时，停，改用 `write-research-ticket`。

在 `.scratch/需求工程/<努力>/issues/` 取下一个两位序号 `NN`，写入 `NN-<短名>.md`：

```markdown
Type: grilling
Status: open
Blocked by:

## Question

<人要拍板的那一个问题>
```

`Blocked by` 只填已经存在、且确实挡住这张票的序号；没有就空着。不写推荐答案，不改地图正文。
