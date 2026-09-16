# SACW 缺陷报告：运行产物为何不会被回收

> 生成 2026-09-16 · 审计对象 `~/.workbuddy/skills/shio-al-coding-workflow/`（**SACW v5.7.0**，`last_updated: 2026-09-15`）
> 触发：用户追问「为什么没有自动清理项目的实验产物」，并判定**主因是 SACW 缺陷**、项目级记忆为次因，**以更新 SACW 为主**
> **本报告为只读审计产出 —— 未修改 SACW / SAE 任何文件**（用户明确：本轮无更新 SACW 权限，不进行升级）
> 证据纪律：每条给「文件路径 + 行号 + 原句要点」；零命中结论附**检索词**；逐项标注 已验证 / 推断 / 未知
> 姊妹文档：`artifacts/sae-responsibility-audit-20260916.md`（生态级横向审计全文）

---

## §0 移交说明（本节读者 ＝ 执行 SACW 升级的**另一个对话**）

### 任务

把 SACW（`shio-al-coding-workflow`）的**收尾/清理机制**从「可空转」改为「不可空转」，并补上**流程中断时的现场回收**定义。**不改编码主流程与既有门禁通过标准**，只动收尾与清理相关条款。

### 目标文件

| 项 | 值 |
|---|---|
| Skill 根 | `C:\Users\d8502\.workbuddy\skills\shio-al-coding-workflow\` |
| 版本 | **v5.7.0**（`SKILL.md` frontmatter：`version: "5.7.0"` / `last_updated: "2026-09-15"` / `agent_created: true`） |
| 主要落点 | `SKILL.md`（收尾清单① `:545-552`）· `references/loop-spec.md`（`:69-76`）· `scripts/validate_state.py`（门禁⑫ `:3766-3814`）· `references/changelog.md` |
| 关联 skill | `sacw-improver`（收尾六件套 `SKILL.md:148,161`）· `sacw-audit`（`references/checklist-mechanisms.md:267` V3-39） |

### 硬约束（缺一不可）

1. **必须 bump `version`** —— skill 改内容不 bump，会让同步工具判不出方向。
2. **必须走 SACW 自己的改进闭环** —— `sacw-improver` 的「收尾六件套」（含 `changelog.md` 追加版本条目、skill-sync 推送）。
3. **不得破坏既有 `progress.state` 兼容** —— 现存 run 停在 `state: EXEC` / `workflow_version: 5.6.1`（`E:\Code\CodeProduct\thunder-accounting\progress.state`），**新增字段一律可选**，旧状态文件不得因此变 FAIL。
4. **不得把门禁改红** —— 本次修的是「漏做不被发现」，不是「收紧既有通过标准」；改完应能通过 SACW 自身 self-test。
5. **判据必须客观可判定** —— 不得引入「询问已发起即通过」这类软判据（那正是本次要修的缺陷）。

### 验收判据（改完必须逐条演示）

| # | 判据 | 验证方式 |
|---|---|---|
| A1 | `metrics.closeout.cleaned: []` **不再 PASS** | 造 `cleaned: []` 的 state → 跑 `--gate`，应 FAIL/WARN 并给出原因 |
| A2 | `workspace.ref` **不再是触发前提** | 造无 `workspace.ref` 但有运行产物的 state → 门禁⑫ 应参与判定，而非 SKIP |
| A3 | **`scan` 与 `decisions` 数量对账** | 造 `scan.found=69` 但 `decisions` 只有 1 项 → 应 FAIL |
| A4 | **中断态有回收定义** | 存在「流程中断（未达 FINAL）」的现场标记 + 下次启动回收动作 + 回收回执字段 |
| A5 | worktree 生命周期闭环 | 建时登记 → DONE 前强制 `git worktree remove` → 门禁断言「只剩主工作树」 |
| A6 | **既有 run 不被打破** | 用 v5.6.1 的 `progress.state` 跑新门禁，不得因新字段缺失而 FAIL |

### 判据设计输入

直接用本报告 **§七** 的六维体系（D1 复用价值 · D2 依赖引用 · D3 可重建性 · D4 证据唯一性 · D5 时效性 · **D6 出口归属**）及其组合规则。其中 **D2/D3/D5/D6 可机判**，是替换 `cleaned: []` 的落点。

### 可直接读取的证据文件（均在 `E:\Code\CodeProduct\thunder-accounting\`）

| 文件 | 内容 |
|---|---|
| `docs/sacw-cleanup-defect-report.md` | 本文件：5 条缺陷 + 行号级证据 + 六维判据 + `closeout` schema 改造草案 |
| `artifacts/sae-responsibility-audit-20260916.md` | 生态级横向审计全文（「无人定义产物必须拆除」的检索证据） |
| `.codebuddy/rules/00-project.md` §八 | 项目侧已落地的六维判据与清理器 |
| `scripts/cleanup-worktree.cjs` | 可运行的清理器（三级 + `--archive-prune` 分层）—— 判据可实现性的参考实现 |

### 实证背景（为什么值得修）

- 同型缺陷**生态内已被自己踩中**：`E:/Code/shio-al-ecosystem-archive/` 顶层 **5 代归档并存、无一代被移除**。
- 本仓一次清理**释放 8.5 GB**，其中 **5.87 GB** 是归档区里可重建的构建副本。
- SACW 全库 `worktree remove` / `worktree prune` **0 命中**；`retention` / `TTL` / `保留期` 命中**均域外**。

### 📋 可粘贴 prompt（复制到新对话开头即可）

```text
任务：修复 SACW（shio-al-coding-workflow）的收尾/清理机制缺陷。

