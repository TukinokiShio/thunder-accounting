# 雷霆记账 — 项目长期记忆（精简版） · 项目档案

> 由 `project-memory-governance` 从 `../memory/MEMORY.md` 下沉（2026-09-13）。
> 原因：原文件 9968 字符，超出 3000 字符硬上限——超限会触发**有损压缩**。
> 本目录（`.codebuddy/rules/`）**无字符上限**，宿主自动递归加载，仅认当前工作目录（cwd）。
> **常驻规则见 `../memory/MEMORY.md`**；两侧不重复，各为单一事实源。

---


### 以下由 `project-memory-governance` 于 2026-09-13 二次下沉（保真搬运，未改内容）

## 一、项目基线

| 项 | 值 |
|---|---|
| 产品名 | 雷霆记账 (Thunder Books) |
| 仓库根 | `E:\Code\CodeProduct\thunder-accounting` |
| 定位 | 轻量级个人日常记账工具（3 秒记一笔） |
| 平台 | Windows 10+ / macOS 12+；最小窗口 900×600 |
| 货币 | 人民币 ¥（图标/文案均为 ¥） |
| Git | https://github.com/TukinokiShio/thunder-accounting （MIT，作者 TukinokiShio） |

### 技术栈

Electron ^33.4.11 · React ^18.3.1 · TypeScript ^5.7.2 · electron-vite ^2.3.0 · Vite ^5.4 ·
TailwindCSS ^3.4.17 · Zustand ^5.0.3 · sql.js ^1.12.0（WASM，无原生编译）· Recharts ^2.15.0 ·
date-fns ^4.1.0 · lucide-react ^0.468 · react-select ^5.10（CategorySelect）·
@cloudbase/node-sdk / manager-node / cloudbase-mcp（主进程 external）· Vitest ^4.1

### 关键目录

```
main-process/     main.ts · preload.ts · database/{index.ts,...} · cloudbase.ts
src/
  pages/          Home.tsx · Bills.tsx · Stats.tsx · Login.tsx · Profile.tsx
  components/     Layout/Sidebar/AddBillDialog/CategoryManager/CategorySelect/
                  SettingsDialog/ConfirmDialog/Toast/EmojiPicker/AddBillDatePicker
  store/index.ts  Zustand（bills / stats / filters / toasts / auth）
  i18n/           LanguageContext.tsx + translations.ts（中文 key → 英文，~268 行）
  index.css       全局样式 + aurora token + 弹窗/卡片样式
scripts/          thunder-setup.iss · deploy.cjs · inno 相关 · 图标管线
.workbuddy/skills/  expense-entry · inno-packager · strict-coding-workflow
app-out/          electron-vite 构建产物（main/preload/renderer）
release/          安装包输出（electron-builder + Inno）
exe/              AGENTS.md 规定的固定安装验收目录
```

---

## 三、数据模型（只读参考，勿改）

**bills**：id(PK) · amount(REAL>) · category1 · category2 · date(YYYY-MM-DD) · note · type('expense'|'income') · created_at · updated_at
**categories**：id · name · icon(emoji) · children(JSON 数组字符串) · type · is_preset · sort_order · created_at · updated_at

索引：`idx_bills_date`、`idx_bills_category1`。WAL 模式，启动时自动补列（type / updated_at）。

预设分类：支出 11 大类（餐饮食品/交通出行/购物消费/住房物业/旅游出行/医疗健康/教育学习/娱乐休闲/人情往来/金融保险/其他杂项），收入 6 大类。

**数据隔离**：per-user 本地库 `thunder-accounting-<uid>.db`；admin（`identifier==='admin'` → `15211073887@163.com`）实际使用共享库 `thunder-accounting.db`。

---


## 四、IPC API（preload contextBridge → `window.electronAPI`）

