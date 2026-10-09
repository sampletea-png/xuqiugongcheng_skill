---
name: write-prototype-ticket
description: >-
  把一个要看见才定得了的外观或行为问题写成一张原型票。
  在「长什么样」或「怎么表现」已经能说成一个问题时使用。
  不制作原型，不代替人选择。
---

# 写原型票

只建一张票。问题必须是看过粗糙产物才能定的外观或行为。纯属取舍且不必看见时，停，改用 `write-grilling-ticket`。

在 `.scratch/需求工程/<努力>/issues/` 取下一个两位序号 `NN`，写入 `NN-<短名>.md`：

```markdown
Type: prototype
Status: open
Blocked by:

## Question

<要看见才定得了的那一个问题>
```

`Blocked by` 只填已经存在、且确实挡住这张票的序号；没有就空着。不在票里画原型，不改地图正文。
