# HomeScape AI

> Conversational Home Design Engine / 对话式家装空间设计引擎

HomeScape AI 从真实住宅空间出发，把自然语言转换为受限、可验证、可撤销的设计操作，再由确定性 Catalog / Planner / Constraint 系统生成可执行设计状态和实时 3D。

## 当前核心链路

~~~text
Real Floor Plan
→ Candidate + Human Review
→ Final HomeSpatialModel
→ Active Workspace
→ Natural Language
→ AI Capability Runtime
→ DesignOperation[]
→ Catalog + Planner
→ Revision
→ DesignState
→ Render Asset Resolver
→ glTF / GLB Realtime 3D
~~~

AI 不直接修改 Scene，也不直接写 DesignState。

## Monorepo

~~~text
apps/
├── web                     # React 交互层 / 3D Workbench
└── api                     # Fastify / server-side AI orchestration

packages/
├── spatial-model           # 住宅空间真值
├── domain                  # DesignState / Operation / Revision
├── catalog                 # SKU / dimensions / placement rules
├── planner                 # Rule + Anchor + Constraint + Scoring
├── ai-runtime              # Capability abstraction + JEV Provider
├── design-intelligence     # 家装自然语言 → DesignOperation
├── renderer-contract       # Renderer 边界
└── renderer-babylon        # Babylon.js P1 Adapter
~~~

## 本地启动

需要 Node.js 22+ 与 pnpm 10+。

~~~bash
corepack enable
pnpm install
cp .env.example .env
pnpm dev
~~~

Web: http://localhost:5173  
API: http://localhost:3001

### 自然语言设计

JEV 通过 API 服务端调用。把 TypeSafe Key 配置到本地 .env：

~~~bash
TYPESAFE_API_KEY=your_key_here
TYPESAFE_MODEL=jev-latest
~~~

不要使用 VITE_TYPESAFE_API_KEY，也不要把 Key 放到浏览器存储或前端代码中。

如果没有配置 Key，空间、Catalog、Planner、Revision 与 3D 仍可运行，但 /api/design/interpret 会返回 AI_NOT_CONFIGURED。

## 核心原则

1. HomeSpatialModel 是住宅空间真值，DesignState 是设计真值，Render Scene 只是 View。
2. AI 只提出语义决策和 DesignOperation；Planner / Constraint 决定是否可执行。
3. 业务依赖 AI Capability，不依赖 Vendor。
4. JEV 当前实现 typed_decision，但可以被其他 Provider 替换或进入 Shadow Evaluation。
5. Lock、碰撞、商品尺寸、门洞净空和 Revision 不能被 AI 绕过。
6. 所有可接受的修改都必须可 Undo / Redo / Replay / Audit。

## 当前阶段

已完成 Foundation、HomeSpatialModel、参数化 3D、Design State / Revision、Catalog / Planner、自然语言 Decision Runtime、Real Floor Plan + Active Workspace，以及 glTF / GLB Render Asset Runtime。

CatalogAsset 现在可以携带标准化视觉资产 Manifest；RenderSnapshot 通过 assetId 解析视觉模型，Babylon 使用 AssetContainer 缓存与实例化。模型加载失败时会按照 Catalog 真实尺寸降级为几何代理，因此视觉资产故障不会破坏 Planner 或 Revision。

仓库内的 7 个 glTF 是标准化 Pipeline Fixture，用于验证真实模型加载链路，不代表公司生产 SKU。

下一阶段：Production Asset Ingestion，把公司真实 SKU 接入离线 Geometry QA、LOD、Meshopt / KTX2 与版本发布流水线。

目标闭环：

> 真实户型图 → HomeSpatialModel → 客厅方案 → 自然语言连续修改 → 实时 3D → Undo / Replay / Save。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [路线图](docs/ROADMAP.md)
- [ADR](docs/adr/)
