# 详细磁盘清理报告（本次执行）

> 执行日期 **2026-09-16** · 执行者 WorkBuddy · 提交 `dee5f5e`
> 结论摘要：**释放 ≈7.8 GB**（计划 8.5 GB）· 1 项残留 98 MB · 0 项失败（除该残留）
> 配套：`docs/cleanup-policy-plan.md`（方案）· `docs/sacw-cleanup-defect-report.md`（SACW 缺陷报告，含 §0 移交说明）· `scripts/cleanup-worktree.cjs`（清理器）
> ⚠️ 本报告含**执行前基线**数据；其中标注「不可复算」的项**现场已消失**，此后无法再独立验证。

---

## 一、执行摘要

| 指标 | 值 |
|---|---|
| 执行范围 | A（项目内可重建产物 + worktree）· B（隔离区 + 日志/归档状态）· C（归档区**分层**） |
| 释放总量 | **≈ 7.8 GB** |
| 删除对象数 | A 13 项 · B 6 项 · C 22 项 = **41 项** |
| 失败 | 1 项（`release163` 残留 98 MB，非失败而是**被占用**） |
| 保留项 | 归档证据层 18 项 / 60 MB · `exe/` 487 M · `release/` 558 M · `artifacts/` 2 M · `release-android/` 43 M |
| SACW / SAE skill | **未修改任何文件**（按用户要求） |

---

## 二、执行前基线（实测，2026-09-16）

### 2.1 项目内

| 路径 | 体积 | 性质 |
|---|---|---|
| `out/` | 434.9 MB | 1137 文件；含 **69 个门禁临时目录**（`layout-gate-*` 20 · `profile-gate-*` 15 · `desktop-parity-*` 9 · `dp-*` 7 · 其他）+ 误用 `tsc -b` 的产物 |
| `release163/` | 383.7 MB | 旧版解压目录（`win-unpacked`） |
| `app-out/` | 1.9 MB | electron-vite 构建产物 |
| `dist-android/` | 1.7 MB | Capacitor webDir |
| `__missing_android_project__/` | 1.6 KB | 空壳 |
| `out/tsconfig.node.tsbuildinfo` | 73.1 KB | TS 增量缓存 |
| `release/*.log` ×4 | 179.6 KB | 1.16.2 / 1.16.3 / 1.16.3b / 1.17.7 打包日志 |
| `progress.state.v1176-archive-20260913` | 14.8 KB | 旧版本状态快照（**git 跟踪中**） |
| **保留项** | `exe/` 487 M · `release/` 558 M · `release-android/` 43 M · `artifacts/` 1.5 M | AGENTS.md 指定 / 审计证据 |

### 2.2 项目外（`E:\Code\CodeProduct\`）

| 路径 | 体积 | 性质 |
|---|---|---|
| `ta-a7-ctl` | 48 M | 冻结 worktree（detached `2ef8fae`，干净） |
| `ta-a7-new` | 21 M | 冻结 worktree（detached `27951cd`，干净） |
| `ta-gate-baseline` | 102 M | 冻结 worktree（detached `470395c`，干净） |
| `ta-gate-ctl` | 14 M | 冻结 worktree（detached `470395c`，干净） |
| `ta-gate-ctl-g21` | 39 M | 冻结 worktree（detached `470395c`，**含 2 处未提交注入改动**） |
| `thunder-accounting-archive/` | **5.93 GB** | 2026-09-15 23:52 SAE 流程授权移出的 36 个目录 / 57784 文件 |
| `thunder-accounting-cleanup-quarantine-v1.16.1/` | **1.30 GB** | 2026-08-29 清理的隔离区（搁置 18 天） |
| **项目外合计** | **7.45 GB** | 是项目内（822 MB）的 9 倍 |

### 2.3 归档区构成（**仅存于对话记录，未落盘 → 不可复算**）

