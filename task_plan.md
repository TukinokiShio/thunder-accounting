# Thunder Accounting v1.17.5 Task Plan — 缺陷轮：Portal 作用域替身

## 执行形态：多 Agent 编排（DEFECT_TRIAGE→Supervisor 归因；EXEC→Worker 流水线；REVIEW→独立 Reviewer 双轴；EVAL→独立 Judge）——选型依据：根因机制已确定（无需黑板探索）、写集收敛、无并行模块 → Supervisor 流水线；上一轮同源修复被用户实机证伪一次 → 审查必须独立证伪（辩论收敛）。

## 用户反馈 → 可验收标准（逐条对齐）

| # | 用户原话 | 可验收标准 | 验证方式 |
|---|---|---|---|
| RL-901 | 「选择分类后，弹窗塌缩」 | 记一笔弹窗在**任意内容**下宽度恒为 `min(28rem, 100vw-2rem)`（≥640px 视口下为 28rem）；选中一级/二级分类后宽度不变 | 真实构建 CSS + headless Chromium 像素量宽（有值/无值/长文本三态），宽度极差 = 0 |
| RL-902 | 「深色主题下显示的不是深色主题弹窗」 | 深色主题下模态面板底色 = `--bg-card` 深色值 `#202224`（亮度≈34），非浅色 `#fffaf2`（≈251） | 同上，对面板中心取像素亮度；明暗两态各测一次 |
| RL-903 | （隐含）遮罩仍须铺满视口 | v1.17.3 的遮罩修复不得回退 | 复验遮罩四边几何仍为 0；Portal 契约测试须继续通过 |
| RL-904 | 用户红线「限制修改范围」 | `git diff --name-only` 全落在写集内；`main-process/**`、`src/store/**`、`src/types/**`、`src/pages/**` 零改动 | `git status --short` |
| RL-905 | 用户红线「禁止修改用户数据」 | 不碰 `.db` / userData / 不启动 App | `git status` 过滤 + 备份校验（已有 `C:\Users\d8502\thunder-accounting-userdata-backup-20260912-1606`） |

## 拓扑（DAG，无并行分支 → 线性）

```
T1 modalScope.ts（新建）─┐
T2 index.css 替身规则   ─┼─→ T4 5 个模态根接入 ─→ T5 测试扩充 ─→ T6 vitest 全量
T3 版本号 1.17.5       ─┘                                    → T7 独立 Reviewer
                                                             → T8 独立 Judge
                                                             → T9 像素级复验（Supervisor）
                                                             → T10 打包/安装/提交推送/知识回流
```

## 反模式清单（本轮强制禁止）
- ❌ 撤销 Portal 回到 `fixed inset-0` 树内渲染（会退回遮罩露白，已被像素证据推翻）
- ❌ 把 `dark` 提到 `<html>`（blast radius 过大，会让历史失效规则突然生效）
- ❌ 改动模态根的内联几何字符串（源级契约测试逐字符断言）
- ❌ 触碰 `CategorySelect.tsx` 的 `menuPortalTarget`（既有行为，非本轮回归；越界即回流）
- ❌ 只做「源码 grep 式」验证就宣称修复 —— 必须有像素级几何/亮度证据

## 版本
`1.17.4 → 1.17.5`（PATCH，纯缺陷修复，无公开 API 变更）

---

# Thunder Accounting v1.17.6 Task Plan — 缺陷轮收口（回归守卫 + 耦合修复）

## 执行形态：多 Agent 编排
EXEC→Worker `worker-v1176`（实现）；REVIEW→独立 Reviewer `reviewer-v1175` 定向复验（它自己报的那条）；Supervisor 独立执行验证与打包交付。选型依据：改动集中于验证基础设施 + 1 处选择器收窄，写集收敛、无独立并行模块，无需黑板/DAG。

## 需求来源
v1.17.5 的两份独立回执：
- Reviewer（approve）P3：`CategorySelect.tsx:125` / `AddBillDatePicker.tsx:148` 的 `.aurora-shell` 选择器因模态根新增同类名而**不再唯一**（本轮引入的耦合）。
- Judge（eval 94 / quality 87 / RELEASE）P2：主报 bug「宽度塌缩」**无自动化防护**；契约测试模态清单硬编码；`evidence/` 存档不可复现。

## 可验收标准（requirement ledger）
| ID | 验收标准 |
|---|---|
| RL-906 | 两处 portal 目标选择器排除替身根；`CategorySelect.test.tsx:202` 仍通过 |
| RL-907 | `npm run verify:modal-scope` 可执行并通过：替身下宽度极差=0、深色面板=#202224、浅色面板=#fffaf2、遮罩覆盖视口、替身根透明底 |
| RL-908 | 该脚本含**负对照自检**：无替身组必须复现"宽度不稳定"，否则报错（防止验证器变成橡皮图章） |
| RL-909 | 契约测试模态清单从文件系统派生 + ≥5 与两条具名保底断言（防止清单静默变空） |
| RL-910 | `evidence/` 存档可复现（README + `scope-measure.json`） |
| RL-911 | 四处版本 = 1.17.6；`UsePreviousAppDir=no` 保留 |
| RL-912 | 写集内零越界；不碰 `.db` / userData；不启动 App |

