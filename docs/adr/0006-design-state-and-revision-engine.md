# ADR-0006：Design State 与 Revision Engine

- Status: Accepted
- Date: 2026-09-21

## 决策

HomeScape 使用 Domain 层的 DesignState 作为设计结果的权威状态，并使用不可变 Revision 记录每一次被接受的修改。

AI 输出的 DesignOperation 不是最终状态修改。经过 Schema、Catalog、Planner 和 Constraint 解析后，产生 ResolvedDesignMutation，只有 Mutation 可以写入 DesignState。

~~~text
User / AI Request
      ↓
DesignOperation
      ↓
Planner / Domain Resolver
      ↓
ResolvedDesignMutation[]
      ↓
Revision Engine
      ↓
DesignState
      ↓
RenderSnapshot
~~~

## DesignState

首批状态包括：

- objects
- materials
- styleIntents
- locks
- headRevisionId
- state version

HomeSpatialModel 仍然独立保存住宅几何真值。DesignState 只保存设计层叠加内容。

## Revision

Committed Revision 同时记录：

- 原始 DesignOperation
- 最终 ResolvedDesignMutation
- inverseMutations
- parentRevisionId
- stateVersionBefore / stateVersionAfter
- provenance

inverseMutations 在 Commit 时基于提交前状态生成，因此 Undo 与正常 Mutation 使用同一个执行器，不依赖 UI Store 快照。

## 并发控制

RevisionDraft 必须提供 expectedParentRevisionId。

如果客户端基于旧 Revision 修改，而服务器 head 已前进，则提交失败，由上层决定重新解释、rebase 或要求用户确认。

## Lock 与 Preserve

Lock 是持久化 Domain State，阻止后续 Mutation 修改目标。

Preserve 属于单次 DesignOperation / Planner 约束，不写入长期 Lock。这样“这次电视柜别动”和“锁定电视柜以后都不要动”语义不会混淆。

## Renderer 边界

Renderer Contract 不再依赖 Planner 类型。

DesignState 通过 createRenderSnapshot 转成纯 RenderObject，Renderer 继续只消费快照，不获得 Revision 写权限。
