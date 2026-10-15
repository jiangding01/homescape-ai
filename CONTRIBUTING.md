# 贡献指南

## 分支与提交

- 从 main 创建短生命周期功能分支。
- 建议命名：feat/*、fix/*、chore/*、docs/*。
- Commit message 与 PR 描述使用简体中文。
- 不直接向 main 推送功能开发。
- 并行会话分工见 CLAUDE.md。

## 质量门槛

提交 PR 前至少执行：

~~~bash
pnpm typecheck
pnpm test
pnpm build
~~~

与 CI 一致。`pnpm format:check` 暂不作为门槛：历史文件尚未统一格式。

领域层变更需要同步更新 docs/ARCHITECTURE.md 或对应 ADR。

## 依赖边界

- packages/spatial-model 不依赖任何 UI、AI Provider 或 3D Engine。
- packages/domain 不依赖具体 AI / Renderer。
- packages/ai-runtime 不理解具体家装业务。
- packages/planner 依赖 Domain Contract，不依赖 React。
- packages/contracts 只依赖 zod 与领域类型（domain、spatial-model），不依赖 UI、AI Provider 或 3D Engine。
- apps/* 负责组装，不反向成为 packages/* 的依赖。
