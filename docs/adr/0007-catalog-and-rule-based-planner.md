# ADR-0007：Catalog 与 Rule-based Planner

- Status: Accepted for P1
- Date: 2026-09-21

## 决策

P1 使用结构化 Catalog + Rule-based Planner，将 DesignOperation 转换为满足基础空间约束的 ResolvedDesignMutation。

不让 AI 直接输出最终坐标，也不在第一阶段直接引入 CP-SAT。

~~~text
DesignOperation
      ↓
Structured Catalog Filter
      ↓
Anchor Candidate Generation
      ↓
Hard Constraint Validation
      ↓
Soft Scoring
      ↓
ResolvedDesignMutation
~~~

## Catalog

CatalogAsset 首批包含：

- sku / category / name
- width / height / depth
- variants
- style tags
- price
- placement anchors
- wall clearance
- collision padding
- structured attributes

当前 fixture 是 Mock SKU，但 Contract 面向真实商品库。

商品检索必须先执行结构化硬过滤：品类、尺寸、座位数、价格、颜色等。未来 Embedding / Rerank 只参与软语义排序，不能替代硬约束。

## Placement Anchors

P1 提供三类 Anchor：

- wall：沿房间墙体生成候选
- center：围绕 Room / Zone 中心生成候选
- free：在边界包围盒内生成自由候选

候选始终回到真实 Room / Zone Polygon 验证，不能因为 Anchor 合理就直接落位。

## Hard Constraints

首批约束：

- 家具 footprint 必须位于目标 Room / Zone
- 家具之间不能重叠
- 不能与结构柱重叠
- Door / Opening 需要保留基础净空
- Lock / Preserve 目标不能被 Planner 修改

P1 使用 2D OBB + SAT 做家具 footprint 碰撞。复杂施工约束后续单独演进。

## Replace

Replace 优先尝试保留原位置与朝向。若新商品尺寸不适配，再生成新的 Anchor 候选。

这使“沙发小一点，其他地方别动”更符合用户预期。

## 后续升级条件

当以下情况出现时再引入 CP-SAT / 更复杂求解：

- 多家具强组合依赖
- 离散商品组合爆炸
- 跨空间联合规划
- 大量相互排斥约束
- Rule + Candidate Scoring 无法稳定找到可行解
