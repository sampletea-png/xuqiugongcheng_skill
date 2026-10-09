---
name: resolve-prototype-ticket
description: >-
  为一张原型票做出能回答该问题的最便宜原型，并在人表态后关闭。
  在原型票已被领取时使用。
  人还没看过或还没表态时不结案。
---

# 关闭原型票

只处理 `Type: prototype` 且 `Status: claimed` 的一张票。未领取就停，先用 `claim-ticket`。

1. 做一个能回答票面问题的粗糙原型，可以是大纲、草稿或可点击的草图。
2. 在票里链上原型，不把大段产物贴进正文。
3. 人还没对原型表态时，停下。
4. 人表态后写 `Answer`，把 `Status` 改成 `resolved`，并在 `Decisions so far` 追加一行摘要和链接。

代理人觉得哪版更好，不能当作答案。
