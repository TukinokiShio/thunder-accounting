# 实验产物治理方案（cleanup policy）

> **状态：归因已修正 · 清理已执行（A+B+C 分层，释放 ≈7.8 GB）· SACW 升级挂起（本轮无权限）** — 本文件写于 2026-09-16，同日修订
> **执行详情见 `docs/cleanup-execution-report-20260916.md`**（执行前基线 / 逐项记录 / 释放对账 / 验证 / 踩坑 / **§八 不可复算项**）
> 任何节点完成后**必须当日回填**下方「节点状态」表；本文件是进度的**唯一入口**。
> 配套：缺陷报告 `docs/sacw-cleanup-defect-report.md` · 生态审计 `artifacts/sae-responsibility-audit-20260916.md` · 清理器 `scripts/cleanup-worktree.cjs` · 实测 `artifacts/cleanup-report-20260916.json` · 纪律 `.codebuddy/rules/00-project.md` §八

---

## 一、归因（2026-09-16 修订）

**修订说明**：本文件初版把根因写成「项目自身四层缺失」。经两轮只读审计后修正 —— 那是**症状层**，真实根因在**生态机制层**。

> **一句话根因：生态内所有清理机制都只定义了「挪到哪」，没有一处定义「何时销毁」与「谁负责检查」。**

### 1.1 决定性证据：连机制作者自己的仓都在堆

```
E:/Code/shio-al-ecosystem-archive/
├── 20260913-workspace-cleanup
├── sae-p0-cleanup-20260909
├── sae-p0-pre-v39-cleanup-20260909-r1
├── sae-remnants-20260910
└── sae-self-20260915-matrix-v450      ← 5 代并存，无一代被移除
```

该仓仅 37 MB 所以长期没人疼，`thunder-accounting-archive` 是 6.1 GB 才被注意到 —— **本质是同一缺陷的两个量级表现**。这条**推翻了"本项目特有 / 执行方疏忽"两个替代解释**。

### 1.2 生态横向检索：无人定义「产物必须拆除」

| 检索词 | 结果 |
|---|---|
| `worktree remove` / `worktree prune` | **整个 `~/.workbuddy/skills/` 0 命中** |
| `必须拆除` / `must be removed` | **0 命中** |
| `retention` / `保留期` / `到期` | 命中均域外（知识留存率、日志留存） |
| `TTL` | 命中均域外；SACW 自己的 TTL 只作用于**错误记忆 90 天**，不作用于运行产物 |
| `quarantine` / `隔离区` | 命中均域外 ⇒ 本项目隔离区是**自建** |

**⇒ 只有 SACW（收尾清单① + `sacw-improver` 六件套⑥，均软询问）与 SAE（归档，只建不拆）有相关内容。**

### 1.3 三层责任

| 责任方 | 缺陷性质 | 证据 | 对应产物 |
|---|---|---|---|
| **SACW（主因）** | 5 条结构性缺陷 | `docs/sacw-cleanup-defect-report.md` §三，全部有文件行号 | worktree 残留、`artifacts/*` 无回收规范、跨会话零自检 |
| **SAE（独立责任面）** | 有授权门与归档回执，但**无保留期 / 无销毁规则**（`retention`/`TTL` 检索 0 命中） | `sae-audit-improve-workflow/SKILL.md:114,271,272` | **6.1 G 归档区 + 1.4 G 隔离区** |
| **项目侧（次因）** | 只有文本要求、无机制挂载点；门禁清理失败被静默吞 | `.codebuddy/` 无 `settings.json`/`hooks/`；`git status` 恒 0 条；`verify-*.cjs` 的 `catch { /* 可忽略 */ }` | `out/` 下 69 个门禁临时目录 |

**关键理解**："SACW 是主因"指的是**机制责任的上游性**（它是整条编码流程的上游，且是**唯一有收尾钩子**的一环），不是体积占比 —— 实测 8.75 GB 中约 **7.5 GB 不属 SACW 域**。修 SACW 一次覆盖所有用它的项目；修项目只是逐项目打补丁。

### 1.4 基线（实测）

