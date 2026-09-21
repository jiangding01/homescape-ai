# ADR-0001：Monorepo 与领域边界

- Status: Accepted
- Date: 2026-09-21

采用 pnpm workspace + Turborepo 的 TypeScript Monorepo。

第一阶段模块：

- apps/web
- apps/api
- packages/spatial-model
- packages/domain
- packages/ai-runtime
- packages/planner
- packages/renderer-contract

Domain package 不得依赖具体 AI Vendor、React 或 3D Engine。