账单：`addBill` / `getBills({startDate?,endDate?,category1?})` / `updateBill` / `deleteBill`
统计：`getStats(startDate, endDate, type?)` → `{totalAmount, count, byCategory1, byCategory2, byDate}`
导出：`exportCSV(filters?)`；文件：`showSaveDialog` / `showOpenDialog` / `writeFile`
分类：`getCategories(type?)` / `addCategory` / `updateCategory` / `deleteCategory` / `reorderCategories`
备份：`exportBackup` / `importBackup` / `clearAllData`；快捷键：`onShortcut`
认证：`sendCode` / `register` / `login` / `loginWithCode` / `logout` / `checkSession` /
      `saveCredentials` / `loadCredentials` / `sendReauthCode` / `changePassword` / `resetPassword`
账号：`getAccountBindings` / `sendBindCode` / `bindPhone` / `unbindPhone` / `bindEmail` / `unbindEmail` /
      `deleteAccount` / `getUserStats`；同步：`getSyncStatus`；云可用性：`isCloudSyncEnabled`

---


## 五、踩坑精粹（P0 级，勿重犯）

1. **sql.js `db.export()` 会重置连接级状态** —— `saveDb()` 内部 export 后 `last_insert_rowid()` 恒为 0。
   → 任何 INSERT 后取 rowid 必须在 `saveDb()` **之前**。此类 bug 组件测试（mock electronAPI）测不出，需 node + 真实 sql.js 集成测试。
2. **`convertNamedParams` 只认 `@name`** —— SQL 写 `?` 却传命名参数对象 = 空绑定，静默返回空行。查询统一用 `WHERE id = @id`。
3. **UI 焦点边界**：全局规则 `.aurora-shell :where(label,div):has(> .input-field):focus-within` 会误伤含 label/按钮的父容器 →
   自定义表单需加专属 class（如 `category-editor`）并让 input 自身承担 outline。
