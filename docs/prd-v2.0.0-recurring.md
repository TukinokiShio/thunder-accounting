# PRD · v2.0.0 周期支出（订阅与定投）

> **状态横幅**：🟢 已实施（2026-09-19，N1–N8 全部完成）· 安装验收通过（exe/ = 2.0.0）· **待用户启动应用做功能验收**
> 实施进度见文末「十、实施 DAG」（已回填）。
> 本文是本功能唯一权威需求源；与对话记忆冲突时以本文为准。

---

## 一、背景与目标

用户需要登记**周期性发生的支出**（订阅服务、机械定投），让这些支出进入账单与统计，而不必每期手动重录。

**产品定位推演（第一性原理）**：一笔账单是一次**已发生的资金流出**（事件）；一个订阅/定投是一条**按周期产生支出的规则**（计划）。二者是 1:N 关系 ⇒ 规则必须是独立实体（新表），不得塞进 `bills` 表把"预期"混进"事实"。

**投资边界（用户 2026-09-19 定）**：定投**就是普通支出**。不做投资页面、不做持仓/涨跌/市值——那要求资产侧精准同步，与本产品"3 秒记一笔"定位相斥。投资收入走收入页手工记。

## 二、需求决策记录（grill 定案，权威）

| 分支 | 决策 |
|---|---|
| A 入账方式 | **到期提醒 + 一键入账**（非全自动入账、非仅登记）。「是」→按模板预填→确认入账，`next_date` 推进一期；「否」→本期跳过，`next_date` 同样推进（防提醒堆积） |
| B 字段 | 必填：名称、金额、类型（订阅/定投）、周期、下一期日期；选填：**支付平台**（微信/支付宝/Apple Pay/谷歌支付…）、**资金账户**（原"资金来源"改名；银行卡/微信零钱/信用卡…）、备注；分类按类型给默认、可改 |
| C 模块与页面 | 记一笔支出拆两模块：**「单笔支出」+「周期支出」**；新增侧边栏页**「周期支出」**（级别等同总览/账单/统计）；到期提醒=**小红点+数字徽标**（否决开屏弹窗：会打断"3 秒记一笔"核心循环） |
| D 云端同步 | **v2.0.0 直接同步云端**：新增 CloudBase 集合，复用 bills 的 trySync upsert 模式，按 userId 隔离 |
| E 版本号 | **v2.0.0**（用户终裁；里程碑跳版，MAJOR 语义与"不兼容变更"脱钩为已知取舍） |

## 三、硬约束（验收第一条红线）

1. **严禁破坏已有用户数据**：所有迁移只允许增量（`CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN`），绝不动 `bills`/`categories` 既有结构与数据；v1.17.x 老库升级后必须无损打开。
2. 删除周期项目**只删规则，绝不删已生成的历史账单**（bills.recurring_id 变悬空引用，UI 显示"已删除的周期项目"）。
3. 新增中文 UI 文案必须全部走 `t()` 并同步词典（i18n 门禁强制）。
4. 智能定投（涨跌幅/PE 估值法）明确不做。

## 四、数据模型（增量迁移）

**新表 `recurrings`**：

```sql
CREATE TABLE IF NOT EXISTS recurrings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,             -- 订阅名 / 定投标的
  amount REAL NOT NULL,           -- 每期金额 (>0)
  type TEXT NOT NULL DEFAULT 'subscription',  -- 'subscription' | 'dca'
  cycle_unit TEXT NOT NULL,       -- 'day' | 'week' | 'month' | 'year'
  cycle_interval INTEGER NOT NULL DEFAULT 1,  -- 每 N 期
  next_date TEXT NOT NULL,        -- YYYY-MM-DD 下一期应发生日
  category1 TEXT NOT NULL,        -- 生成账单的一级分类
  category2 TEXT,
  payment_platform TEXT,          -- 选填
  fund_account TEXT,              -- 选填
  note TEXT,
  paused INTEGER NOT NULL DEFAULT 0,  -- 暂停=1（不判到期）
  cloud_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
)
```

**`bills` 增列（全部可空，增量安全）**：`recurring_id INTEGER`（关联规则）、`payment_platform TEXT`、`fund_account TEXT`。单笔支出模块本轮不在 UI 暴露后两列（列先落位，为后续铺路）。

**删除语义**：物理删除规则行；生成账单不受影响。

## 五、核心机制