| 类别 | 份数 × 体积 | 实质 |
|---|---|---|
| `build-*` | 7 × 383.7 M = **2.69 G** | electron-builder `win-unpacked` 副本；`build-v1.16.0` 与 `build-v1.16.0-final` 是**同版本两次拷贝** |
| `custom-install-*` | 4 × 388 M = **1.55 G** | 定制安装版副本 |
| `installed-1.15.x` | 3 × 388 M = **1.16 G** | 已安装目录快照 |
| `inspect-*` | 2 × 111 M = **222 M** | 解包检查副本 |
| `verify-app-asar-1.16.5` | 1 × 111 M | asar 校验副本 |
| `inno-v*` | 2 × 92 M = **184 M** | Inno 安装包副本 |
| `inno-syntax-check-*` | 1 × 92 M + 2 × 0 B | 语法检查临时目录 |
| 证据层 14 项 | **60 M** | `visual-v1.16.4`(58.8M) · `visual-v1.16.0` · `repro-*` · `aurora` · `review` · `eval` · `score` · `audit-round-2` · `spike-android` · `improve` · `knowledge` · `inno` · `rollback-v1.14.14`(空) |
| 根级索引 | 46 KB | `journal.jsonl` · `target-archive-report.json` · `archive-run.log` · `archive_target_artifacts.py` |

---

## 三、执行记录（逐项）

### 3.1 前置门禁

| # | 动作 | 结果 |
|---|---|---|
| 1 | 断言对照证据已落盘：`artifacts/g21-ctl-injection-20260916.diff` | ✅ **1465 B**（= 预期值，非空）→ 允许继续 |
| 2 | 前置检查：无本地 http 服务占用 `out/` | ✅ 未发现占用 |

### 3.2 A 档（项目内 + worktree）

命令：`node scripts/cleanup-worktree.cjs --apply`

| 目标 | 体积 | 结果 |
|---|---|---|
| `out/` | 434.9 MB | ✅ 已删 |
| `app-out/` | 1.9 MB | ✅ 已删 |
| `dist-android/` | 1.7 MB | ✅ 已删 |
| `__missing_android_project__/` | 1.6 KB | ✅ 已删 |
| `ta-a7-ctl` | 48 M | ✅ `git worktree remove` |
| `ta-a7-new` | 21 M | ✅ `git worktree remove` |
| `ta-gate-baseline` | 102 M | ✅ `git worktree remove` |
| `ta-gate-ctl` | 14 M | ✅ `git worktree remove` |
| `release163/` | 383.7 MB | ⚠️ **失败** —— `EBUSY: resource busy or locked, unlink '…/release163/win-unpacked/resources/app.asar'` |
| `ta-gate-ctl-g21`（脏） | 39 M | ⏭️ 脚本按设计**硬跳过** |

首次运行结果：**成功 8 项 / 失败 1 项 / 跳过 1 项**。

**补做**：

| # | 动作 | 结果 |
|---|---|---|
| 1 | `git worktree remove --force` 摘除 `ta-gate-ctl-g21` | ✅ 退出码 0 |
| 2 | `git worktree prune` | ✅ 退出码 0 |
| 3 | `release163` 重试（共 4 次，含 5s 等待） | ❌ 全部 `EBUSY` |
| 4 | `release163` 降级清理：删其余全部文件 | ✅ 384 MB → **剩 98 MB**（仅 `app.asar`） |
| 5 | 清 `ta-*` 残留空目录（5 个） | ✅ 见 §六 陷阱 |

### 3.3 B 档

命令：`node scripts/cleanup-worktree.cjs --apply --include-risky`

| 目标 | 体积 | 结果 |
|---|---|---|
| `thunder-accounting-cleanup-quarantine-v1.16.1/` | 1.30 GB | ✅ 已删 |
| `release/*.log` ×4 | 179.6 KB | ✅ 已删 |
| `progress.state.v1176-archive-20260913` | 14.8 KB | ✅ 已删（**git 跟踪文件，提交中记录为 `D`**） |
| `thunder-accounting-archive/` | 5.93 GB | ⏭️ **未被触及**（安全门闩生效，见 §六） |

结果：**成功 6 项 / 失败 1 项**（仍为 `release163`）。

### 3.4 C 档（归档区**分层**）

命令：`node scripts/cleanup-worktree.cjs --archive-prune`（先 report 核对）→ `--archive-prune --apply`

**判据**：正向前缀白名单 —— `build-` / `custom-install-` / `installed-` / `inspect-` / `verify-app-asar-` / `inno-v` / `inno-syntax-check-`。**白名单外一律保留**（默认保留是有意选择）。