4. **组件测试断言质量**：禁止子串断言（如只断 URL 前缀）；须断言完整行为（完整 URL、响应体、边界场景）。
5. **in-process 子代理通道在本环境不可靠** —— 曾出现 spawn 后零产出、ping 无响应；前台一次性子代理（Reviewer）可正常工作。
6. **package.json 曾被截断**（scripts/devDependencies/build 丢失且未提交，直接导致无法构建）—— 每轮开工与版本改动前后都要 `git diff package.json`，只允许出现 version 行差异。禁止把"精简 package.json"的操作写到仓库根（应写到 `app-out/` 等产物目录）。
7. **app.asar 可能被系统进程独占**（Inno DeleteFile code 32）→ 绕过方式为 Node fs `'w'` 覆盖 + 递归 copyFileSync + 手动同步注册表 DisplayVersion。
8. **本机工具链坑（2026-09-12 实测）**：
   - PowerShell 工具在本会话**持续无 stdout 输出**（含 `Start-Process -PassThru -Wait`）→ 改用 bash 直接调 exe 读 `$?`；`cmd.exe` 被安全策略禁止调用；查注册表用 `MSYS_NO_PATHCONV=1 reg query`。
   - `sha256sum` 对含 `\` 的路径会加转义前缀，且带空格的文件名会被 word-split → 校验脚本必须 `cd` 到源目录用相对路径 + `find -print0` + `while IFS= read -r -d ''`，否则产生大量假阳性。
   - bundle 版本污染检查用 `grep -o "1\.1[0-9]\.[0-9]"` 会**误匹配 SVG path 坐标串**（如 `...1.15.2.35...`）→ 改用 `grep -o '"version":"1\.[0-9.]*"'` 或带上下文确认。
   - 受管 Node 可用绝对路径 `C:\Users\d8502\.workbuddy\binaries\node\versions\22.12.0\node.exe`；`@electron/asar` 已装，读 asar 内 package.json 用 `asar.extractFile`。
9. **首页数据源**：`Home.tsx` 曾用 `store.bills`，而 `store.refreshBills` 会带上「账单」页的 `filterMonth`/`filterDateRange`/`filterCategory1`（筛选离开页面不重置）→ 首页数字被污染。**首页/仪表盘类页面必须自查数据，不要复用被筛选过的 store 列表。**
10. **recharts 默认绘制动画 1500ms**（`<Pie>` / `<Bar>` 不显式设 `animationDuration` 就是 1500ms）—— 环形图/柱状图会有明显"慢半拍"感。项目约定：新图表一律显式设 `animationDuration={300}`（`StatCardDetailDialog.tsx` 的 `CHART_ANIM_DURATION` 可参考）。**注意 `Stats.tsx` 仍是默认 1500ms，尚未统一。**
11. **性能问题先量后改**：用户说"慢"时，先逐项核验候选原因（数据加载 / CSS 动画 / 图表动画），不要凭感觉改数据流。本项目实测「4 次只读 IPC」是毫秒级、不是瓶颈，真凶是图表动画默认值。
12. **UI 缺陷先量化再改**：用户说"没铺满 / 露白 / 偏了"时，用 Pillow 从截图逐像素量出**边界坐标与压暗倍率**，把模糊描述变成可判定的数字再动手。本环境可用 headless Chromium（`~/AppData/Local/ms-playwright/chromium_headless_shell-1234/.../chrome-headless-shell.exe`，见 `.workbuddy/memory/2026-09-12.md`）。
13. **模态层一律 Portal 到 `document.body` 并内联写死视口几何**：`position: fixed` 的包含块可被祖先改写，导致遮罩铺不满（本项目历史已在 `CategorySelect.tsx` 头部注释记录过同类问题）。标准做法 = `createPortal(..., document.body)` + 内联 `top/right/bottom/left: 0`；z-index 取 9000（介于应用内容 50~60 与 react-select 菜单 Portal 的 10000 之间）。
    - **2026-09-12 已验证**：v1.17.2 出现遮罩顶部约 24px 露白（金色按钮被横切、下半精确 40% 压暗），v1.17.3 改为 Portal 后以同一像素法复验 —— 饱和金像素 287→1，视口内无转折。**但具体是哪个祖先改写了包含块仍未定位**（所有标准属性均已排除），「Portal 有效」本身即因果证据。
    - **v1.17.4 已全量落地**：5 个模态（`StatCardDetailDialog` / `AddBillDialog` / `SettingsDialog` / `CategoryManager` / `ConfirmDialog`）全部 Portal 化。z-index 分层：应用内容 50~60 < 模态 9000 < `ConfirmDialog` 9500 < react-select 菜单 Portal 10000。
    - **⚠️ 只做 Portal 会引入两类回归（v1.17.5 实锤）**：Portal 只改**节点位置**，不搬运**依赖祖先的上下文**。本项目弹窗版式全挂 `.aurora-shell .xxx-dialog` 后代作用域（`width: min(28rem, calc(100vw-2rem))` 等），深色 token 全挂 `.dark`/`[data-theme]`（`darkMode:'class'` 也要求祖先）→ 弹窗一出 shell 就 ① **随内容塌缩**（未选分类 383px → 选中 310px）② **深色主题下仍渲染浅色**。
      **正确做法 = Portal + 作用域替身**：模态根带 `class="aurora-shell aurora-portal-root [dark]"` + `data-theme`（单一来源 `src/utils/modalScope.ts`），并补 CSS `.aurora-shell.aurora-portal-root { width:auto; min-height:0; background:transparent }`（0,2,0 高于基础 `.aurora-shell`）。**该覆盖规则不可省**：删掉它替身根会取 `--bg` + `min-height:100%`，整屏盖住应用（独立审查证伪确认）。
      **反模式**：不要把 `dark` 提到 `<html>`（会让历史失效规则突然生效，blast radius 不可控）。
    - **回归防护（两层，缺一不可）**：`modal-portal-contract.test.ts` 源级契约（模态清单**从文件系统派生**，新增模态自动纳入；断言 createPortal + `document.body` + 内联几何逐字符一致 + 不得残留 `className="fixed inset-0` + z-index ∈ [9000,10000) + 替身）；`npm run verify:modal-scope` 行为级门禁（真实构建 CSS + 无头浏览器，断言替身下宽度极差=0、深色面板 `#202224`、遮罩铺满、替身根透明底，**并含负对照自检：无替身必须复现 58px 极差，否则报错**）。打包链路已把它作为打包前门禁（1.3s）。
    - **易漏耦合**：`CategorySelect.tsx` / `AddBillDatePicker.tsx` 的 portal 目标选择器必须写 `.aurora-shell:not(.aurora-portal-root)`，否则模态打开时可能命中替身根。
