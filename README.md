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
├── asset-pipeline          # Production Asset Ingestion / Geometry QA
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

已完成 Foundation、HomeSpatialModel、参数化 3D、Design State / Revision、Catalog / Planner、自然语言 Decision Runtime、Real Floor Plan + Active Workspace、glTF / GLB Runtime，以及 Production Asset Ingestion / Geometry QA Gate。

生产资产现在通过独立 Manifest 进入离线检查：模型 World Bounds 会和 Catalog 尺寸比对，同时检查 Pivot、三角面、文件/纹理预算、LOD、Meshopt/KTX2 与自包含 GLB 策略；整批资产只有全部通过后才生成可激活 Release Manifest。

仓库内的 7 个 glTF 仍然只是 Pipeline Fixture，不代表公司生产 SKU。PR #10 也没有伪造 FBX/OBJ/USD 转换或 Meshopt/KTX2 编码能力，这些保留为后续 Processor Adapter。

今天的开发停在 PR #10。下一次继续时，优先进入真实户型 Extractor Benchmark。

目标闭环：

> 真实户型图 → HomeSpatialModel → 客厅方案 → 自然语言连续修改 → 实时 3D → Undo / Replay / Save。

## 资产入库

~~~bash
pnpm asset:check-demo

pnpm asset:ingest tools/fixtures/asset-ingestion/demo-release.json --out .asset-release
~~~

Production Policy 示例见 tools/fixtures/asset-ingestion/production-policy.example.json。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [资产流水线](docs/ASSET_PIPELINE.md)
- [路线图](docs/ROADMAP.md)
- [ADR](docs/adr/)
