# HomeScape AI Architecture v0.6

## 1. 当前产品闭环

HomeScape 当前核心链路：

~~~text
Natural Language / GUI
        ↓
AI Capability Runtime
        ↓
Design Intelligence
        ↓
DesignOperation[]
        ↓
Structured Catalog
        ↓
Rule-based Planner
        ↓
ResolvedDesignMutation[]
        ↓
Revision Engine
        ↓
DesignState
        ↓
RenderSnapshot
        ↓
Interactive 3D
~~~

关键原则保持不变：AI 负责语义判断，确定性系统拥有空间和业务执行权。

## 2. Source of Truth

### HomeSpatialModel

住宅本体真值：

- Floor / Room / Zone
- Wall / Opening
- Column / Beam
- UtilityAnchor
- RoomConnection
- provenance / confidence

Canonical：meter、right-handed、Y-up。

### DesignState

设计叠加真值：

- DesignObject
- MaterialAssignment
- StyleIntent
- Lock
- headRevisionId
- state version

3D Scene 不是 Source of Truth。

## 3. AI Capability Runtime

业务不直接依赖具体模型厂商。

~~~text
AI Capability Runtime
├── typed_decision
├── reasoning
├── vision
├── structured_extraction
├── embedding
├── rerank
├── image_generation
└── speech
~~~

PR #6 首次为 typed_decision 提供生产 Adapter：

~~~text
typed_decision
      ↓
TypeSafe JEV Provider
Choice / Score / Noul
~~~

JEV HTTP 调用只发生在 API 服务端。

Provider 输出统一 AIResult：

- provider
- model
- latency
- usage
- typed answers

## 4. Design Intelligence

ai-runtime 不理解家装业务。

家装领域的“这句话应该变成哪些 DesignOperation”位于独立 design-intelligence package。

P1 客厅 Decision Pack：

~~~text
User command + current objects + active room
              ↓
        one typed-decision call
              ↓
intent / scope / target
category / size / color / seats / style
preserve_others
              ↓
deterministic composition
              ↓
DesignOperation[]
~~~

Choice 的 confidence 与 Noul 概率用于执行门禁。置信度不足时不修改方案。

未来当命令域扩展到硬装、灯光、预算、整屋联动时，升级为：

~~~text
Scope Detection
      ↓
Targeted Decision Pack
      ↓
Domain Composer
~~~

## 5. Operation → State

AI 不能写 DesignState。

~~~text
DesignOperation
      ↓
Catalog hard filter
      ↓
Anchor candidates
      ↓
Boundary / collision / opening clearance
      ↓
Soft scoring
      ↓
ResolvedDesignMutation
      ↓
Revision Engine
      ↓
DesignState
~~~

Lock 与 Preserve 继续由 Planner / Domain 强制执行。

## 6. Catalog

Catalog 是 Planner 的候选事实来源，包括 SKU、真实尺寸、Variant、价格、标签和 Placement Rules。

检索顺序保持：

~~~text
Structured hard filter
→ Semantic retrieval / rerank (future)
→ Spatial feasibility
~~~

## 7. Renderer

Renderer 只消费 RenderSnapshot。

Babylon.js 仍是 P1 Runtime Candidate，整屋规模前需要 Whole-home Runtime Benchmark。

## 8. Security

- TypeSafe API Key 只在服务端
- 不进入 VITE_* 环境变量
- 不进入浏览器存储
- AI 输出视为不可信 Proposal
- 所有修改继续通过 Planner + Revision
- API / Provider 错误不得输出 Authorization

## 9. 下一阶段

PR #6 后，核心对话链路已经成立。下一优先级转向真实户型输入：

~~~text
真实户型图 / PDF
      ↓
Importer
      ↓
HomeSpatialModel Candidate
      ↓
Confidence + Validation
      ↓
Human Correction
      ↓
Real Room
~~~