15. **知识库运维**：全局知识库 = `E:/Code/shio-al-ecosystem/wiki`（权威 schema 见其 `SCHEMA.md`），维护走 `shio-wiki-keeper` skill（快照 → 写入 → index 计数 → log 补登 → RAG 重建 → 同步 GitHub）。**不要手改**；推送前须用户确认（skill 红线）。踩坑：仓库 `.gitignore` 只有 `*.sqlite`，RAG 重建并发产生的 `*.sqlite-journal/-wal/-shm` 会绕过忽略被误提交 —— 已在仓库补规则，镜像脚本也须用前缀匹配排除 `.wiki-rag.sqlite*`。

16. **验证修复必须验证「上下文是否随迁」**：结构性修复（Portal / 换挂载点 / 换父容器 / 抽组件）常修好用户报的那一个症状，却静默丢掉节点原本依赖的祖先上下文（CSS 作用域类 / 主题类 / 继承属性 / Provider）。先列被移动节点依赖的上下文清单，迁移后逐项核对 —— **只验用户报的那一个维度不足以判定修复完成**（v1.17.3 只验「遮罩是否铺满」就发布 → v1.17.5 返工）。
17. **本地页面验证工具三坑**：① `execFileSync`/`spawnSync` 会冻结 Node 事件循环 → 同进程 `http` 服务无法响应 → 与浏览器**互锁死锁**（无报错、无超时）→ 本地单页验证改用 `file://` + 内联资源（0.6~1.3s）；② 外部调用必须带 `{ timeout, killSignal:'SIGKILL' }`，并在调用**之前**打印上下文；③ 回读注入结果的正则要容忍属性（`<pre id="out" style=…>` 不匹配 `<pre id="out">`）。
18. **交付脚本不要 `&&` 串联并以末尾 `$?` 收尾**：上一步失败会让后续步骤**静默不执行**，而末尾退出码是失败那步的 → 看起来像"最后一步失败"。改为每步独立执行、**各自打印退出码**、失败即 abort。（v1.17.5 打包时 `rm` 因目录被本地 HTTP 服务占用而失败 → 整个打包根本没跑，却显示 `INSTALL_EXIT=1`）
14. **本机工具链坑（累计）**：Electron 在本沙箱无法启动且已设 `ELECTRON_RUN_AS_NODE=1`；PowerShell 工具无 stdout、`cmd.exe` 被禁；`file://` 下 ES module 被 CORS 拦（需 `python -m http.server`）；构建产物 `<link>` 的 `crossorigin` 会让 `file://` 样式加载失败。
19. **前台 shell 的 stdout 会间歇性整体失效（2026-09-14，同一会话内多个 worker 独立复现）**：
   `Bash` / `PowerShell` 的**前台**调用可能返回空 stdout（`exit 0` 但连 `echo hello` 都为空）；
   **`run_in_background: true` + 读取后台输出完全正常**。
   - 判定法：**同一命令前台空、后台有输出 ⇒ 环境问题**，不要怀疑命令本身、不要反复重跑。
   - 绕过：改用后台执行后取输出，或「命令重定向落盘 + Read 读文件」。
   - ⚠️ 这是**按进程**而非全局的：主控进程可能完全正常，**不要用"我这边正常"去否定他人报告**。
   - 诊断过程中产生的探针文件（如 `.shellprobe.txt` / `probe-marker.txt`）**必须清理**，不要留在工作区。