先读这三份材料（均已落盘）：
- E:\Code\CodeProduct\thunder-accounting\docs\sacw-cleanup-defect-report.md
  含 §0 移交说明、5 条缺陷的行号级证据、六维清理判据、closeout schema 改造草案
- E:\Code\CodeProduct\thunder-accounting\artifacts\sae-responsibility-audit-20260916.md
  生态级横向审计，证明"没有任何 skill 定义过产物必须拆除"
- E:\Code\CodeProduct\thunder-accounting\.codebuddy\rules\00-project.md 的 §八

目标：C:\Users\d8502\.workbuddy\skills\shio-al-coding-workflow\（当前 v5.7.0）

要修 5 条缺陷：
1. 隔离工作区只规定建、不给拆（worktree add/remove/prune 全库 0 命中）
2. 收尾清单①判据可空转（validate_state.py:3784-3790 允许 cleaned: [] 即 PASS）
3. 收尾门禁触发面被 workspace.ref 收窄（:3776, :3791, :3804）
4. 零跨会话残留自检（"上次运行/遗留产物/未清理/stale artifact" 全库 0 命中）
5. 无"流程中断（未达 FINAL/DONE）时现场如何回收"的定义（12 态表无 CLEANUP/TEARDOWN）

硬约束：
- 必须 bump version；必须走 sacw-improver 的收尾六件套（含 changelog 追加 + skill-sync）
- 新增字段一律可选，不得让既有 progress.state（v5.6.1，停在 EXEC）变 FAIL
- 判据必须客观可判定，不得引入"询问已发起即通过"这类软判据

