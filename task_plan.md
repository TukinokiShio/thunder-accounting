# Thunder Accounting v1.16.0 Task Plan

## 执行形态：多 Agent 编排（KNOWLEDGE_GATE→Explore；PLAN→黑板式方案汇总；EXEC→Supervisor Worker 流水线；REVIEW→独立 Reviewer/UIUX Reviewer 辩论；EVAL→独立 Judge + 规则闸）——选型依据：遗留 Electron 项目、多页面 UI、清理与 Windows 交付存在不同风险面，需要职责分离与可核验证据。

## 版本与范围

- 版本：`1.15.2 → 1.16.0`，兼容性 UI/交付增量。
- PRD：`PRD.md`；设计上下文：`PRODUCT.md`、`DESIGN.md`、`CONTEXT.md`。
- Aurora route：Product / Operate、T2、浅色默认、项目上下文金色 accent、640/1024/1440。
- 业务保护：认证、记账、同步、备份、双语和 CloudBase 数据契约不变。

## 阶段与依赖

1. **Phase 0｜接手与记忆**：更新 PRD、CONTEXT、项目级差异 skill、AGENTS 固定安装目录；运行时锁、知识 receipt、Aurora route/design-context。→ 2
2. **Phase 1｜清理 manifest**：只读核对目录用途、Git 跟踪关系、大小、版本和回滚价值；列出清理候选，用户确认后逐项删除/覆盖并验证。→ 3
3. **Phase 2｜UI 方案与 token 收敛**：Worker 基于 `src/index.css`、页面/组件现状和 Aurora 规范，统一语义 token、焦点、表单、状态、外壳与响应式基线。→ 4
4. **Phase 3｜UI 组件实现**：Worker 按互不重叠文件集改造登录/外壳、业务页、表单/对话框/状态组件；为关键交互补行为测试和视觉断言/截图基线。→ 5
5. **Phase 4｜独立审查与评估**：Reviewer 做 Standards/Spec/安全/断言质量/UIUX 审查；Judge 独立运行规则闸与质量评估，低分带归因回流。→ 6
6. **Phase 5｜版本、构建、Inno 与安装**：同步四处版本号；clean build；Inno 编译；安装到 `exe`；验证 `app.asar`、启动、安装路径和 receipt。→ 7
7. **Phase 6｜用户验收与收尾**：用户回填三档/主题/关键页面验收；更新项目记忆与知识 ledger；完成 quality-test、final audit、cleanup closeout、commit/push。

## 清理候选（先 manifest，待用户确认）

- **建议清理**：`out/` 中已跟踪的 `*.tsbuildinfo`；`app-out/` 可由构建重建；`雷霆记账app_exe/` 当前为空。
- **需用户确认后清理**：`release/win-unpacked/`、`release/` 内旧或本轮重建前安装包；`exe/` 内 `1.14.10–1.14.14`、`1.14.16` 等历史安装包/块映射文件；`雷霆记账app/_exe/` 重复打包目录；`node_modules/`（可重装但会增加后续构建成本）。
- **保护不删**：`.git/`、`src/`、`main-process/`、`resources/`、`docs/`、`wiki/`、`artifacts/` 审计/回滚证据、`exe/` 当前运行文件直至新版本安装验证完成。

## 验证矩阵

- `npm test`；TypeScript/build；`aurora_lint.py`；三档 Electron/浏览器截图；浅色/深色/reduced-motion。
- Inno `ISCC.exe` exit 0；安装到 `exe`；`app.asar` 内版本；应用启动与 `verify-release.cjs`；不自动覆盖用户现有安装。
- `progress.state` 双分数、Run Receipt、Aurora visual evidence、Inno receipt、用户 `user_signoff.md` 齐全后才进入 FINAL/DONE。

## 当前停点

计划和 cleanup manifest 需用户确认后进入 EXEC；确认前不删除清理候选、不改业务源码、不构建安装包。