20. **几何量（高度/宽度/列数）不要用模型判定，只能用来排序候选方案（2026-09-14 实证）**：
   统计页整页高度出现过 1610 / 1150 两个模型估算，**实测 1327** —— 双方都没量对（偏差 22% / 15%）；
   账单首屏条数我引用的 6 条来自 spike 的**理想行高 69px**，**实测行高 83~99px，真实只有 4 条**。
   → 阈值与验收必须来自实测（行为级门禁 `verify:android-layout`），模型不得用来设阈值。
   → 固定 px 项（图表高度、整卡显隐）与随行高缩放的项**量纲不同**，不可用同一个缩放因子外推。
22. **Tailwind CLI 的 `--content` 重复传参不会合并（只取最后一个）（2026-09-14 实测）**：
   ```
   npx tailwindcss -i src/index.css -o ../probe.css --content "./src/**/*.{ts,tsx}"   # 必须一次给全 glob
   ```
   反例：`--content "src/pages/Home.tsx" --content "src/pages/Stats.tsx"` → **只扫到 Stats.tsx**，
   产物里没有 `text-lg` 等 Home 专用类 → 若据此读基线会得出**错误结论**。
   ⚠️ 这类"**扫不到 → 无结论**"是本项目反复踩的失效模式：产物里查不到某类，
   **不等于该类没生效**，可能只是没被扫到。读任何构建产物前先确认**扫描范围覆盖了目标文件**。
23. **窄屏类必须用 `max-sm:` 限定，不要用 `sm:X` 去"复位"（2026-09-14 实测 4 处）**：
   - `sm:` 只能用于把**已有类**在 ≥640px 复位；`max-sm:` 用于限定**新增**的窄屏类。
   - 反例：给原本没有 leading 类的元素加 `leading-tight sm:leading-normal` ——
     `sm:leading-normal` **不是复位、是改值**（Tailwind 里 `lineHeight` 插件排在 `fontSize` 之后，
     同特指度后出现者胜）→ 桌面行高被 `text-lg` 的 28px 改成 27px、`text-xs` 的 16px 改成 18px。
   - 改用 `max-sm:leading-tight` 后 ≥640px **根本不存在** leading 类 → 结构性成立，不依赖层叠顺序。
   - 同类错误还有无条件生效的 `truncate` / `shrink-0` / `min-w-0`。
     **注意 `min-w-0` 必须加在 flex 子项上** —— 加在 flex 容器上是 **no-op**（子项默认 `min-width:auto`），
     `truncate` 因此不会生效（本项目曾据此以为"已防裁切"，实际从未生效）。
   - 覆盖手段：见 §20 行为级门禁的桌面视口侧（A9a 扫所有含 `max-sm:` 的元素 + A9b 清单精确比对）。
24. **WorkBuddy 卡退会造成 agent 状态异常；不要把「能解释现象的推断」当成结论（2026-09-14 实犯）**：
   当次系统卡退（非本项目原因）期间观察到两个异常：
   ① 一个 worker 回答了我**从未问过**的问题，还引用了不存在的"关键时间点"与"公开报告"；
   ② 另一个 worker 报的 `ReferenceError: settleXxx is not defined` 在其文件里**零命中**
      （该文件 mtime 晚于其声称的最后编辑 → 当时读到的是**半写状态**）。
   **我的错**：把「另一会话在并发写同一仓库」这个**能解释现象的推断**当作结论，
   并据此限时收口、要求他人交出写入清单。用户确认**该项目没有别的 agent 在写** → 推断被证伪。
   - 教训：**能解释现象只是推断的必要条件，不是充分条件**；异常现象 ≠ 某个特定解释。
   - 正确顺序：**先收集可证伪的判别性证据再定性**。本次有效的判据是
     「门禁文件 mtime 停在 15:07:20、7 分钟后仍未变 + `git status` 干净 ⇒ 无并发写入」。
   - 涉及「有第三方在动你的文件」这类**指向他人的判断**，先向环境所有者（用户）确认再定性。
   - 取消行为：半写状态下的崩溃不影响最终文件完整性 —— 文件会被后续完整写入覆盖，**不要据此回滚或"修复"**。
