# HomeScape AI

> Conversational Home Design Engine / 对话式家装空间设计引擎

HomeScape AI 的目标不是做一个一次性生成效果图的 Demo，而是建立一套可持续演进的真实家装空间设计基础设施：

- 户型图 / 扫描数据转换为统一的 HomeSpatialModel
- 自然语言生成和连续修改可编辑设计方案
- AI 负责语义理解与结构化决策，确定性 Planner / Constraint Engine 负责真实执行
- 实时 3D 作为主要交互反馈，高质量渲染作为增强通道
- AI 能力按 Capability 解耦，JEV 可作为 typed decision 的主 Provider，但业务不绑定单一模型
- 所有设计修改通过 DesignOperation + Revision 可审计、可撤销、可回放

## 当前阶段

当前仓库处于 **Foundation / P0**：先搭建可长期演进的工程和领域边界，再实现第一个 Vertical Slice。

首个产品闭环目标：

> 真实户型图 → 恢复客厅/客餐厅 → 生成初始软装方案 → 自然语言连续修改 → 1~2 秒内更新实时 3D → Undo / Replay / Save。

## Monorepo

~~~text
apps/
├── web                 # React 交互层
└── api                 # Fastify API / orchestration

packages/
├── spatial-model       # 与渲染引擎无关的住宅空间真值
├── domain              # DesignOperation / Revision / Scope
├── ai-runtime          # Capability-oriented AI abstraction
├── planner             # Planner / constraint contract
└── renderer-contract   # 3D Runtime 适配边界
~~~

## 核心原则

1. **Domain State != Render Scene**：Babylon.js / Three.js 只是 View，不是业务真值。
2. **AI 提议，规则执行**：AI 产生受限 DesignOperation，不能直接随意改场景 JSON。
3. **业务依赖 Capability，不依赖 Vendor**：typed decision、vision、reasoning 等能力均可替换 Provider。
4. **整屋一体、Scope 聚焦**：Project → Floor → Room → Zone → Object。
5. **Revision First**：每一次 AI 或人工修改都有可追踪版本。
6. **真实约束优先**：商品尺寸、门窗、碰撞、动线、预算等由确定性系统校验。

## 本地启动

需要 Node.js 22+ 与 pnpm 10+。

~~~bash
corepack enable
pnpm install
pnpm dev
~~~

默认：

- Web: http://localhost:5173
- API: http://localhost:3001
- Health: http://localhost:3001/api/health

首次本地执行 pnpm install 后请提交生成的 pnpm-lock.yaml。

## 文档

- [架构设计](docs/ARCHITECTURE.md)
- [路线图](docs/ROADMAP.md)
- [ADR-0001：Monorepo 与领域边界](docs/adr/0001-monorepo-and-domain-boundaries.md)
- [ADR-0002：AI Capability Runtime](docs/adr/0002-ai-capability-runtime.md)
- [ADR-0003：渲染引擎解耦](docs/adr/0003-renderer-decoupling.md)
