# ADR-0008：AI Decision Runtime 与 JEV Provider

- Status: Accepted for P1
- Date: 2026-09-21

## 决策

自然语言不能直接生成或修改 DesignState。

HomeScape 将自然语言先转换为 typed decisions，再由领域解释器组合成受限 DesignOperation：

~~~text
Natural Language
      ↓
AI Capability Runtime
      ↓
Typed Decisions
      ↓
Design Intelligence
      ↓
DesignOperation[]
      ↓
Catalog + Planner
      ↓
ResolvedDesignMutation[]
~~~

## Capability 与 Vendor 分离

Domain 只知道 DesignOperation。

ai-runtime 定义通用 typed_decision 协议，包括：

- Choice
- Score
- Noul

JEV 是 typed_decision 的首个 Provider，实现位于 ai-runtime/providers/jev，不进入 Domain、Planner 或 Renderer。

未来其他模型只要实现相同 Capability Contract 即可参与 fallback、shadow evaluation 或替换。

## P1 Decision Pack

客厅 Vertical Slice 当前一次并行判断：

- intent
- scope
- target
- category
- size
- color
- seats
- style
- preserve_others

这些问题都针对同一份结构化 state 独立判断。解释器只读取与当前 intent 有关的答案。

随着业务复杂度增加，再拆为 Scope Detection → Targeted Decision Packs，避免问题数量和领域复杂度无限增长。

## Confidence Gate

AI 结果不是事实。

P1 至少对以下决策设置门禁：

- intent confidence
- target confidence

低置信度时返回 needs_clarification，不产生 DesignOperation。

Noul 使用概率阈值决定是否生成 Preserve。

## 安全边界

TYPESAFE_API_KEY 只能存在 API 服务端环境变量中。

禁止：

- 放入 VITE_* 环境变量
- localStorage / sessionStorage
- 浏览器请求头
- 日志

JEV 只解释用户意图，不拥有几何坐标、商品合法性、Lock、碰撞或 Revision 写权限。

## API 可靠性

JEV HTTP Provider：

- 默认调用 /v1/systemone
- 默认模型 jev-latest
- 429 / 529 使用指数退避重试
- 每次请求有 timeout
- Provider 错误不泄露 Authorization

## 数值空间操作

P1 不使用 JEV 猜测精确厘米或旋转角度。

“向右移动 37cm”之类命令后续交给 structured_extraction 或专用数值解析能力；在该能力完成前，自然语言 move / rotate 返回 unsupported。