25. **改类名会让别处「靠字面量匹配」的选择器失配 —— 独立于 Tailwind 断点的一类失效模式（2026-09-14 实证）**：
   反例：`src/index.css:510`
   ```css
   .aurora-shell .home-stats-grid .w-8.h-8 {
     background: var(--accent-dim) !important; color: var(--accent) !important;
   }
   ```
   它靠 `.w-8` + `.h-8` **两个类名字面量同时命中**，用 `!important` 把 6 张卡图标统一成强调色。
   把图标盒类改成 `w-7 h-7 sm:w-8 sm:h-8` 后，**渲染尺寸没变**（1280px 下仍 32×32），
   但类名 token 变了 → **选择器不再命中 → `!important` 失效 → 原本是死代码的 per-card `color` 首次生效**
   → **两个视口**外观都变了（该规则不在任何 `@media` 内）。
   - **改类名之前的判据**：先 grep `index.css`（及其他样式表）里有没有**以该类名字面量作选择器**的规则，尤其带 `!important` 的。
   - **为什么源码级断言抓不到**：断言比对的是 TSX 里的类名字符串，而隐患在 `index.css` 的选择器里 —— **结构上不可见**。
   - **只有行为级比对（`verify:desktop-parity`）能覆盖**。这是 A9（桌面视口侧）存在的意义：
     它第一次上线就抓到了这条，是源码级断言原理上覆盖不到的一类缺陷。
   - 连带事实：`index.css:510` 与 `Home.tsx` 的 6 组 `card.color` 是**两套互相矛盾的意图**，
     `card.color` 长期是死代码。要不要改用 per-card 配色是**独立的设计决策**，
     不得作为布局改动的副作用混入本轮。
26. **任何写进结论的检查，必须给出「它能够失败」的对照（2026-09-14，一天内 3 个实例）**：
   - **`tsc --noEmit -p tsconfig.json` 是空转**：根配置是 solution 式
     （`{"files": [], "references": [node, web]}`），而 `references` **只在 `tsc -b` 下才被跟随**。
     用 `-p` 调用它 ⇒ 列出 **0 个文件**、并且**永远 exit 0**。
     实测：`tsc -p tsconfig.json --listFiles` → **0**；`tsc -p tsconfig.mobile.json --listFiles` → **693**（阳性对照）。
     ⇒ **本项目历史上所有「tsc clean」说法里，根配置那半句都是假证据**（含提交信息里的「两个 tsconfig 均 0 错误」）。
     ⚠️ **不要改用 `tsc -b` 兜底**：`tsconfig.node.json` / `tsconfig.web.json` 是 `composite: true` 且 `outDir: ./out`，
     `-b` 会往仓库里产 `.js/.d.ts`。正解是补 `tsconfig.scripts.json`（`noEmit: true`）。
   - 连带事实：**`scripts/**` 此前没有任何 tsconfig 覆盖** ⇒ 门禁自己的"尺子"是全项目唯一无类型校验的部分。
   - 同型另两例：把「实测 2702 ÷ 模型 1776 = 1.52」当**统一缩放因子**外推改后高度（量纲不同，见 §20）；
     以及一次「命中组 8→6」的推算（**实测 8→8** —— 两棵树本就无版本号差异，掩码没有可归一化的对象）。
   - **判据**：一条**不可能失败**的检查不是检查，是装饰。写进结论前先问：**它能失败吗？给它一个反例试试。**
     这条对**自己**的证据与对别人的证据**同等适用** —— 本轮恰恰是 worker 用这条抓出了 lead 的假证据。
