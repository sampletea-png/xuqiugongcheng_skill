---
name: resolve-grilling-ticket
description: >-
  把人已经做出的选择写入一张拷问票并关闭，在地图已决里留一行。
  在拷问票已被领取且人已表态时使用。
  人不在场时不结案，不把推荐写成决定。
---

# 关闭拷问票

只处理 `Type: grilling` 且 `Status: claimed` 的一张票。未领取就停，先用 `claim-ticket`。

当前对话里还没有人的选择时：先给出候选项，只问这一个问题，然后停。不写 `Answer`，不改状态。

已有选择时：

1. `Answer` 只记人选定的那一档，不把未选项补成已接受。
2. 把 `Status` 改成 `resolved`。
3. 在 `map.md` 的 `Decisions so far` 追加一行：`- [<票的短名>](issues/<文件名>)：<人的选择>`。

不修改目的地、雾区和范围之外。新冒出的说不清事项交给 `update-fog`。
