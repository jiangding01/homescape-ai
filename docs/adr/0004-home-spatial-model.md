# ADR-0004：HomeSpatialModel 作为住宅空间真值

- Status: Accepted
- Date: 2026-09-21

## 决策

HomeScape AI 使用自有 HomeSpatialModel 作为住宅几何、拓扑与结构语义的 Source of Truth，而不是直接使用 Babylon.js / Three.js Scene Graph、IFC、USD 或某一种户型识别服务的输出格式。

Canonical 约定：

- 长度单位：meter
- 坐标系：right-handed
- Up axis：+Y
- 所有 Floor 位于同一住宅世界坐标系
- Room Connection 显式表示空间拓扑
- Room 内允许继续划分 Zone
- 每个可识别实体允许携带 provenance / confidence

## 原因

输入来源会长期保持多样：

- 公司已有户型数据
- 户型图片 / PDF
- CAD
- Apple RoomPlan
- 手机视频扫描
- 人工校正

任何一种来源都不能成为业务协议本身。统一模型使 Planner、Constraint、Renderer、AI Scope 与 Revision 可以稳定工作。

## 校验原则

导入结果必须经过统一 validation。无法可靠确定的信息不伪造确定值，而进入 unresolved issue，并通过 confidence 和人工校正流程解决。

## 格式边界

- GLB / glTF：实时资产与 Runtime 交换
- OpenUSD：高质量 DCC / 渲染流程
- IFC：BIM 交换
- HomeSpatialModel：HomeScape 业务空间真值