21. **并发 git 提交事故的完整记录（2026-09-14，供后人判断同类风险）**：
   多 agent 共用一个工作树时，`git add <path>` **只增不减** —— 它不会把别人已暂存的条目移出暂存区。
   实际后果：词典 worker 只 `git add src/i18n/translations.ts`、**也如实执行了 `git diff --cached --name-only` 自证（结果正确、只有它那 1 个文件）**，
   但在它检查之后、提交之前，另一 worker 把 10 个文件 `git add` 进了共享暂存区 →
   它那条**不带 pathspec** 的 `git commit` 把 11 个文件全提交了，而提交信息只写着"词典条目"（实际含 421 处插入）。
   - **代价**：提交边界丢失，无法单独回滚 Profile/分类管理的改动；各 worker 的 commit message 消失。
   - **修复**：`git reset --soft HEAD~1` 后按归属拆成两个提交，用 **tree 哈希不变**证明内容零变化：
     `git rev-parse <旧commit>^{tree}` 必须等于 `git rev-parse HEAD^{tree}`（并加 `--numstat | wc -l` = 0 兜住"命令静默"）。
   - **正确写法**：`git commit -F <信息文件> -- <显式路径...>`（pathspec 限定，绕过暂存区）。
   - **预防要点**：光"只 add 自己的文件"**不够**；必须用 pathspec 限定提交，或提交前 `git diff --cached --name-only` 逐个核对并把不属于自己的 `git restore --staged` 剔除。

---

## 安装坑完整排错（从 `memory/MEMORY.md` 下沉，2026-09-14）

**现象**：Inno 静默升级后，程序装到了**历史目录**而不是 `.iss` 里写的 `DefaultDirName`，且
`INSTALL_EXIT=0`（伪装成成功）。

**根因（2026-09-12 实锤）**：Inno 的 `UsePreviousAppDir` **默认是 yes** —— 它会读注册表
`HKCU\...\Uninstall\{AppId}_is1` 的 `InstallLocation` 并沿用，**完全忽略 `DefaultDirName`**。

**已有对策**：`scripts/thunder-setup.iss` 已显式加 `UsePreviousAppDir=no` —— **不要删这一行**。
临时强制落点用命令行 `/DIR="<绝对路径>"`。

**验证必须看实际落点，不能只看退出码**：
1. `exe\resources\app.asar` 内 `package.json` 的版本 == 源码版本
2. 注册表 `DisplayVersion` / `InstallLocation`
3. 快捷方式时间戳

**排错命令**：
```
find <roots> -name app.asar -newermt "<今天> 00:00"     # 定位实际被写入的位置
reg query 'HKCU\...\Explorer\User Shell Folders' /v Desktop   # 桌面真实路径
```
**注意**：桌面真实路径在 **D 盘**（`D:\Users\d8502\Desktop`），不是 `C:\Users\...\Desktop`。

**在 bash 里查注册表**需 `MSYS_NO_PATHCONV=1 reg query ...`，否则路径会被转换。

---


## 六、云端（腾讯云 CloudBase）

环境 `shio-d0gsoo414401468d6`（上海，体验版）· 集合 `bills` / `categories`（按 `userId` 隔离）·
认证走 CloudBase Auth v2 HTTP API（网关 base `https://shio-d0gsoo414401468d6.api.tcloudbasegateway.com`）。
同步策略：本地 SQLite 为主存储，CRUD 后 `trySync()` 异步 upsert，未登录/失败静默跳过。

---


## 七、项目级 Skills

| Skill | 用途 |
|---|---|
| `inno-packager` | 打包全链路：Clean Build → electron-builder → ISCC → 静默安装 → 验证 |
| `expense-entry` | 结构化支出 JSON 批量写入本地库（默认 = admin 共享库） |
| `strict-coding-workflow` | 项目级编码工作流（继承用户级 + 阶段后自动打包） |