验收：见报告 §0「验收判据」A1–A6，逐条演示。
```

---

## 摘要

**一句话根因：生态内所有清理机制都只定义了「挪到哪」，没有一处定义「何时销毁」与「谁负责检查」。**

SACW 确有 5 条结构性缺陷（§三），支持"主因是 SACW 缺陷"的判断。但有两处需要**精确化**，否则会把修理力气用错地方：

1. SACW 的收尾机制**存在** —— FINAL 收尾清单①（v3.6.0 P0-3，2026-08-16 引入），其中第①项就是"清理确认"。所以缺陷不是"完全没有清理"，而是**判据可空转 + 触发面被收窄**。这决定了修法：**不是新增清单，而是把清单①的判据变硬**。
2. 实测 8.75 GB 中约 **7.5 GB 不属 SACW 域**（SAE 语义域 6.1 G + 项目自建隔离区 1.4 G，见 §五）。"主因"指的是**机制责任的上游性**，不是体积占比 —— 这一点必须在报告里写明，避免后续改进时把 SACW 当成体积问题的唯一解。

---

## 一、审计基础

| 项 | 内容 |
|---|---|
| 对象 | `~/.workbuddy/skills/shio-al-coding-workflow/`（**683 行 SKILL.md** + `references/` + **55 个 scripts/\*.py**，其中 `validate_state.py` 5289 行 / 330KB） |
| 方法 | 关键词定位 → 定点精读；`worktree` / `cleanup` / `closeout` / `teardown` / `retention` / `quarantine` 等分别全库检索 |
| 覆盖面声明 | `validate_state.py` 未全读，定点精读 `:3766-3814`（门禁⑫），并以 `grep -n -E "cleaned\|closeout\|worktree\|integration_exit"` 覆盖全文件命中行；`SKILL.md` 精读状态表与收尾条款 |
| 实测项目 | `E:\Code\CodeProduct\thunder-accounting`（本次问题现场） |

---

## 二、决定性证据：连机制作者自己的仓都在堆

```
E:/Code/shio-al-ecosystem-archive/
├── 20260913-workspace-cleanup
├── sae-p0-cleanup-20260909
├── sae-p0-pre-v39-cleanup-20260909-r1
├── sae-remnants-20260910
└── sae-self-20260915-matrix-v450      ← 5 代并存，无一代被移除
```

**这条是本次审计最强的证据**，因为它**推翻了两个替代解释**：
- ❌「本项目特有」—— 机制作者自己的生态仓同样在堆；
- ❌「执行方疏忽」—— 连最熟悉规则的人也在同一个坑里。

该仓仅 37 MB 所以长期没人疼；`thunder-accounting-archive` 是 6.1 GB 才被注意到。**本质是同一缺陷的两个量级表现。**

---

## 三、SACW 的 5 条缺陷（每条均可举证）

| # | 缺陷 | 证据（文件 · 行 · 原句要点） | 证据强度 |
|---|---|---|---|
| **①** | 隔离工作区**只规定建、不给拆** | `scripts/validate_state.py:3556-3575` 全文只有一句：「EXEC 应在隔离分支（`feature/sacw-<slug>`）或 worktree，`progress.state` 记录 `workspace.ref`」→ **只规定"建"与"记录"，零规定"拆"**。<br>全库检索 `worktree add` / `worktree remove` / `worktree prune` / `git worktree`：**仅 2 处命中，且均为"只读校验"**（`references/changelog.md:16` 要求执行前只读验证 worktree/origin/base commit；`scripts/daily_wiki_publish.py:141` 校验隔离 clone 存在性）。**`worktree remove` / `worktree prune` 命中数为 0。** | 已验证 |
| **②** | 收尾清单①判据**可空转** | 落档 schema（`SKILL.md:552`、`references/loop-spec.md:76`）：「`metrics.closeout{cleaned[], github_release, handoff_superseded, integration_exit}`（**全部可选字段**，旧产物不破坏）」<br>门禁实现 `scripts/validate_state.py:3784-3790`：`_co_ok = isinstance(_co_12, dict) and (isinstance(_co_12.get("cleaned"), list) or _co_12.get("github_release") is not None or _co_12.get("handoff_superseded") is not None)`<br>逐字结论：**`cleaned: []`（一个都没清）即 PASS**；**只要填了 `github_release` 或 `handoff_superseded`，`cleaned` 字段甚至不需要存在**。无"至少列 N 项""与磁盘实存对账""必须清零"任何判据。 | 已验证 |
| **③** | 收尾门禁**触发面被收窄** | `validate_state.py:3773`：`if current_state in ("FINAL", "DONE"):` —— 只有终态才查。<br>`:3776`：`_ws_ref_12 = (_ws_12 or {}).get("ref")` … `if _ws_ref_12:` —— **只有 `workspace.ref` 存在的"隔离工作区"任务才硬查**。<br>`:3804` 原文：「⑫ 收尾清单: SKIP（非隔离工作区——`workspace.ref` 不存在，集成出口/收尾清单不强制，建议记录 `metrics.closeout` 备查）」<br>`:3791`：`_lv12 = "FAIL" if current_state == "DONE" else "WARN"` —— FINAL 态缺失也只是 WARN。 | 已验证 |
| **④** | **零跨会话残留自检** | 检索 `上次运行` / `上一次运行` / `遗留产物` / `leftover` / `未清理` / `跨会话` / `累积` / `stale artifact` —— **全库 0 命中**。<br>`orphan` 有 5 处命中，但**全部**是 `validate_state.py:1632,1638,1670-1679,4824-4825` 的 **contracts req/resp 契约孤儿**，与文件系统残留无关。<br>`validate_state.py:150-200` 的门禁清单注释（①→⑫ + G0 + V3-xx）**无任何一项检查 worktree 数量 / out 目录 / artifacts 体积 / 上次 run 的产物**。 | 已验证 |
| **⑤** | **无"中断态现场回收"定义** | `SKILL.md:168-181` 的 **12 态表逐行核对，无 `CLEANUP` / `TEARDOWN` / `DISPOSE` 任何变体**。<br>检索 `teardown`：**全库仅 1 次命中**，且在 `scripts/tests/test_codex_route_application.py:77` 的 `def tearDown(self)` —— unittest 钩子，与产物收尾无关。<br>收尾清单的触发条件是「**DONE 前强制**」（`SKILL.md:545`）⇒ 流程未达 FINAL/DONE 就中断时，**收尾清单永远不会被触发**。 | 已验证 |

### 3.1 缺陷⑤在本项目已被实证触发

```
E:\Code\CodeProduct\thunder-accounting\progress.state
  workflow_version: 5.6.1
  state: EXEC          ← 停在 EXEC，无 workspace / workspace.ref 字段
  mtime: 2026-09-13 22:06