| 结果 | 值 |
|---|---|
| 删除 | **22 项 / 5.87 GB**，失败 0 |
| 保留 | **18 项 / 60.0 MB**（14 个证据目录 + 4 个根级索引文件） |
| 归档区总体积 | **5.93 GB → 62 MB** |

**执行前留档**：4 个根级索引文件已复制到 `artifacts/sae-self-20260915-index/`（`archive-run.log` 2387 B · `archive_target_artifacts.py` 6403 B · `target-archive-report.json` 16726 B · `journal.jsonl` 26883 B）。
⚠️ `artifacts/` 被 `.gitignore` 忽略 ⇒ 该备份**在盘不在库**。

---

## 四、释放账目对账

| 档 | 实删 | 备注 |
|---|---|---|
| A | **662.5 MB** | `out` 434.9 + `app-out` 1.9 + `dist-android` 1.7 + worktree 224 |
| B | **1,300.2 MB** | 隔离区 1300 + 日志 0.18 + 快照 0.015 |
| C | **5,870 MB** | 5.87 GB |
| **合计** | **≈ 7,833 MB ≈ 7.8 GB** | 计划 8.5 GB |

**计划与实际的差额（≈0.7 GB）来源**：
1. `release163` 未删部分 **98 MB**（被占用）；
2. 归档分层预估 6.05 GB，实际命中 **5.87 GB**（预估时把 7 个 `build-*` 按 6 个算，且最后 2 个 `inno-syntax-check-*` 为 0 B）；
3. `du` 为逻辑大小，与先前估算存在口径差。

---

## 五、执行后现状

### 5.1 项目内

| 路径 | 体积 | 说明 |
|---|---|---|
| `exe/` | 487 M | AGENTS.md 固定安装验收目录（**保留**） |
| `release/` | 558 M | 三版本安装包（1.17.7/8/9，合规）+ blockmap + `*.yml`（**保留**） |
| `release163/` | **98 M** | ⚠️ 残留（`app.asar` 被占用） |
| `release-android/` | 43 M | APK 产物（**保留**） |
| `artifacts/` | 2.0 M | 审计证据（含本次新增索引留档与对照 diff） |
| `android/` · `src/` · `main-process/` · `mobile/` | 34 M / 798 K / 157 K / 164 K | 源码 |
| `out/` `app-out/` `dist-android/` `__missing_android_project__/` | — | ✅ 已删除 |

**项目内回收：822 MB → 98 MB**（降 88.1%）

### 5.2 项目外

| 路径 | 体积 | 说明 |
|---|---|---|
| `thunder-accounting-archive/` | **62 M** | 5.93 G → 62 M（降 99.0%）；保留 14 个证据目录 + 4 个索引 |
| `ta-*`（5 个） | — | ✅ 全部删除 |
| `thunder-accounting-cleanup-quarantine-v1.16.1/` | — | ✅ 已删除 |
| 其余 10 个兄弟目录 | — | ⏭️ **OUT OF SCOPE，未触碰**（`ShioDictionary` · `LoginAndRegistrationSystem` · `aurora-shio-apple-design-system` · `hsr_loop` · `weminder` … 见清理器报告） |

**项目外回收：7.45 GB → 62 MB**（降 99.2%）

### 5.3 磁盘

`E:` 盘 932 G / 已用 643 G / 可用 289 G（69%）。

---

## 六、踩坑与结构陷阱（**必须记住**）

### 6.1 ⚠️ 符号链接陷阱 —— 差点摧毁主项目依赖

**事实**：5 个 `ta-*` worktree 内各有一个 `node_modules` **符号链接**，指向主项目 `node_modules`：
```
E:/Code/CodeProduct/ta-a7-ctl/node_modules -> /e/Code/CodeProduct/thunder-accounting/node_modules
```

`git worktree remove` 摘除后，**这些链接仍然留在原地**（`git` 不动 untracked 的链接）。此时若按常规写法执行 `rm -rf ta-a7-ctl`，**GNU rm 不会跟随符号链接**（安全），但任何形如 `rm -rf ta-a7-ctl/node_modules/*`、`find … -delete`、或 PowerShell `Remove-Item -Recurse -Force`（**会跟随 junction/symlink**）的写法都会**清空主项目的 852 MB 依赖**。