- **到期判定**（渲染层纯函数）：`next_date ≤ 今天` 且未暂停 ⇒ 到期。
- **next_date 推进**：按 `cycle_unit × cycle_interval` 推进，**月/年用"锚日对齐"**（登记日的日号为锚；目标月无该日取月末；以下一期 `next_date` 为基准继续推进，避免 1 月 31 日 → 2 月 28 日 → 3 月 28 日漂移）。
- **一键入账**：按规则预填 AddBillDialog（金额/分类/平台/账户/日期=当期 `next_date`）→ 复用现有 `addBill`（账单落 `recurring_id`）→ 推进 `next_date`。
- **漏期补记（🔶 假设，用户未反对视为接受）**：漏 N 期显示"已漏 N 期"，默认逐期补记 N 笔（各期各日期，确认前可见"将补记 N 笔"）；可只记本期。
- **分类默认**：订阅→「其他杂项」，定投→「金融保险」，登记时可改（🔶 假设，同上）。

## 六、IPC（最小集 = 4 个）

`getRecurrings()` / `addRecurring(data)` / `updateRecurring(id, data)` / `deleteRecurring(id)`。
到期判定与 next_date 推进是纯函数放渲染层（用 `updateRecurring` 落库），**不新增额外 IPC**。账单生成复用现有 `addBill`。云端：`addRecurring`/`updateRecurring` 后按 bills 的 trySync 模式 upsert 到 `recurrings` 集合（含 cloud_id 回写），失败静默跳过；删除同步为云端删文档。

## 七、UI

- **AddBillDialog**：支出态加分段控件「单笔支出 / 周期支出」。周期支出模块字段：名称、金额、类型（订阅/定投）、周期（每天/每周/每月/每年 × 每 N 期）、下一期日期、分类（默认可改）、支付平台（选填快选）、资金账户（选填快选）、备注。
- **Sidebar**：新增页「周期支出」+ 红点数字徽标（到期数，归零即消失）。🔶 假设：页面组件全端共享，安卓端只是多出一页，本轮不发安卓版、不动安卓专属布局。
- **周期支出页**：① 顶部汇总卡（本月已入账 N 笔/¥Y · 未来 30 天待发生 ¥Z · 进行中 N 个）② 到期区置顶（一键入账/本期跳过）③ 项目列表（名称·金额·周期·平台·账户·下次日期·累计已入账；点击展开该规则的历史账单）④ 管理（新增/编辑/暂停/删除）。
- **模态规范**：新增/编辑弹窗走 Portal + 作用域替身（`modalScope.ts`，z-index 9000），自动纳入 `modal-portal-contract.test.ts` 清单（从文件系统派生，无需手工登记）。

## 八、非目标

智能定投 · 投资页面/持仓/净值 · 支付平台对接或余额查询 · 安卓端布局与发版 · bills 表结构重构 · 收入侧周期（先只做支出）。

## 九、验收标准

1. **老库升级无损**：用 v1.17.10 真实库文件升级后打开，账单/分类/余额零变化（专项验证）。
2. `npm run typecheck` / i18n 门禁 / `verify:modal-scope` / `verify:android-layout` / `verify:desktop-parity`（验收后**重挂基线**到 v2.0.0）全绿。
3. 同步幂等：同一规则重复 upsert 不产生重复云端文档。
4. 单笔支出流程零回归；周期支出一键入账/跳过/补记行为符合 §五。
5. 打包链路（Clean Build → electron-builder → ISCC → 静默安装 `exe/` → asar 版本核对），版本三处同步 `2.0.0`。
6. `git commit`（pathspec 限定 + `Agent:` trailer）+ `git push`。

## 十、实施 DAG

> 节点状态：⬜ 未开始 / 🔄 进行中 / ✅ 完成。**完成当日回填此处。**

