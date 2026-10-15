# PR #17 真实户型 Ground Truth 分阶段审核

本流程与 Raster Candidate 严格分离。JSON 文件出现在 ground-truth 目录中不等于经人工审核的 Ground Truth。

stage.json 放在私有 .floorplan-corpus/pr17-real-gt-batch4/ 下，每个 Case 提供匿名 id、sourcePath、sourceSha256、mediaType、groundTruthPath、reviewStatus。
人工确认后设置 reviewStatus=approved、tagsReviewed=true、合法分类 tags 以及 approvedGroundTruthSha256（文件原始 SHA-256）。
未完成时 reviewStatus=pending、tagsReviewed=false，不得事先记录批准哈希。

执行：
~~~bash
node tools/floorplan-gt-stage.mjs .floorplan-corpus/pr17-real-gt-batch4/stage.json
node tools/floorplan-corpus.mjs .floorplan-corpus/pr17-real-gt-batch4/corpus-ready.json --min-cases 1 --report .floorplan-corpus/pr17-real-gt-batch4/reports/corpus-summary.json
node tools/floorplan-real-coverage.mjs .floorplan-corpus/pr17-real-gt-batch4/reports/corpus-summary.json .floorplan-corpus/pr17-real-gt-batch4/intake-reports/pilot-a.json .floorplan-corpus/pr17-real-gt-batch4/intake-reports/pilot-b.json --extractor-id raster-orthogonal-v0.1 --report .floorplan-corpus/pr17-real-gt-batch4/reports/coverage.json
~~~

stage 命令支持 --check 只读模式；正常生成 corpus-ready.json（只含批准 Case）与 reports/gt-stage-progress.json（区分待标注、待审核、已审核）。
GT 变化后必须重新人工确认并更新固定 SHA；原图 SHA 不一致、Case ID 重复、文件路径越界、未经批准的 Tags 均会拒绝。
正式 Corpus Gate 负责完整 GT 几何合同，Coverage 负责按 Source SHA 关联 Intake 提取失败证据；两者都不能把自动 Candidate 冒充 GT 或将提取失败解释成零 IoU。

截至 2026-10-12，case-001 已通过用户本地正式单 Case Corpus Gate，case-004、case-b005、case-b008 的人工 GT 仍待完成。
4 Case Dataset 名称不同于之前单 Case Dataset，扩容后应重新生成 Dataset Fingerprint，不可复用旧 Summary 与 Coverage。
真实图片、Ground Truth 与 Review Burden 必须保留私有，绝不提交公开仓库。