| 位置 | 体积 | 口径 |
|---|---|---|
| `out/`（69 个门禁临时目录 + 1137 文件） | 438 MB | 项目内可回收 |
| `release163/` + `app-out/` + `dist-android/` | ~388 MB | 项目内可回收 |
| 5 个游离 worktree（全 detached、全在项目外） | 224 MB | 项目外可回收（4 干净 + 1 脏） |
| `thunder-accounting-archive/` | 6.1 GB | **需裁定**（SAE 语义域） |
| `thunder-accounting-cleanup-quarantine-v1.16.1/` | 1.4 GB | **需裁定**（项目自建） |
| `exe/` + `artifacts/` | 488 MB | **保留项** |
| **合计** | **≈8.75 GB** | 项目外 7.45 GB > 项目内 822 MB |

---

## 二、清理依据：六维判据（本方案核心）

用户给定 D1/D2，补 D3–D6。**设计目标＝可落到门禁、不可空转**。

| 维度 | 来源 | 判据问题 | 判定方式 | 方向 |
|---|---|---|---|---|
| **D1 复用价值** | 用户 | 一次性实验产物，还是会被再次使用的资产？ | 人判（部分机判：是否在"可复用清单"内） | 一次性 → 偏删；可复用 → 留 |
| **D2 依赖引用** | 用户 | 有谁引用它？（脚本 / 清单 / 文档 / 分发链路） | **机判**：全仓 `grep` 引用 + 固定分发清单（`latest.yml` 等） | 有引用 → **必留** |
| **D3 可重建性** | 补充 | 能否从源码/配置重建？重建成本多大？ | **机判**：是否在构建输出目录 / 是否可由 `npm run <x>` 重生成 | 可重建且低成本 → 偏删 |
| **D4 证据唯一性** | 补充 | 是唯一记录吗？删了能否复现该次实验/验收？ | 人判（对照实验、验收回执、审计证据） | 唯一证据 → **必留** |
| **D5 时效性** | 补充 | 是否已被更新版本取代？ | **机判**：版本号比对 + mtime | 已取代且无引用 → 偏删 |
| **D6 出口归属** | 补充 | 移出后谁负责销毁？有规则吗？ | **机判（制度判据）** | 无出口 → **禁止只移出** |

### 2.1 组合决策规则

```
可自动清理 ⟸ D1(一次性) ∧ D3(可重建) ∧ D2(无引用)
必须保留   ⟸ D4(唯一证据) ∨ D2(有引用)
需授权清理 ⟸ D5(已过时) ∧ D2(无引用)
禁止只移出 ⟸ D6(无出口)              ← 元判据
无法判定   ⟹ 不得自动删，转人工确认
```

### 2.2 与机器执行分级（SAFE / CONFIRM / KEEP）的映射

六维是**判据来源**，三级是**执行动作分级**。映射关系：

| 六维结论 | 执行分级 | 清理器行为 |
|---|---|---|
| 可自动清理 | `SAFE` | `--apply` 即删 |
| 需授权清理 | `CONFIRM` | 需 `--apply --include-risky` |
| 必须保留 | `KEEP` | 永不自动删，只报告 |
| 禁止只移出 | **制度禁令** | 不进清理器（属规则层，见 §四 N3） |
| 无法判定 | — | 不自动删，转人工 |

---

## 三、节点与依赖（DAG）

```
N0 清理 SAFE 级 1.00GB ────────────┐
                                   ├─→ N4 归档区 / 隔离区裁定（需用户决策）
N1 门禁脚本自清理改造 ──→ N2 npm 钩子挂载 ──┘
                                   │
N3 出口规则写入 rules/AGENTS.md ───┘

S1 SACW 缺陷报告 ──→ S2 SACW 更新（**本轮无权限，挂起**）
```

- **可并行**：N0 · N1 · N3
- **串行**：N1 → N2（先有干净的判定脚本，再挂到打包链路）
- **需外部输入**：N4（用户拍板保留期）· S2（用户授予 SACW 更新权限）

### 节点状态（唯一进度源）