| 节点 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| N1 | 增量迁移：`recurrings` 表 + `bills` 三列（`recurring_id`/`payment_platform`/`fund_account`） | — | ✅ |
| N2 | IPC/preload CRUD + 云同步（`recurrings` 集合、cloud_id 回写） | N1 | ✅（含备份导出/导入/清空的规则覆盖；安卓适配器三方契约 41→45 键） |
| N3 | store + 周期推进纯函数（锚日对齐）+ 到期判定 | N1 | ✅（`src/utils/recurringCycle.ts`） |
| N4 | AddBillDialog 双模块（单笔/周期） | N3 | ✅（含一键入账预填模式：逐期落账 + next_date 推进） |
| N5 | 周期支出页 + Sidebar 红点徽标 | N3 | ✅（`src/pages/Recurring.tsx` + `Recurring/` 三组件） |
| N6 | i18n 词典（**唯一写者**：本轮词典只由 N6 一个任务改） | 伴随 N4/N5 | ✅（i18n 门禁全绿；快选/默认分类值落 `src/data/recurringOptions.ts` 持久化数据豁免，先例=categories.ts） |
| N7 | 测试与门禁：老库升级专项 + 单测 + 全量 verify | N2–N6 | ✅（详见下方验证记录） |
| N8 | 打包 v2.0.0 + exe 验收 + desktop-parity 基线重挂 + commit/push | N7 | ✅（基线重挂**待用户验收后**执行，见下） |

可并行：N2 ∥ N3（都只依赖 N1）；N4 ∥ N5（都只依赖 N3）。

### 验证记录（2026-09-19）

- typecheck 四切片（web/mobile/node/scripts）0 错误；vitest **49 文件 / 510 测试全绿**（含新增 `database-v2-upgrade.test.ts` 老库升级专项：v1.17.10 schema 老库经真实 `initDatabase()` 路径升级后账单/分类零变化、新 CRUD 可用、删规则不删账单）。
- `verify:modal-scope` PASS（新增 RecurringFormDialog 被文件系统派生契约自动纳入）；`verify:android-layout` PASS（9/9）。
- `verify:desktop-parity` FAIL→**已裁决**：24 项差异全部由「侧边栏新增周期支出导航项」这一处有意改动引起（每页节点数恰 +6~7、文本差异=「周期支出」插入、样式差异仅出现在索引偏移的导航按钮上；首页 6 卡/账单行/统计图表/顶栏全 PASS=零未预期漂移）。**基线重挂到 v2.0.0 commit 待用户功能验收后执行**（rules §八 纪律）。
- 打包：Clean Build（bundle 版本 2.0.0 ×1、无残留）→ electron-builder 输出隔离目录 `release-v2build`（旧 `release/win-unpacked/resources/app.asar` 被 §39 持锁者锁住，remove EBUSY）→ ISCC 202s 成功 → `release/雷霆记账_Inno_v2.0.0.exe`。
- 安装：官方静默安装 **exit 5**（/LOG 判定为成因 B：`exe/resources/app.asar` DeleteFile code 32，§39 同款持锁者）→ 启用 §39 绕行：逐文件同步 `exe/`（99 copy + asar O_TRUNC 覆盖）→ **验证四连全绿**（sizeDiff=0/missing=0；asar 内 package.json=2.0.0；内容正负对照：周期支出/单笔支出/资金账户=true、1.17.10=false、记一笔=true；注册表 DisplayVersion=2.0.0）。
- ⚠️ 遗留：持锁者对 `resources/app.asar` 文件名**跨三个副本**持续存在（`release163/`、`release/win-unpacked/`、`release-v2build/` 残留 asar，合计约 302MB 无法删除）——与 §39 记录一致，待重启后重删或加入安全软件信任区（Agent 不代改安全配置）。

### v2.0.1 修复（2026-09-19 用户验收反馈）

| 问题 | 根因 | 修复 |
|---|---|---|
| 「每 N 天/周/月/年」排版错乱：间隔输入框撑满整行、单位按钮被挤出 | `index.css:207` 的 `.input-field { width:100% }` 盖掉输入框的 `w-20`（同特异度级联靠后） | 间隔输入框包进 `w-20 shrink-0` 容器；单位按钮改 `grid-cols-4` 均分（§25 同族风险已查：index.css 无其它以这些类名为字面量的选择器） |
| 定投只发生在交易日，未考虑 | 周期推进纯日历化 | 新增 `trade_day_only` 列（增量补列，定投专属默认开）：周末自动顺延到下一交易日；**推进基准保持日历锚不变**（与券商定投「顺延不改期」一致），展示/入账日期用顺延后的实际发生日；云同步/备份字段同步。⚠ 已知限制：法定节假日无离线数据源不自动判断，提醒照常出现、用户可改日期或跳过 |

