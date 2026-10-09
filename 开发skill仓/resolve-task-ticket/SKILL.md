---
name: resolve-task-ticket
description: >-
  记下前置票已经做完的事和由此产生的事实，然后关闭。
  在准备工作完成时使用。
  不把这项准备写成目的地的交付。
---

# 关闭前置票

只处理 `Type: task` 且 `Status: claimed` 的一张票。未领取就停，先用 `claim-ticket`。准备工作还没做完就停，不关闭。

追加：

```markdown
## Answer

做了什么：<完成的准备>
产生的事实：<后面票要用的位置、地址、数量或其他事实>
```

把 `Status` 改成 `resolved`。在 `Decisions so far` 追加一行，只摘要产生的事实。不改目的地，不新增功能。