| 节点 | 内容 | 依赖 | 状态 |
|---|---|---|---|
| **S1** | SACW 缺陷报告（含 §0 移交说明 + 可粘贴 prompt） | 无 | ✅ **已完成** → `docs/sacw-cleanup-defect-report.md` |
| **S2** | 更新 SACW（把 §二 六维判据落成收尾清单①硬判据） | S1 + **用户授权** | ⛔ **挂起** —— 本轮无权限，交由**另一对话**执行（入口见报告 §0） |
| N0 | 清理 SAFE 级 | 无 | ✅ **已执行**（2026-09-16）—— 释放 ≈662 MB；`release163` 剩 **98 MB** 被锁未删 |
| N1 | 门禁脚本自清理 + 失败可见 | 无 | ⬜ 待批准 |
| N2 | `predist:win` / `postdist:win` 挂载 | N1 | ⬜ 待批准 |
| N3 | 出口规则写入 rules / AGENTS.md | 无 | ✅ **部分**（六维判据与"出口三问"已写入 §八；保留期数值待定） |
| N4 | 归档区 / 隔离区裁定 | 用户决策 | ✅ **已执行** —— 隔离区 1.30 GB 已删；归档区**分层**（删 5.87 GB / 留证据层 60 MB + 索引） |
| — | 新增：脚本安全门闩 + `--archive-prune` | 无 | ✅ **已执行**（见 §四 P1） |

### 执行记录（2026-09-16）

| 项 | 结果 |
|---|---|
| A 档 | `out/` `app-out/` `dist-android/` `__missing_android_project__/` + 5 worktree（224 MB）✅ 已删 |
| A 档残留 | ⚠️ `release163/win-unpacked/resources/app.asar` **98 MB 被锁**（`EBUSY`，3 次重试失败）—— 嫌疑为火绒实时防护；**处置：加信任区或重启后重删，不建议关实时防护** |
| B 档 | 隔离区 1.30 GB + `release/*.log`×4 + `progress.state.v1176-archive-20260913` ✅ 已删 |
| C 档 | 归档可重建层 22 项 / **5.87 GB** ✅ 已删（0 失败）；证据层 18 项 / 60 MB 保留；归档区 **5.93 G → 62 M** |
| **合计释放** | **≈ 7.8 GB**（计划 8.5 GB） |
| 验证 | `git worktree list` 只剩主树 ✓ · `prune --dry-run` 无输出 ✓ · 证据层 14 目录完整 ✓ · `ta-*` 与隔离区全清 ✓ |
| ⚠️ 踩坑 | `ta-*` 内 `node_modules` 是**指向主项目 node_modules 的符号链接** —— 跟随链接的清理会摧毁主项目依赖。正确做法：`unlink <dir>/node_modules` 再 `rmdir <dir>`。本次主项目 `node_modules`（613 项 / 852 M）完好 |
| 留档 | 归档索引 4 文件 → `artifacts/sae-self-20260915-index/`（⚠️ `artifacts/` 被 gitignore ⇒ **在盘不在库**） |

---

## 四、各节点方案

### S2 · 更新 SACW（**本轮不做**，供后续执行时参照）

把 `docs/sacw-cleanup-defect-report.md` §三 的 5 条缺陷与 §七 的六维判据落进 SACW。要点：

1. **缺陷①**：建 worktree 时登记 → DONE 前强制 `git worktree remove` → 加"只剩主工作树"门禁
2. **缺陷②**：`metrics.closeout` 从"可选字段"改为必须给出 `scan`（扫描范围 + 命中数）+ `decisions[]`（每项按六维给判据与结论）；**`scan.found` 与 `decisions` 数量必须对账**；空数组不再 PASS
3. **缺陷③**：去掉 `workspace.ref` 前置条件；DONE 态缺失由 WARN 改 FAIL
4. **缺陷④**：`TASK_CLASSIFY` 阶段加"上次残留扫描"
5. **缺陷⑤**：定义中断标记 + 下次启动回收 + 回收回执

### N0 · 清理 SAFE 级（1.00 GB）

```
node scripts/cleanup-worktree.cjs --apply
```

