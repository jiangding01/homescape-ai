# ADR-0010：Finalize 后切换为 Active HomeSpatialModel

- Status: Accepted for P1
- Date: 2026-09-21

## 决策

通过 Human Review 的 HomeSpatialModel 在 Finalize 后立即成为当前 Workbench 的 Active HomeSpatialModel。

Active Workspace 中以下状态必须引用同一个空间模型：

- DesignState.spatialModelId
- Planner input.spatialModel
- AI Context activeRoom
- RenderSnapshot.spatialModel
- 2D Debug View
- Babylon Runtime

## 模型切换

空间模型切换属于 Workspace Reset，不执行旧 DesignState 的自动迁移。

原因是旧对象携带的 Room / Zone ID、位置、约束结果都建立在旧几何上。未经显式迁移算法直接复用会破坏空间正确性。

因此切换时：

1. 更新 Active HomeSpatialModel；
2. 创建新的空 DesignState；
3. 创建新的 Revision Timeline；
4. 清空 Planner / AI 派生反馈；
5. 重新选择默认 Active Room；
6. 重新生成 RenderSnapshot。

## Active Room

P1 默认策略为：

living → dining → 面积最大的 room。

该策略是确定性的，只用于给 Vertical Slice 一个默认编辑上下文。后续应加入用户显式 Room / Zone Focus。

## 异步安全

Planner 调用记录 workspace epoch。

只有 epoch、spatialModelId 和 revision head 都仍匹配时，Planner 结果才允许提交。

这避免旧空间上的异步结果污染刚切换的新空间。

## UI Gate

Import Review 在 AI Interpretation 或 Planner 执行期间禁用 Finalize。

UI Gate 不是唯一安全措施；Runtime epoch check 仍必须存在。

## 非目标

本 ADR 不定义跨户型 DesignState Migration。未来如果支持“换户型保留方案”，必须设计显式的对象重定位与约束重新求解流程。