## 写集（严格边界）
`src/components/CategorySelect.tsx`、`src/components/AddBillDatePicker.tsx`、`scripts/verify-modal-scope.cjs`(新)、`src/components/modal-portal-contract.test.ts`、`src/components/StatCardDetailDialog.test.tsx`、`artifacts/repro-portal-scope/evidence/README.md`(新)、`package.json`、`package-lock.json`、`scripts/thunder-setup.iss`

## 反模式清单（本轮明令禁止）
- 为了让新验证脚本通过而**放宽断言**（尤其负对照项）
- 把模态清单硬编码回去、或让其可为空而不报错
- 为绕开选择器不唯一问题去改 `CategorySelect.test.tsx` 的断言
- 把 `dark` 类提到 `<html>`（会让历史失效规则突然生效，blast radius 不可控）
- 撤销 Portal（遮罩修复有效，已被像素证明）

## 交付链路
`npm run build` → `npm run dist:win` → ISCC → 静默安装到 `exe\` → asar/注册表/快捷方式三重校验 → commit + push → 知识库修正（KI-2026-09-12-003 补「作用域必须随迁」+ 新增「结构迁移类修复的验证判据」）

---

# Thunder Accounting v1.17.0 Task Plan — 首页统计卡片明细弹窗

## 执行形态：多 Agent 编排（KNOWLEDGE_GATE→Explore 摸底；PLAN→Supervisor 汇总；EXEC→Worker 流水线；REVIEW→独立 Reviewer 双轴；EVAL→独立 Judge）——选型依据：单页面 UI 增量、写集收敛（≤6 文件）、无独立并行模块 → Supervisor 流水线而非黑板/DAG；审查含视觉与明细正确性、无唯一答案 → 辩论收敛（Reviewer ≤2 轮 + Judge）。

## 需求（来源：用户指令 + 第一性原理推导）

首页 6 张统计卡片（今日支出 / 本月支出 / 日均支出 / 累计记录 / 本月收入 / 本月结余）点击后弹出对应明细弹窗：
- 图形化组成拆解（环形图 / 柱状图 / 对比条，按指标语义适配）
- 逐笔明细列表（用户明确要求"要能看到每一笔"）
- 卡片本体视觉不变（用户明示已有点击动效）

## 写集（严格边界，越界即回流）

| 文件 | 改动性质 |
|---|---|
| `src/components/StatCardDetailDialog.tsx` | 新增（弹窗 + 图表 + 明细） |
| `src/components/StatCardDetailDialog.test.tsx` | 新增（单测） |
| `src/pages/Home.tsx` | 最小侵入：卡片 `onClick` + Dialog 渲染 + 传参 |
| `src/pages/Home.test.tsx` | 增补：点击开弹窗 / Escape 关闭 |
| `src/i18n/translations.ts` | 新增词条（中英） |
| `src/index.css` | 仅追加弹窗滚动区/骨架类（如需要） |
| `package.json` / `package-lock.json` / `scripts/thunder-setup.iss` | 版本 1.16.9 → 1.17.0 |
| `PRD.md` / `findings.md` / `task_plan.md` / `progress.state` / `progress.log` | 流程产物 |

**禁改（数据安全不变量）**：`main-process/**`、`src/store/index.ts`、`src/types/index.ts`（除非纯新增类型且不改既有签名）、`src/pages/Stats.tsx`、`src/pages/Bills.tsx`、`resources/**`、任何 Electron `userData` 下的 `.db` 文件。禁止读取/迁移/清空/覆盖真实用户数据库。

## 阶段（拓扑排序；无并行分支 → 线性执行）

- **P0 修复阻断**：恢复 `package.json` 完整结构（`scripts` + `devDependencies` + `build`），写回 1.17.0。依赖：无。验证：`git diff package.json` 仅含版本行变更 + `npm run build` 可用。
- **P1 弹窗组件**：新增 `StatCardDetailDialog.tsx`（6 形态配置表驱动、内部 fetch、只读、三态齐全、token 化）。依赖：P0。验证：单测通过 + 不变量③（明细和 = 汇总）。
- **P2 首页接线**：`Home.tsx` 卡片 `onClick` + Dialog 渲染；`i18n` 词条。依赖：P1。验证：`Home.test.tsx` 增补用例通过。
- **P3 质量门**：全量 vitest + `tsc`（node/renderer）+ electron-vite build + `aurora_lint`。依赖：P2。
- **P4 打包交付**：Clean Build → electron-builder → ISCC → 静默安装到 `exe` → asar 版本校验 + 视觉证据截图。依赖：P3。
- **P5 审查评估**：独立 Reviewer（Standards + Spec + 安全轴 + UX 轴）→ 独立 Judge（eval_score / quality_score 双门槛）→ 用户验收三证。依赖：P4。

## 关键路径（AOE）

P0 → P1 → P2 → P3 → P4 → P5（线性，无并行路径）

## 反模式清单（防呆）

1. 把 `Home.tsx` 的 `bills`（受 store 筛选影响）直接当作弹窗数据源 → 必须弹窗内自行按明确日期范围 fetch
2. 卡片汇总与弹窗汇总口径不一致（漏 type 过滤 / 漏日期边界）
3. 环形图用 inline label → 标签重叠（项目已验证用自定义 Legend 规避）
4. 引入外部 UI 库 / 新 npm 依赖
5. 触碰 `main-process` 或 `userData` 数据库
6. 忘记 `package.json` 结构完整性（本轮已发现被截断）

## 人为终审点

PLAN 终审（计划 + HOOK 检索结果 + 第一性原理推导）→ 用户确认后进入 EXEC。

---

# Thunder Accounting v1.16.0 Task Plan

## v1.16.1 增量收口

- 登录页焦点边界、忘记密码/创建账号文字按钮和金棕色“其他登录方式”已按用户截图修复。
- Inno 安装包输出 `release`，默认安装并验收 `exe`，同时启用自定义安装目录页。
- 本轮清理仍须在本轮提交成功 push 后执行；历史安装包、回滚包和审计证据按清单保护。

## 执行形态：多 Agent 编排（模式：职责分离；KNOWLEDGE_GATE→Explore；PLAN→方案汇总；EXEC→Worker 流程；REVIEW→独立 Reviewer；EVAL→独立 Judge + 规则闸）——选型依据：遗留 Electron 项目、多页面 UI、清理与 Windows 交付存在不同风险面，需要职责分离与可核验证据。

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
5. **Phase 4｜独立审查与评估**：Reviewer 做 Standards/Spec/安全/断言质量与 UI 审查；Judge 独立运行规则闸与质量评估，低分带归因回流。→ 6
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

## v1.16.4 本轮计划：记一笔弹窗 UI 缺陷修复

## 执行形态：多 Agent 编排（模式：职责分离；KNOWLEDGE_GATE→Explore；PLAN→方案核对；EXEC→Worker；REVIEW→独立 Reviewer；EVAL→独立 Judge + 规则闸）——选型依据：改动集中但属于真实 UI 交互，需把实现、视觉审查和质量评估职责分离；两个代码文件与测试文件由 Worker 统一按契约修改，Reviewer/Judge 独立验证。

### 任务边界

- 只处理“记一笔”弹窗：`src/components/AddBillDialog.tsx`、`src/components/CategorySelect.tsx`、`src/index.css` 及对应分类测试；不触碰其他业务页面。
- 版本按兼容性 PATCH 从 `1.16.3` 升至 `1.16.4`，同步 `package.json`、`package-lock.json`、`scripts/thunder-setup.iss`；不改变公开业务契约。
- 数据安全硬约束：不触碰 `main-process/database`、CloudBase、IPC、Zustand 持久化、`resources` 或 Electron `app.getPath('userData')`；不对真实用户数据库执行测试、迁移、清空、覆盖或删除；构建/安装只处理应用产物。

### 方案与阶段依赖

```text
代码摸底/参考检索 → 用户确认本计划 → UI Worker 实现 + 回归测试
                                   ↓
                    独立 Reviewer → 独立 Judge/EVAL
                                   ↓
                       测试/构建/Inno/安装到 exe → 用户 GUI 验收
```

1. `CategorySelect.tsx`：保留 Portal 与联动逻辑，补充基于项目 CSS 变量的 `react-select` control/menu/option/placeholder/disabled 样式；不新增依赖。
2. `AddBillDialog.tsx`：仅增加稳定的记账弹窗命名空间 class，业务状态与提交逻辑不改。
3. `index.css`：在记账弹窗命名空间内关闭通用父级 `focus-within` 外圈，并让实际 `.input-field` 承担唯一金棕色焦点边框；不改全局规则对其他页面的行为。
4. 测试：补充分类控件的聚焦类、二级禁用态和菜单行为回归断言；运行定向测试、全量测试、类型检查、Aurora lint、构建。
5. 交付：独立审查后执行 Clean Build、Inno 打包、静默安装至 `E:\Code\CodeProduct\thunder-accounting\exe`，验证 `app.asar` 版本为 `1.16.4`；保留用户需确认的历史产物，不做额外清理。

### 需求—验证映射

| 需求 | 验证证据 |
|---|---|
| 分类金棕色主题 | `CategorySelect.test.tsx` DOM 状态断言 + Aurora assess/截图 + 用户浅深色实机确认 |
| 输入框焦点仅覆盖输入框 | CSS 选择器审查 + 三档截图比对 + 用户依次聚焦金额/日期/备注 |
| 分类联动与禁用不回归 | `CategorySelect.test.tsx` 交互断言 + 全量 Vitest |
| 其他功能不修改 | `git diff` 仅限本轮清单 + TypeScript/build + 用户验收 |
| 现有用户数据不受影响 | 写集审计 + 数据路径禁触碰检查 + 临时 fixture 测试 + 安装仅校验 `exe` 应用产物 |

### 当前终审点

计划已结合用户截图、`PRODUCT.md`、`DESIGN.md`、`CONTEXT.md` 和本地模板检索结果编制；确认后进入 EXEC。
