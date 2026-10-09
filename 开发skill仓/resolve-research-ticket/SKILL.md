---
name: resolve-research-ticket
description: >-
  核查一张调研票里的那一个事实，带来源后关闭，并在地图已决里留一行。
  在调研票已被领取、需要结案时使用。
  不决定做不做，不把事实写成新功能。
---

# 关闭调研票

只处理 `Type: research` 且 `Status: claimed` 的一张票。未领取就停，先用 `claim-ticket`。

1. 只核查票面那一个事实。用一手来源，并为结论写下出处。
2. 查清后追加：

```markdown
## Answer

<事实>
来源：<出处>
```

3. 把 `Status` 改成 `resolved`。
4. 在同一次努力的 `map.md` 的 `Decisions so far` 追加一行：`- [<票的短名>](issues/<文件名>)：<一句事实>`。

问题实际上要人拍板时，不要写答案，改请 `write-grilling-ticket`。不修改 `Destination`、`Not yet specified` 或 `Out of scope`。