覆盖：`out/` `app-out/` `dist-android/` `release163/` `__missing_android_project__/` `out/tsconfig.node.tsbuildinfo` + 4 个干净 worktree（走 `git worktree remove`，非 `rm`）。

**证据保全**：`ta-gate-ctl-g21` 的注入改动已导出 `artifacts/g21-ctl-injection-20260916.diff`（1465 B）；脏 worktree **不在本节点范围**。

**理由（已实测）**：`out/` **不是** electron-vite 输出（那是 `app-out/main|preload|renderer`），而是 `tsconfig.node.json`/`tsconfig.web.json` 的 `outDir: "./out"` —— 只有误用 `tsc -b` 才会写入；`npm run typecheck` 四个 tsconfig **全走 `--noEmit`**，不写 `out/`。

**前置检查**：确认无本地 http 服务占用 `out/`（§18 实证过占用导致 `rm` 失败并让后续步骤静默跳过）。

### N1 · 门禁脚本自清理改造（治本）

4 个门禁脚本的 `fs.rmSync(tmpDir, …)` 都包在 `try` 里，注释「清理失败可忽略」→ **失败被静默吞**。改造两处：

1. **运行前先清自己的遗留**：扫描 `out/<self-prefix>-*`，删除超过 N 小时的遗留（判据＝前缀 + mtime，确定性）。**阈值待定**（初版拍 12h，与并发 worker 场景有冲突风险，见验收 V1 备注）
2. **清理失败改为可见**：静默 `catch {}` → 输出 `cleanup_warnings[]`；**门禁退出码不受影响**（清理失败不该让门禁变红，但必须看得见）

### N2 · npm 钩子挂载

**已实测**（npm 10.9.7 / node v22.22.2，隔离目录 `npm-hook-probe`，测毕已拆）：`predist:win` / `postdist:win` **确实被 `npm run dist:win` 触发**，冒号形式正常识别，无冒号对照组同样命中。

```jsonc
"predist:win":  "node scripts/cleanup-worktree.cjs --guard",   // 体检：打印未清理项，永不阻断
"postdist:win": "node scripts/cleanup-worktree.cjs --apply"    // 打包成功后自动清 SAFE 级
```

**成本提示（需拍板）**：改 `package.json` 后按 AGENTS.md 需同步版本号并走一轮完整发布（Clean Build → electron-builder → ISCC → 静默安装 → 验证 → commit/push）。**为加两个钩子跑一轮发版是否划算，请裁定**；不批准则跳过，N1+N3 仍可独立成立。

### N3 · 出口规则（治 D6）

| 对象 | 规则 | 判据 |
|---|---|---|
| 冻结 worktree | 量测结束**当日**摘除，不跨天；跨天须在 `artifacts/` 留说明 | `git worktree list` 只剩主工作树 |
| SAE 归档区 | 保留期 ≤ 30 天；**同期最多 1 个 `release_id`**；长期留 `journal.jsonl` + `report.json` + `run.log`（约 46 KB） | 目录数 ≤ 1 且 mtime ≤ 30 天 |
| 清理隔离区 | TTL **7 天**，到期未确认即删 | 目录 mtime ≤ 7 天 |

**通用条款**：任何「把东西挪走」的机制，必须**同时**定义 ①挪到哪 ②什么时候销毁 ③谁负责检查。

> ⚠️ **注意**：这三条是**项目级补丁**，生态侧（SACW/SAE）没有对应规则。它们解决本项目，不解决"下一个项目"。**根治仍需 S2。**

### N4 · 归档区 / 隔离区裁定

| 对象 | 体积 | 选项 |
|---|---|---|
| `thunder-accounting-cleanup-quarantine-v1.16.1` | 1.4 GB | 该目录本就是为「待确认后删除」而建，已搁置 18 天 → **建议删除** |
| `thunder-accounting-archive` | 6.1 GB | ①全留 ②**只留索引 3 文件（46 KB）+ 删内容**（建议） ③全删 |

依据：36 目录 / 57784 文件 / 6071 MB，`failed=0`，`removed=True`，授权来源「用户 2026-09-15 问答选项」。约 5.8 GB 是 `build-v1.16.0`(×6) `custom-install-*`(×4) `installed-1.15.x`(×3) `inspect-*`(×4) 等**可重建构建副本**。