- 验证：typecheck 4 切片 0 错；vitest **50 文件 / 522 测试全绿**（新增 `recurringCycle.test.ts`：锚日对齐/周末顺延/顺延不改期，星期断言经 Node 实测核实）；modal-scope / android-layout PASS。
- 版本 2.0.0 → **2.0.1**（PATCH：无新外部 API）；打包 `release/雷霆记账_Inno_v2.0.1.exe`；官方安装 exit 5（同款成因 B）→ §39 绕行 + 验证四连全绿（sizeDiff 0 / asar 2.0.1 / 新串「仅在交易日执行」true 且 2.0.0 版本串 false / 注册表 2.0.1）。
### v2.0.3 修复（2026-09-19 用户验收反馈第二轮）

| 问题 | 根因（全部代码定位） | 修复 |
|---|---|---|
| 弹窗宽度太小、字段被挤/塌缩 | 只有 `.add-bill-dialog` 有宽度骨架规则，**`.recurring-form-dialog` 没有** → 弹窗按内容塌缩（实测塌缩 ≈418px） | 在 `index.css` 补 `.aurora-shell .recurring-form-dialog` 完整骨架（width min(30rem) / flex column / max-height / 焦点边界局部覆盖）→ 实测 **480px** |
| 复选框被撑成巨型方块、标签竖排 | 全局 `.aurora-shell input { width:100%; min-height:42px }` **命中了 checkbox** | 全局规则改为 `input:not([type='checkbox']):not([type='radio'])` → 复选框实测回到 **16×16**、标签宽 266px |
| 「资金账户」浅蓝底、风格不符 | Chromium **自动填充**（`:‑webkit‑autofill`）强制浅蓝背景，绕过主题 | 补 `.aurora-shell input:-webkit-autofill` 内阴影覆盖回主题色 + 表单输入框 `autoComplete="off"` |
| 支付平台/资金账户「只能选不能填」 | 原用 `<datalist>`：点击即弹下拉、且触发浏览器自动填充，交互上像只读选择器 | 改为**自由文本输入 + 快选芯片**（点芯片填入，芯片可再点取消，仍可任意手写） |

- **新增永久门禁 `npm run verify:recurring-dialog`（10 条断言，含负对照自检）**：真实组件 + 真实构建 CSS + 无头 Chromium，量测 R1 弹窗宽度 / R2·R3 复选框尺寸与标签宽度 / R4 可自由输入 / R5 芯片一键填入 / R6·R7 无横向溢出 / R8 禁掉宽度规则必须复现塌缩（否则判据是「不可能失败的假断言」）。首跑 3 红**全是门禁自身的判据缺陷**（未先切到「定投」；芯片定位器误收类型/周期按钮 21 个），已修正——这正是门禁要防的「假红/假绿」。
### v2.0.4 修复（2026-09-19 用户验收反馈第三轮）

| 问题 | 根因 | 修复 |
|---|---|---|
| 名称示例不够专业 | 示例文案 | 改为「如：华安纳斯达克100ETF联接A」 |
| 定投缺标的代码 | 无该字段 | 新增 `symbol` 列（增量补列，定投专属选填，示例 040046）：DB/云同步/备份/表单/列表展示全线打通 |
| **漏填后保存不了、没有任何提示** | ①**顺序缺陷**：单笔校验排在周期模块分支之前 → 在周期模块点保存时校验的是那张空的单笔表单，报错永远不对路；②错误文案挂在**可滚动内容底部**，用户没滚到底就看不到 | ①模块分流传到 `handleSubmit` 最前；②校验失败改为**四件套**：字段级红字（就地）+ 汇总提示**固定在按钮上方**（不随滚动）+ toast + 滚动聚焦首个问题字段；③字段加 `aria-invalid`/`aria-describedby`（无障碍同步） |

- 门禁新增两条断言：**R9 校验反馈可见性**（汇总提示必须在**视口内**、字段级红字存在、`aria-invalid=true`——只判「存在」会漏掉「藏在滚动区底部看不见」）、**R10 标的代码可自由输入**。门禁 12/12 PASS。
- R9 首跑即抓出上述**顺序缺陷**（`aria-invalid=false`）：这正是「判据要能失败」的价值——若只断言「错误区存在」，该缺陷会继续通过。
- 验证：typecheck 0 错；vitest **50 文件 / 525 测试全绿**（升级专项补 symbol 断言）；modal-scope / android-layout PASS；打包 + §39 绕行安装，验证四连全绿（asar 2.0.4 /「华安纳斯达克100ETF联接A」「040046」在包内 / 旧版本串 false / 注册表 2.0.4）。