**本次处置**：
```
unlink <dir>/node_modules      # 只解除链接本身，不递归
rmdir  <dir>                   # 目录已空，安全删除
```
**核对结果**：主项目 `node_modules` **613 项 / 852 M 完好** ✅

**判据**（写进 rules §八）：删除任何 worktree 残留前，先 `find <dir> -type l` 列出符号链接并单独 `unlink`；**禁止对该类目录使用跟随链接的删除命令**。

### 6.2 ⚠️ `app.asar` 被占用（未解决）

**事实**：`release163/win-unpacked/resources/app.asar`（102 MB）持续返回 `EBUSY: Device or resource busy`，**4 次重试**（含 5s 等待）全部失败。

**已排除**：
- `git worktree list` / 进程路径扫描：**无任何进程路径指向 `release163`**；
- 无运行中的 Electron / Node 实例指向该目录；
- 进程清单（409 个）中唯一名字相近的是 `ThunderboltService.exe`（Intel 雷电服务，无关）。

**嫌疑**：**火绒（Huorong）实时防护**。在跑的组件：`HipsDaemon` · `HipsTray` · `ARPProtection` · `PopBlock`。102 MB 的 `.asar` 归档被实时扫描持有的概率最高。

**处置建议**（**不建议关闭实时防护**）：
1. 把 `release163` 加入火绒信任区，然后 `rm -rf release163`；
2. 或重启后重试（句柄随进程退出释放）；
3. 或直接跑 `node scripts/cleanup-worktree.cjs --apply`（清理器已把 `release163` 列为 SAFE 级，会再试一次）。

### 6.3 ✅ 安全门闩（本次新增，防止误删）

**原状**：`--include-risky` 会把 `*-archive` 当成普通 CONFIRM 条目 → 走 `fs.rmSync(recursive)` → **整块 5.93 GB 被删**，连带毁掉 `visual-v1.16.4`（60 MB 历史视觉基线，**难以复现**）。

**现在**：archive 条目带 `archiveRoot: true` 门闩，`targets` 过滤时排除；归档一律走 `--archive-prune`（白名单，默认保留）。

**验证**：B 档执行后归档区**未被触及**（仍以 5.93 GB 出现在"需确认后回收"清单），C 档独立执行才处理。✅

---

## 七、验证记录（全绿，除残留项）

| # | 判据 | 结果 |
|---|---|---|
| V1 | `git worktree list` 只剩主工作树 | ✅ `E:/Code/CodeProduct/thunder-accounting f86aa3a [master]` |
| V2 | `git worktree prune --dry-run` 无输出（无悬空登记） | ✅ 空输出，退出码 0 |
| V3 | 清理器报告 SAFE 总量 ≈ 0 | ⚠️ 97.4 MB（= `release163` 残留） |
| V4 | `out/` `app-out/` `dist-android/` `__missing…/` 均不存在 | ✅ 全部已删除 |
| V5 | 隔离区已不存在；归档证据层完整 | ✅ 14 个证据目录 + 4 个索引均在 |
| V6 | 归档保留项对账（±5%） | ✅ 预期 61 MB / 实际 60.0 MB（-1.6%） |
| V7 | `git status` 仅预期改动 | ✅ 提交后工作区**干净** |
| V8 | 提交 trailer 可取 | ✅ `%(trailers:key=Agent,valueonly)` → `workbuddy` |
| V9 | 主项目 `node_modules` 完好 | ✅ 613 项 / 852 M |
| V10 | 探针临时文件已清理 | ✅ 3 个（`probe-holder.txt` / `probe-procs.txt` / `commit-msg-cleanup.txt`） |

---

## 八、不可复算项清单（**现场已消失，此后无法独立验证**）

> 本节是给「详细磁盘清理报告（第二阶段）」的输入清单。以下项的**原始现场已被本次清理销毁**，只能引用当时的观测值，**不构成独立证据**。