```

该 run **从未到达 FINAL/DONE** ⇒ 收尾清单**一次都没轮到执行**；且因无 `workspace.ref`，即使事后跑 `--gate`，门禁⑫ 也会走 **SKIP** 分支。

**⇒ 本项目暴露的首要缺陷是 ⑤，而不是 ②③。** 修②③（把判据变硬）不会让本项目的 8.75 GB 少一字节 —— 因为那套判据根本没被触发过。

### 3.2 但②③依然必须修（反事实检验）

假设该项目跑到了 FINAL/DONE：只要 `metrics.closeout` 填 `cleaned: []`，门禁⑫ **依然 PASS**，`ta-*` worktree 与 `out/layout-gate-*` **依然会留在盘上**。

**⇒ 收尾机制的强度不足以阻止本次残留，与流程是否中断无关。** ⑤ 与 ②③ 是**两个独立缺陷**，都要修。

---

## 四、附带发现（写入报告供改进时参考）

| # | 发现 | 证据 |
|---|---|---|
| 1 | **"清理"出口在机器可判定的枚举里已消失** | 文档写"合并 / PR / **清理** 三选"（`SKILL.md:544`；`references/changelog.md:286` 原句「收尾集成出口（ORCH-4/C2，合并/PR/**清理**三选）」）。但落到 schema 变成 `merge\|pr\|keep`（`SKILL.md:549`；`validate_state.py:3783`：`_ie_12.get("choice") in ("merge", "pr", "keep")`）。**"清理"被 `keep`（保留分支自行处理）取代，而 `keep` 不要求拆除任何东西。** |
| 2 | **相邻 skill 有同源盲区** | `sacw-audit/references/checklist-mechanisms.md:267` 的 V3-39 是"隔离工作区**硬断言**：EXEC 在 `feature/sacw-<slug>`；`main/master` + `reflow≥2` → FAIL" —— **只查"是否用了隔离"，不查"是否拆除"**。 |
| 3 | **`sacw-improver` 的"收尾六件套"不含拆除运行现场** | `sacw-improver/SKILL.md:148` §4 标题（v1.5.0 五件套→六件套）：① 生态知识回流 ①.5 changelog 追加 ② 记忆双写 ③ commit+push ④ skill-sync 4' harness 副本同步 ⑤ sync-github 镜像 **⑥ 清理无用旧内容询问**。<br>⑥ 的范围（`references/upgrade-checklist.md:113-117`）只含「缓存/构建残留（`__pycache__`/`.pytest_cache`/`*.pyc`/`.bak`/临时截图）、过时产物、历史 docs」—— **worktree、归档区、隔离区、门禁临时目录全不在内**。<br>且通过条件只是「**询问已发起**」（`:129-131` 原句「"没问" = 本项未完成」），**用户答"全部跳过"即合规**。 |
| 4 | **文档/实现漂移** | `SKILL.md:271` 写的 `sae-cleanup-manifest/v1` 在 SAE 全代码 **0 命中**；实现是 `sae-audit-archive-manifest/v3`（`sae_publish.py:556`、`sae_gate.py:3029`）。 |
| 5 | **悬空引用** | `SKILL.md:32` 声称 v3.14.0 新增"**两阶段收尾契约**"，但该词**全库仅此 1 次命中**，在 `SKILL.md` / `loop-spec.md` / `changelog.md` 中**均无任何具体定义**。 |
| 6 | SACW 自身也在留残留 | skill 目录下存在 `.pytest_cache/`（2026-09-16 12:41）与 `scripts/__pycache__/`（20 个 `.pyc`）。被 `.gitignore` 覆盖，属可接受，但佐证"跑一次就是一层残留"是该体系的默认行为。 |

---

## 五、生态级横向检索：**没有任何 skill 定义「产物必须拆除」**

范围：`C:\Users\d8502\.workbuddy\skills\` 全目录。

| 检索词 | 结果 | 判定 |
|---|---|---|
| `worktree remove` / `worktree prune` / `git worktree remove` | **skills 目录 0 命中**；唯一命中在**项目内**文件（`docs/cleanup-policy-plan.md`、`artifacts/cleanup-report-20260916.json`） | 生态侧无规则 |
| `必须拆除` / `must be removed` / `须当日摘除` | **0 命中** | 无任何"必须拆除"表述 |
| `retention` / `保留期` / `到期` | 命中均**域外**（`first-principle` 知识留存、`company-research` 用户留存率、`cloudflare-one` 日志留存、`project-memory-governance` 决策日志 30 天归档） | 无一条针对运行产物 |
| `TTL` | 命中均**域外**（`ck3-mod-maker` `MARKER_TTL=1800`、`mcp-gatekeeper` `SESSION_TTL=86400`、`error-memory-loop` 90 天）。**SACW 自己的 TTL 只作用于"错误记忆 90 天"，不作用于运行产物** | 同上 |
| `teardown` / `销毁` / `拆除` | 均**域外**（浏览器 teardown 等） | 无运行产物语义 |
| `quarantine` / `隔离区` | 均**域外**（火绒隔离区、DMARC `p=quarantine`）⇒ `thunder-accounting-cleanup-quarantine-*` 是**项目自建** | 无 SAE/SACW 语义 |
| `清理`/`归档`/`残留`/`临时目录`/`瘦身`（限 `**/SKILL.md`） | **生态内唯一**是 `sacw-improver/SKILL.md` 的六件套⑥，且为**询问式** | 生态内无硬规则 |

**结论：只有 SACW（收尾清单① + 六件套⑥，均软询问）与 SAE（归档，只建不拆）有相关内容；没有任何 skill 定义保留期、TTL 或"必须拆除"。**

**旁证**：`workspace-archive-migration/SKILL.md` 今日（2026-09-16 12:49）新建，描述含「**也适用于给任意项目建立"文档不得散落"的机制约束**」—— 生态刚开始反应，但**作用域是"文档"而非"运行产物"**，且不含保留期。

---

## 六、责任映射（8.75 GB 逐类，全部实测）

| # | 产物 | 体积 | 责任方 | 强度 |
|---|---|---|---|---|
| 1 | `thunder-accounting-archive/sae-self-20260915-matrix-v450/`（36 项构建副本） | **6.1 G** | **SAE 定义了归档入口与语义；实际搬运由一次性脚本 `archive_target_artifacts.py` 完成**（其 schema 为 `target-project-archive-report/v1`、journal 为 `.journal.jsonl`，**非** SAE 的 `sae-audit-archive-receipt/v3`；`sae_gate.py apply-archive` 只处理生态仓 2 项） | 已验证 |
| 2 | `thunder-accounting-cleanup-quarantine-v1.16.1/` | **1.4 G** | **项目自建**（`quarantine` 在 SACW/SAE 全库 0 命中；配套 manifest schema 为自定义 `thunder-accounting-cleanup-v1.16.0` / `completed_with_quarantine`，非 SAE 三套 schema 任一） | 已验证 |
| 3 | `out/` 下 **69 个门禁临时目录**（20 `layout-gate` + 15 `profile-gate` + 9 `desktop-parity` + 7 `dp-` …）+ 1137 文件 | 438 M | **项目自建门禁脚本**：`verify-android-layout.cjs:193` `harness.uniqueScratch('layout-gate')`、`verify-desktop-parity.cjs:249`、`verify-profile-mobile.cjs:177`。清理逻辑在 `finally` 里但**失败被静默吞**（`} catch { /* 清理失败可忽略 */ }`） | 已验证 |
| 4 | `release163/` + `app-out/` + `dist-android/` | ~388 M | 项目自建构建配置（`.gitignore` 忽略 → `git status` 0 条，无信号） | 已验证 |
| 5 | **5 个游离 worktree**（224 MB，全 detached HEAD、全在项目外） | 224 M | **SACW 缺「拆」规则（缺陷①）；「建」的纪律反而是项目自建**（`.codebuddy/rules/00-project.md` §28「需要结论的量测应在冻结 worktree 上做」） | 已验证 |
| 6 | `artifacts/` 内 30+ 一次性脚本/日志 | 1.8 M | **执行方习惯 + 体系盲区**：SAE 的 `cleanup_manifest()` 本会归档它们，但一次性脚本用了 `EXCLUDE_RE = ^(sae\|sacw\|signal)` 且"只取目录、不取文件" ⇒ **散落文件既不被归档也不被清理** | 推断 |
| 7 | `E:/Code/` 顶层 20+ staging/recovery 残留 | 未计 | 生态发布/恢复流程（命名与 `sae_publish.py` 两阶段事务同源） | 推断（未逐目录核对） |

**⇒ 归因结论**：SACW 是**唯一有收尾钩子却不可判定**的一环（"主因"成立）；SAE 是**只有入口没有出口**；项目自建门禁是**清理失败被静默吞**。三者共同构成缺失闭环。

---

## 七、清理依据（六维可判定体系 — 建议作为 SACW 收尾清单①的新判据）

用户给定 D1/D2，补 D3–D6。**设计目标＝可落到门禁、不可空转**（这正是修缺陷②的关键）。

| 维度 | 来源 | 判据问题 | 判定方式 | 方向 |
|---|---|---|---|---|
| **D1 复用价值** | 用户 | 一次性实验产物，还是会被再次使用的资产？ | 人判（部分机判：是否在"可复用清单"内） | 一次性 → 偏删；可复用 → 留 |
| **D2 依赖引用** | 用户 | 有谁引用它？（脚本 / 清单 / 文档 / 分发链路） | **机判**：全仓 `grep` 引用 + 固定分发清单（`latest.yml` 等） | 有引用 → **必留** |
| **D3 可重建性** | 补充 | 能否从源码/配置重建？重建成本多大？ | **机判**：是否在构建输出目录 / 是否可由 `npm run <x>` 重生成 | 可重建且低成本 → 偏删 |
| **D4 证据唯一性** | 补充 | 是唯一记录吗？删了能否复现该次实验/验收？ | 人判（对照实验、验收回执、审计证据） | 唯一证据 → **必留** |
| **D5 时效性** | 补充 | 是否已被更新版本取代？ | **机判**：版本号比对 + mtime | 已取代且无引用 → 偏删 |
| **D6 出口归属** | 补充 | 移出后谁负责销毁？有规则吗？ | **机判（制度判据）** | 无出口 → **禁止只移出** |

### 组合决策规则

```
可自动清理 ⟸ D1(一次性) ∧ D3(可重建) ∧ D2(无引用)
必须保留   ⟸ D4(唯一证据) ∨ D2(有引用)
需授权清理 ⟸ D5(已过时) ∧ D2(无引用)
禁止只移出 ⟸ D6(无出口)              ← 元判据
无法判定   ⟹ 不得自动删，转人工确认
```

**D6 由证据闭环**：09-15 把 6 GB 从项目搬到项目外（合规、`failed=0`）、SAE 家仓堆 5 代归档、隔离区搁置 18 天 —— 三者都是"只移出、无出口"的同一形态。出口缺失 ⇒ 问题被转移到**可见性更低处**（项目外没有 `git status`、没有门禁、没有清理器）。

### 与现有门禁的对接方式（供 SACW 更新时参考）

把 `metrics.closeout` 从"可选字段"改为：

```jsonc
"closeout": {
  "scan": { "scope": ["out/", "artifacts/", "worktrees", "<project>-archive"], "found": 69 },
  "decisions": [
    { "path": "out/layout-gate-3712-xxxx", "D1": "一次性", "D2": "无引用", "D3": "可重建", "verdict": "delete" },
    { "path": "artifacts/g21-ctl-injection.diff", "D4": "唯一证据", "verdict": "keep" }
  ],
  "integration_exit": { "choice": "merge|pr|keep", "ref": "...", "date": "..." }
}
```

判据要点：**`scan.found` 必须与 `decisions` 数量对账**（防止"扫出 69 项却只对 1 项下结论"）；**`decisions` 为空数组不再 PASS**；**`workspace.ref` 不再是触发前提**。

---

## 八、本轮未做与待决

**本轮未做**（按用户要求）：
- ❌ 未修改 SACW 任何文件（`~/.workbuddy/skills/shio-al-coding-workflow/` 保持原样）
- ❌ 未修改 SAE 任何文件
- ❌ 未执行任何产物删除

**待决**：
1. **SACW 更新权限与落地路径** —— 走生态内的 `sacw-improver`（其"收尾六件套"正是改进闭环），还是直接改 canonical snapshot？
2. **是否同步出 SAE 缺陷报告** —— 7.5 GB（6.1 G 归档 + 1.4 G 隔离区）在 SAE 域，且已实证"SAE 家仓自己堆 5 代"。本轮用户未提及。
3. **`E:/Code/` 顶层 20+ staging/recovery 残留**是否纳入治理范围（归属未逐目录核对，标推断）。
