---
name: claim-ticket
description: >-
  领取一张未被挡住、尚未领取的决策票，把状态改成 claimed。
  在开始核查、拷问、做原型或做准备之前使用。
  不回答问题，不改地图。
---

# 领取一张票

一次只领取一张。读取 `.scratch/需求工程/<努力>/issues/` 里要领的那张票。

以下情况停下，不改文件：

- `Status` 已是 `claimed` 或 `resolved`
- `Blocked by` 里还有不是 `resolved` 的票

可以领取时，只把 `Status` 改成 `claimed`，然后停。答案、原型和地图索引都不是这一步的事。
