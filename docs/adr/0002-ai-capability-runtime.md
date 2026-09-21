# ADR-0002：AI Capability Runtime

- Status: Accepted
- Date: 2026-09-21

业务依赖 AI Capability，不依赖 AI Vendor。

第一批 Capability：

- typed_decision
- reasoning
- vision
- structured_extraction
- embedding
- rerank
- image_generation
- speech

JEV 是 typed_decision 的首选实现，但不进入 Domain Contract。

AI Runtime 需要允许 Provider 替换、fallback、shadow evaluation、成本/延迟路由以及公司内部模型接入。