| # | 不可复算项 | 当时观测 | 为什么不可复算 |
|---|---|---|---|
| **U1** | 归档区 **5.93 GB 的真实磁盘占用**（逻辑 vs 物理） | `du` 逻辑 5.93 GB；含 7 份 `build-*` 为**同版本重复拷贝** | 22 项已删；**是否存在 NTFS 压缩 / 硬链接从未实测** ⇒ 真实占用可能显著小于 5.93 GB，现已无法测 |
| **U2** | 归档区 **逐目录构成明细** | 见 §2.3 表（7×384M / 4×388M / 3×388M …） | 该明细**只存在于本次对话记录，从未落盘**；`artifacts/cleanup-report-20260916.json` 中归档是**整块一项**，无子目录分解 |
| **U3** | `out/` **69 个门禁临时目录的累积时间线** | 仅按前缀计数：`layout-gate-*` 20 · `profile-gate-*` 15 · `desktop-parity-*` 9 · `dp-*` 7 | 已删；各目录 mtime 分布、产生速率、哪个门禁泄漏最多**均未记录** ⇒ 无法回答"清理周期应该多长" |
| (U4) | 2026-08-29 隔离区 **1.40 GB 的实际内容与清单是否一致** | 观测到 5 个 1.14.x 安装包 + `雷霆记账app-_exe/` 389M + `release-win-unpacked/` 384M + `app-out/` 1.8M | 已删；配套 `artifacts/cleanup-manifest-v1.16.0.json` 的 `suggested` / `requires_user_confirmation` 两清单**从未与实际内容逐项对账** |
| (U5) | `release163/win-unpacked` **完整构成** | 384 MB 中除 `app.asar`(102M→删后剩 98M) 还有 exe/dll/pak/locales | 已删；仅 `app.asar` 因被占用留存 |
| (U6) | `E:/Code/` 顶层 **20+ staging/recovery 残留的总体积** | **从未统计**（当时标"未计"） | **仍在盘上 ⇒ 属"未做"而非"不可复算"**，可补算 |

> 「本轮 3 条 unknowns」若指 U1–U3，则三者均已因清理而**永久失去独立验证可能**；若你的清单包含 U4/U5，情况同上。**U6 不同** —— 它仍可补测。

---

## 九、留档与证据位置

| 文件 | 内容 | 入库？ |
|---|---|---|
| `docs/cleanup-execution-report-20260916.md` | 本报告 | ✅ 已提交 |
| `docs/cleanup-policy-plan.md` | 方案（四层联动 + DAG + 六维判据 + 执行记录） | ✅ 已提交 |
| `docs/sacw-cleanup-defect-report.md` | SACW 缺陷报告（5 条缺陷行号证据 + §0 移交说明） | ✅ 已提交 |
| `scripts/cleanup-worktree.cjs` | 清理器（三级 + `--archive-prune` 分层 + 门闩） | ✅ 已提交 |
| `.codebuddy/rules/00-project.md` §八 | 六维判据 + 生态级根因 + 执行记录 + 符号链接陷阱 | ✅ 已提交 |
| `artifacts/g21-ctl-injection-20260916.diff` | `ta-gate-ctl-g21` 的 2 处注入改动（1465 B） | ❌ `artifacts/` 被忽略 |
| `artifacts/sae-self-20260915-index/` | 归档区 4 个根级索引留档（46 KB） | ❌ 同上 |
| `artifacts/cleanup-report-20260916.json` | 清理器报告落盘 | ❌ 同上 |

⚠️ **`artifacts/` 被 `.gitignore` 忽略 ⇒ 上述三项证据「在盘不在库」**。若需入库须 `git add -f`。

**Git**：提交 `dee5f5e`（5 文件，+1307 / −246），trailer `Agent: workbuddy`。**未 push**。

---

## 十、未完成 / 下一步

| 项 | 状态 |
|---|---|
| `release163` 残留 98 MB | ⬜ **待你处置** —— 加入火绒信任区或重启后重跑 `--apply` |
| N1 门禁脚本自清理（治泄漏源头） | ⬜ 未做（已列入方案） |
| N2 `predist:win` / `postdist:win` 挂载 | ⬜ 未做（改 `package.json` 会触发一轮发版，待裁定） |
| SACW 升级（5 条缺陷） | ⛔ **本轮无权限** → 交另一对话，入口见 `docs/sacw-cleanup-defect-report.md` §0 |
| **详细磁盘清理报告（第二阶段）** | ➡️ **并行任务，不阻塞** —— 见 §八 输入清单 |
| `E:/Code/` 顶层 20+ 残留 | ⬜ 仅报告未动（U6 体积可补算） |