---

## 五、验收标准

| # | 验收项 | 判据 | 检查方式 |
|---|---|---|---|
| V1 | 门禁不再泄漏 | 连跑 3 次门禁后 `out/` 中临时前缀目录数 **== 0**（当前 69） | 实测计数 |
| V2 | 打包自动清理 | `npm run dist:win` 后 SAFE 总量 **≤ 50 MB** | 跑清理器报告 |
| V3 | 体检不阻断 | 人为制造未清理项时，`predist:win` 后打包仍 **exit 0** | 注入未清理项 |
| V4 | 白名单不误伤 | 报告 OUT OF SCOPE 段列出全部 10 个兄弟目录，且 `git status` 干净 | 实测 |
| V5 | worktree 无悬空 | `git worktree list` 只剩主工作树；`git worktree prune --dry-run` 无输出 | 实测 |
| V6 | 归档/隔离有出口 | N3 规则写入 rules，且当前目录满足保留期 | 读文件 + 对账 |
| V7 | **六维判据可对账** | 清理报告每项都能标出 D1–D6 取值，且 `SAFE` 项满足 `D1∧D3∧D2无引用` | 跑报告逐项核对 |

### 未闭合风险（来自审计，勿当已解决）

- **`dist-android/` 是否该留在 SAFE**：它是 Capacitor webDir，可重建但会**多一步** vite build。建议降 `CONFIRM`（待定）。
- **N1 的 12h 阈值是拍的**，且与并发 worker 场景（§21 有一次并发提交事故）有冲突风险 —— 阈值过小会删掉正被另一进程使用的临时目录。
- **`postdist:win` 在打包失败时是否仍触发 —— 未测**。若失败也触发，会在半成品状态下删 `release/win-unpacked`。最小验证：在隔离 probe 里让 body `exit 1`，看 POST 是否仍执行。
- **`du` 报的是逻辑大小**：6.1 GB 归档含 6 份重复构建副本，实际占用未测（`du --apparent-size` 对比）。
- **`release163/` 是否被某条回滚路径引用 —— 未 grep**。
- **`out/dp-*` / `g21-*` 的生成者未穷尽溯源**（已知 4 个 `verify-*.cjs`，但命名变体可能来自手工）。

---

## 六、风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 改 `package.json` 触发版本 bump + 完整发布 | 一轮打包 + 安装 + push 成本 | N2 可与 N1/N3 解耦；不批准则跳过 |
| `out/` 被本地 http 服务占用 | 删除失败 | 脚本已容错（失败逐项报告，不 abort）；执行前确认无占用（§18） |
| 自动删 `dist-android/` | 下次 `cap sync` 前须先 `build:android` | 建议降级为 CONFIRM |
| worktree 走 `rm` 留悬空元数据 | git 状态异常 | 脚本 `isWorktree` 分支强制走 `git worktree remove`；已负向验证命令形态（不存在路径 → `is not a working tree` / exit 128） |
| 删除不可逆 | 证据永久丢失 | 六维判据 + `KEEP` 永不自动删 + 脏 worktree 硬跳过 + 执行前导出 diff |

**回滚**：N0/N4 删除对象**全部可重建**（构建产物）或**已保全索引**（对照 diff、归档 journal）；N1 增量改造，`git revert` 单文件即可；N2 删除 `package.json` 两行即回滚。

---

## 七、待用户裁定（五项）

| 项 | 内容 | 我的建议 |
|---|---|---|
| A | 批准 N0 清理 1.00 GB | **批准**（零证据价值） |
| B | 隔离区 1.4 GB | **删除** |
| C | 归档区 6.1 GB | **只留索引 46 KB** |
| D | 是否允许改 `package.json`（触发一轮发版） | 视你对发版节奏的偏好；不批准则 N2 跳过 |
| **E** | **授予 SACW 更新权限 / 指定落地路径** | 建议走生态内 `sacw-improver`（其"收尾六件套"正是改进闭环）；**这是唯一能根治的路径** |
