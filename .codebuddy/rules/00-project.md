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
   - **推论：不要用 Tailwind 类名做注入/对照（2026-09-14 实证）**。
     探针构建只扫自己的 `content` 范围，`scripts/**` 里的类名**不保证被生成** ⇒
     注入 `overflow-auto` 这类类名会**悄悄不生效**，让结论取决于**构建**而不是**判据**。
     ⇒ 注入与对照一律用**内联 `style`** 或**自建 `<style>` 规则**。
   - 同源的反向用法：**旧判据可保留为"报告对照项"而不参与 pass/fail**。
     例（横向裁剪判据）：每次运行同时打印「class 名判据=n，计算样式判据=m」，
     两条判据的分歧**常驻可见**，但只有新的参与判定 —— 既防"悄悄换掉判据"，又不制造假红。
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
27. **可达性断言的两条硬判据 + 一个状态依赖陷阱（2026-09-14 真机事故实证）**：
   事故：安卓「我的」页语言切换入口在**真机上点不到**，用户反馈「还是没做到中英文切换」。
   - **① 程序化点击会 `scrollIntoViewIfNeeded` ⇒「可点」不等于「可见」。**
     门禁 A7 断言「可点开设置入口」→ PASS，但真机上入口在屏幕外。
     → **任何"可达/可点/可见"的断言，必须同时断言它在视口内**：
     `r.left >= 0 && r.right <= innerWidth`、`r.top >= bandTop && r.bottom <= bandBottom`、尺寸非零；
     且所在横向容器 `scrollWidth <= clientWidth + 1`。
   - **② 缺陷可能与语言/状态相关，必须在"用户实际会达到的那个状态"下量。**
     实测：中文态 4 个 chip 恰好铺满 **342/342（0px 余量）**；**英文标签更长** →
     `scrollW414 > clientW342` → 第 4 项落在 `l368.3..r445.7`（`innerWidth=412`）→ 出屏。
     ⇒ **英文态正是"用过一次切换器之后"的唯一状态**：入口不可达 ⇒ **切不回中文，单向陷阱**。
     只量中文的话，那条新断言对真实事故**依然是空过的**。
   - **③ 0 余量 ≠ 通过**。靠"恰好多 0px"通过是**脆性**，任一标签变长即崩。
     → 可达性关键的横向容器要求余量 **≥ 8px，且两种语言下都成立**。
   - 门禁实现要点：`band`（内容带）必须**显式传入**（页面级 vs 固定覆盖层用不同 band，套错是范畴错误）；
     **元素自身可见性 与 容器溢出 分开返回**（结论可合并、**证据不许合并**）；
     负向断言（"某项不存在"）要用**"与视口有交集"**去查，否则会把"存在但被挤出屏幕"误判为不存在。
28. **门禁在「被测应用正在被编辑」时会读不出结论 —— 需要独占窗口（2026-09-14）**：
   现象：主工作树跑门禁两次失败，报 `量测结果 JSON 解析失败：Unexpected end of JSON input`，
   而 `<pre id="out">` **存在但为空** ⇒ 驱动没在虚拟时间预算内结算。
   排除法（都已实测）：调大 `--virtual-time-budget` 30000→120000 后 payload 3053 字节、DOM 逐长相同
   ⇒ **不是预算不足、也不是探针抛错**，而是**被测应用正被另一个进程改动**（撞上保存瞬间）。
   - **`instrumentFingerprint` 只能事后拒绝，不能事前阻止** —— 指纹负责"不撒谎"，独占窗口负责"不被打扰"，两者都要。
   - 需要结论的量测应在**冻结 worktree**（`git worktree add --detach <sha>`）上做；
     主工作树在有人编辑时**只用于观察、不出结论**。
     - 确定性 A/B 的标准形式：冻结树 + 三连跑 + **只动一处变量** + 附「其余断言在正/负两次跑里结论一致」，
       以证明翻转确由该变量引起、而非工作树的偶然状态。
29. **⚠️ `src/` 当前没有被类型校验（web 切片缺口）—— 状态：正在修（任务 #32）**：
   `npm run typecheck` 实为 `tsc --noEmit -p tsconfig.mobile.json && -p tsconfig.node.json && -p tsconfig.scripts.json`
   —— **只覆盖 `mobile/` + `main-process/` + `scripts/`，不含 `tsconfig.web.json`（即 `src/**`，整个应用主体）**。
   - **在此之前不要假定 `src/` 的类型被检查过。**「typecheck 通过」这句话在过去相当长时间里**不包含 `src/`**。
   - 实测（2026-09-14 21:08，主工作树，可复现；**该值依赖工作树里一处未提交改动，见下**）：
     `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json` → 默认堆 **exit=2、6 处错误**；
     加 `--max-old-space-size=4096` → exit=1、同样 6 处。
   - ⚠️ **「6 处」的前提**：工作树的 `tsconfig.web.json` 已被加上 `"main-process/sql.js.d.ts"`（未提交，mtime 16:13）。
     **没有这一行时是 11 处** —— 少了它 `sql.js` 在 web 项目里没有类型声明，多出 `TS7016×2` + `TS7006×3`。
     这 5 条与 TS6307 是**同一根因的投影**（文件不在项目里 → 模块解析不到 → 缺声明 / implicit any）。
     ⇒ 引用本条数字时**必须同时说明这一行是否在位**，否则两个数会互相矛盾。
     6 处性质：**4× TS6307**（`composite: true` 要求项目列出全部文件；`src/database-*.test.ts` 与
     `main-process/database/*` 互相引用但不在 web 的 include 里 —— **配置问题**）+
     1× TS2741（`AuthGuard.test.tsx:48` 桩缺 `emailVerified`）+ 1× TS2353（`CategoryManager.test.tsx:87` 桩多 `addCategory`）。
   - **修完后请把本条改为「已覆盖」。** 未记录的缺口比记录了的缺口危险得多 —— 它会让后来人以为已有校验。
30. **报错条数 ≠ 缺陷数（2026-09-14 实证）**：一处根因可以产出多条错误。
   例：`const parent = cur.parentElement` 自引用推断失败，产出 **3 条**（`TS7022` ×2 + `TS18046 'sib' is of type 'unknown'`），
   而后者是 `parent: any` 的**下游后果**（`Array.from(parent.children)` 在 parent 被推成 any 时把元素类型推成 unknown）
   —— 实际只需 **2 处编辑**。
   ⇒ **先找根因，不要按报错条数逐个压平**：那既做无用功，又会把根因盖住。
   ⇒ 反向的红旗：某个错误码的修复**没有改变**其它错误的数量，通常说明你修的是症状。
31. **可失败对照的正确形态：注入「原文」，不要「手抄」（2026-09-14）**：
   构造负对照时，从 **git 历史取原始代码**注回（`git show <sha>:<path>`），而不是凭记忆重写一段"类似的坏代码"。
   - 理由：**手抄会引入"我抄错了所以没报"这个替代解释**，看起来红/绿都说得通；
     取原文则**报出来的错误码与位置必须与当年逐字相同**，替代解释被消除。
   - 实证：手抄版只复现了 `TS7022`（因为抄的片段没碰到 `sib.tagName`）；取 `git show f21b359:…pathOf()` 原文后，
     `TS7022` 与 `TS18046` 两个码都逐字报出、位置也对上。
32. **环境内存压力会造成两类「假信号」—— 先怀疑资源，再怀疑代码（2026-09-14 实证）**：
   同一棵树、同一条命令，当机器内存被压到极低时会出现：
   - `tsc` 以 **exit 134** abort —— Node 按**可用**内存自动收缩默认堆 → `Scavenge … allocation failure`
   - `npm run test` 默认并发下 **vitest worker spawn 失败**（`errno -4094 / code UNKNOWN`），
     表现为「29 passed / 18 Errors」这种**被腰斩**的结果；而降到 `--maxWorkers=2` 同一棵树
     **48 files / 507 tests 全绿**
   - **判据**：资源恢复后**重跑同一条命令即正常** ⇒ 是环境瞬时状态，**不是 tsc / 配置 / 代码的属性**。
   - **不要把假信号写进结论或规则**：本次「11 处错误 + OOM」的报告正是这两种假信号叠加的结果，
     真实错误数是 **6**（且其中 5 条还是同一根因的投影）。
   - 实践：跑重型检查前先确认没有别的进程在抢内存（本项目常见三者并发：Chromium 门禁 + tsc + vitest）。
33. **`clientWidth − scrollWidth` 恒为 0 —— 不能拿它当「余量」判据（2026-09-14 实证）**：
   `scrollWidth` 被 clamp 到**不小于** `clientWidth`，所以两者之差**恒为 0**（为负时也被 clamp 成 0）。
   拿它做判据只会写出**永远通过**或**永远失败**的假断言。
   - **正确量法**：同一行**最右可点击项的 `right`** 到**容器可见右边界**的距离。
   - 连带更正：曾据此把中文态报成「**0px 余量**」，实测是 **26px** —— 中文态不是"恰好塞满"，
     而是「**看起来还有空间**」，**这才是它在真机上不显影的原因**。
   - 同族的判据错配：**用 `className` 正则匹配 `overflow-x-(auto|scroll|hidden)` 抓不到 CSS 文件里的裁剪**
     （那是 Tailwind 工具类；本项目 `mobile/android.css` 的 `overflow-x: auto` 不在 className 里）
     ⇒ 必须读 **computed style**：`getComputedStyle(el).overflowX`。
34. **屏幕度量的两个口径可以互相换算（2026-09-14 收敛）**：
   - `几何带 = 视口高 − 顶栏(64 + inset_top) − 导航条(56 + inset_bottom)`
   - `净可写区 = 几何带 − 36px`
     （36 = `.aurora-main` 的 `padding-top: 1.25rem` 20px + `.page-viewport` 的 `padding: 1rem` 16px）
   - 真机（inset 24/24）：`747 − 36 = 711`；无头 Chromium（inset 0/0）：`795 − 36 = 759`
   ⇒ **711 与 795 不是互相矛盾的两个数，是同一量在两种条件下的值。**
     报其中任何一个都必须同时说明条件（有无 inset、是否含内边距），否则会被当成口径冲突。
   - ⚠️ **本项目现有两套「内容带」口径，各自有效但不可直接比较**（2026-09-14 实测）：
     | 来源 | 定义 | 无头实测 |
     |---|---|---|
     | `verify-android-layout` | `.aurora-topbar` 底边 → `.android-tabbar` 顶边 | `[64, 859]` = **795px** |
     | `verify-profile-mobile` | `[data-testid="app-main"]` 内容盒 | `[84, 835]` = **751px** |
     差值来自「是否扣掉 `.aurora-main` 的 `padding-top`(20) 与底部 inset」。
     ⇒ 两套探针各用自己口径**内部一致**，PASS/FAIL 结论均不受影响；
       但**任何把两数并列的汇总都必须标注口径**，否则会被当成矛盾。
     ⇒ 就「元素是否落在带内」而言，**751 那套更严**（竖直方向收得更紧）。
     ⇒ 是否统一口径**不做强制**：统一不会改变任何结论，只增加一轮改动风险。
       真需要可比时再对齐，届时两套都要重跑对照。
   - **按断言分列的口径归属（2026-09-14 实测，写报告时可直接引用）**：
     | 断言 | 用哪个带 | 为什么 |
     |---|---|---|
     | A1 / A2 / A5 / A6 / A7（页内入口与入口行） | **内容带 795** | 页面级元素 |
     | A7 弹窗里的切换器 | **屏幕带 `0..innerHeight`** | 弹窗是 `fixed` 满屏遮罩，**按设计就盖住内容带**；套内容带是**范畴错误**（会假阳性） |
     | A8 | **屏幕带** | 底部导航 Tab **按设计落在内容带之外**；用内容带判会把它们全报成不可达 |
     | ④ 尾随余量 | 只对满足 `overflowX ∈ {auto,scroll}` **且** `display:flex` **且** `flex-wrap:nowrap` 的容器生效 | 其余容器**明写「不适用」**，不留空 |
   - ⇒ **推论（重要）**：「元素必须在带内」**不是处处适用** ——
     对**固定覆盖层**（弹窗遮罩）和**按设计在带外的元素**（底栏）套内容带会**系统性假红**。
     ⇒ 判据必须**显式声明自己用的是哪个带**；报告里要写出带的**名字**，不能只给两个数字
       （只给数字的话，读的人得自己反推是哪一套 —— 这正是"口径必须显式"的失败形态）。
35. **「读数本身」也可能不可判 —— 两类同族陷阱（2026-09-14 实证）**：
   **① 覆盖率对账（"数得上"）极易假绿，必须自带分母非零断言。**
   实证：本项目的覆盖对账前**两次跑都是空转**，而两次都"看起来覆盖完全"：
   - 第 1 次：磁盘列表用 `/e/Code/...`、`tsc --listFiles` 输出 `E:/Code/...` → 口径不同 → **磁盘列表成了空文件**
     → `comm` 一条不报 → 读作"没有漏"
   - 第 2 次：`sed` 转义写错 → 磁盘列表**又是空文件** → 再次静默通过
   ⇒ 覆盖率对账必须同时满足两条，否则它测的是"我有没有在数"，不是"有没有漏"：
   **(a) 分母非零断言**（磁盘列表 / 切片列表各自长度 > 0）；**(b) 两份清单归一到同一口径**再比。
   **② stdout 通道损坏时，「exit 0 且无输出」是不可判的。**
   实证：本会话 Bash/PowerShell 的 stdout 连 `Write-Output "probe-ok"` 都返回空 + exit 0
   ⇒ **无法区分「没跑到」与「跑了但输出被吞」**。
   ⇒ 任何门禁/检查的读数都应配一条**落盘通道**作对照（重定向到文件再读），
     否则"绿"只是"没看见红"。（同 §19 的 stdout 失效，但这里强调的是它对**结论**的影响）
36. **提交归属在本仓库不可证 —— 需要显式信号（2026-09-14 实证）**：
   实测：`git log` 里**每一条提交**的作者都是同一个身份，
   无论它由哪个 agent 写、哪个 worker 执行 ⇒ **`%an` 对"是哪个 teammate 写的"零分辨力**。
   任何事后归属结论都只能靠 lead 的记忆 —— 而记忆链在本轮已出错三次。
   - **约定（2026-09-14 起）**：worker 提交时在提交信息末尾加一行 trailer **`Agent: <worker-name>`**。
     git trailer 是自由格式，可 `git log --grep="Agent:"` 检索，成本一行。
   - **更要紧的判据区分**：一件事能不能**定性**，取决于是否存在**可证伪信号**，
     不取决于谁更谨慎。
     · 有信号 ⇒ 可定性并**排除替代解释**。例：查 `git reflog show origin/master` 得到 `update by push`
       + 提交区间，两者一对即可定性"是谁推的"，并能排除"环境异常/他人乱推"。
     · 无信号 ⇒ **只能标注为未知**。**不得用相邻性、时间顺序、命名习惯等弱线索冒充判据**
       （本轮实际犯过：由"#35 挨着 #33/#34"推出提交归属，错）。
   - **⚠️ 该约定的两处边界（2026-09-14 实测；首次发布时未验证）**：
     · **trailer 必须是提交信息的最后一段**。其后若再跟散文，`git interpret-trailers` **不再解析**
       ⇒ **归属被静默丢失**。实测：`…\n\nAgent: x\n我随手补的一句。` → 解析结果为空。
     · **`--grep` 会误命中"讨论该约定的散文"**：`git log --grep='Agent:'` 搜的是**整条信息**，
       任何提到这个词的提交都会被命中（**包括写这条规则的那次提交**）。
       ⇒ **机器读取一律用 `%(trailers:key=Agent,valueonly)`**；`--grep` 只作人工粗筛。
   - **⚠️ 本条自身的教训**：发布这条约定时**没给正对照** —— 检索命令当时 `--grep` 与
     `%(trailers:…)` **双双为 0**，无法区分「还没人加过 trailer」与「查询语法写错」。
     这与 §26 / §35 同族。**正对照**：由 lead 在下一个提交里带上 `Agent: team-lead`，
     并**当场验证** `%(trailers:key=Agent,valueonly)` 能取到它。
37. **注入/对照必须被证明「真的造成了缺陷」，否则会因「注入无效」而假过（2026-09-14 实证）**：
   实证：某对照组用 HTML `hidden` 属性隐藏元素，意图制造"在 DOM 但不可见"这一场景。
   但 **Tailwind 的 `flex` 类（`display:flex`）压过了 UA 样式表的 `[hidden]{display:none}`**
   ⇒ **注入没有生效** ⇒ 被判定的断言仍然 PASS ⇒ **对照差点假过**，
   最终是脚本自带的「N2 必须 FAIL」这条结论把它抓出来的（否则整组对照会读作"判据没问题"）。
   - **判据**：任何注入/对照都要**先验证注入确实造成了预期效果**
     （例如断言注入后目标量确实变了），**再**去看被测断言是否捕获。
     否则你测的是「注入有没有生效」，不是「判据能不能失败」。
   - 与 §22 同族但互补：§22 说**不要用可能不被生成的 Tailwind 类名做注入**（注入形式问题）；
     本条说**注入生效这件事本身必须被验证**（注入效果问题）。
38. **首页 6 张卡的「标签名」是安卓布局门禁的硬编码输入（2026-09-18 实证）**：
   `scripts/layout-gate/android-driver.ts` 的 `checkA5()` 里有一份**硬编码的 6 元素数组** `LABELS`
   （今日支出 / 本月支出 / 日均支出 / 累计支出 / 本月收入 / 本月结余），既供 `waitFor` 等渲染，
   也供「从标签往上走找到卡片」来量 6 卡合计占高。
   - **改任何一张统计卡的标签文案，必须同步这个数组**，否则 A5 报「仅识别到 5 张统计卡」**FAIL** ——
     症状看起来像"卡片没渲染"，实际是门禁按字面量找不到标签（**假红**）。
   - 判据：改完跑 `npm run verify:android-layout`，A5 的「实际」行须显示 **6 张**
     （2026-09-18 实测：6 卡合计 335.0px、单卡 163px 宽 ×6）。
   - 已核对 `scripts/` 下**只有这一处**硬编码这 6 个标签（desktop-driver 由 DOM 派生），无第二副本。
   - **与 §25 同族**：§25 是"改类名 → 靠字面量匹配的 **CSS 选择器**失配"，
     本条是"改文案 → 靠字面量匹配的**门禁**失配"。
     ⇒ **改任何字面量前先 grep 全仓，且范围必须包含 `scripts/`，不能只 grep `src/`。**
39. **Inno 静默安装 `exit 5` 的两种成因 + `app.asar` 被独占的实测绕行（2026-09-18 实证）**：
   **`INSTALL_EXIT=5` 本身没有诊断力** —— 它是「Setup 回滚 / 被取消」的统一出口，
   **必须加 `/LOG="<绝对路径>"`** 才能区分成因（不加日志时下面两种原因长得一模一样）。本轮连踩两种。
   - **成因 A：应用在运行，RestartManager 关不掉它。**
     日志特征：`RestartManager found an application using one of our files: 雷霆记账…` +
     `Some applications could not be shut down.` + `Defaulting to Abort for suppressed message box`。
     根因：`/SUPPRESSMSGBOXES` 会把「无法自动关闭应用」对话框的默认按钮取成 **Abort**。
     处置：装之前先关应用（`MSYS_NO_PATHCONV=1 taskkill /F /PID <pid...>`），**确认残留数为 0 再装**。
     ⚠️ **查进程有编码坑**：`tasklist` 输出是 **GBK**，直接 `grep '雷霆记账'` 命中 0 是**假阴性**
     → 必须 `tasklist /FO CSV | iconv -f GBK -t UTF-8` 再 grep
     （2026-09-18 实测：未转码 0 命中，转码后 **4 个进程**，与日志里 4 条 RestartManager 命中一一对应）。
   - **成因 B：`exe/resources/app.asar`（102MB）被某进程以「允许写、禁止删」的方式打开**（即 §7 记的坑）。
     日志特征：`An error occurred while trying to replace the existing file: … DeleteFile failed; code 32.`
     **决定性判据**：`fs.openSync(p,'r+')` **成功** 但 `fs.renameSync(p, …)` **EBUSY**
     ⇒ 持有者没给 `FILE_SHARE_DELETE`，而 `r+` 成功说明**有写共享** ⇒「能写不能删」。
     旁证：火绒三进程在场（`HipsDaemon` / `HipsTray` / `HipsMain`，与本文件 09-16 的嫌疑一致）；
     **持锁是持续的、不是 AV 瞬时扫描**（约 100 秒内 3 次重试，2s 与 40s 后仍 EBUSY）→ **重试无用**。
     **绕行（已验证）**：用 **`O_WRONLY|O_CREAT|O_TRUNC` 原地覆盖**，只需写权限、不需要 DELETE 权限：
     ① 先逐文件比 `release/win-unpacked` 与 `exe/`（比大小即可定位差异；实测 `missing=0 / sizeDiff=1`，
     只差 `app.asar` 176 字节 ⇒ 说明 Inno 其实已成功装了其余 101 个文件）；
     ② 分块 `openSync(d,'w')` + `writeSync` 覆盖 —— **不要用 `fs.copyFileSync`**（Windows 走 `CopyFileEx`，
     语义不如显式 O_TRUNC 可预期）；
     ③ 手动同步注册表 `HKCU\…\Uninstall\{ThunderBooks-78A1-4F3C-B2D9-E5F6C7A8B9D0}_is1` 的
     `DisplayVersion` / `DisplayName`（**用 Node 的 `execFileSync` 传参**，别走 bash 参数，避免中文编码问题）；
     ④ **验证四连**：逐文件比对应 `sizeDiff=0` + asar 内 `package.json` 版本 + **正负对照内容检查**
     （新串 `累计支出` / `记账 {n} 天` 必须 true，**旧串 `累计记录` / `本月账单数` 必须 false** ——
     只断言"新版在"会被"半拷贝/旧包"骗过，必须同时断言"旧版不在"）+ 注册表 `DisplayVersion`。
     **根治**：把 `exe/`（或整个项目目录）加入火绒信任区，之后 Inno 正常安装即可；**不建议关闭实时防护**。
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

---


## 八、工作区清理（实验产物）

**入口**：`node scripts/cleanup-worktree.cjs`（默认只报告，零删除）· 加 `--apply` 删 SAFE 级 · 加 `--apply --include-risky` 连 CONFIRM 级一起删 · `--json <path>` 落盘。

**清理依据 · 六维判据（2026-09-16，替代"凭感觉判断"）**：

| 维度 | 判据问题 | 判定 | 方向 |
|---|---|---|---|
| **D1 复用价值** | 一次性实验产物，还是会被再次使用的资产？ | 人判 | 一次性 → 偏删 |
| **D2 依赖引用** | 有谁引用它？（脚本 / 清单 / 文档 / 分发链路） | **机判** | 有引用 → **必留** |
| **D3 可重建性** | 能否从源码/配置重建？成本多大？ | **机判** | 可重建且低成本 → 偏删 |
| **D4 证据唯一性** | 是唯一记录吗？删了能否复现该次实验？ | 人判 | 唯一证据 → **必留** |
| **D5 时效性** | 是否已被更新版本取代？ | **机判** | 已取代且无引用 → 偏删 |
| **D6 出口归属** | 移出后谁负责销毁？有规则吗？ | **机判（制度判据）** | 无出口 → **禁止只移出** |

组合规则：`可自动清理 ⟸ D1∧D3∧D2无引用` · `必须保留 ⟸ D4 ∨ D2有引用` · `需授权清理 ⟸ D5∧D2无引用` · `禁止只移出 ⟸ D6无出口` · **`无法判定 ⟹ 不得自动删，转人工`**

**执行分级（三级，机器侧动作）**：

- `SAFE` = 可由构建/门禁重新生成，且不被任何已发布产物引用 → `out/` · `app-out/` · `dist-android/` · `release163/` · `release/win-unpacked` · `__missing_android_project__/` · `out/tsconfig*.tsbuildinfo`
- `CONFIRM` = 有回滚或审计价值 → `release/` 超保留数（3）的旧安装包及其 blockmap · `release/*.log` · `exe/` 里的旧安装包 · `release-android/` 超过 3 个的 apk · 根目录 `progress.state.*-archive-*`
- `KEEP` = **永不自动删**，只列出 → `artifacts/`（审计证据）· `exe/`（AGENTS.md 固定验收目录）· `release/*.yml`（被分发链路引用）· 根目录 `PRD.md` / `task_plan.md` / `findings.md` / `progress.*`

**根因（2026-09-16 两轮审计后定稿）：生态级机制缺口，不是本项目问题**

> **一句话：生态内所有清理机制都只定义了「挪到哪」，没有一处定义「何时销毁」与「谁负责检查」。**

- ⭐ **决定性证据**：`E:/Code/shio-al-ecosystem-archive/` 顶层**5 代归档并存、无一代被移除**（`20260913-workspace-cleanup` / `sae-p0-cleanup-20260909` / `sae-p0-pre-v39-cleanup-20260909-r1` / `sae-remnants-20260910` / `sae-self-20260915-matrix-v450`）→ **连机制作者自己的仓都在堆**，这推翻了「本项目特有 / 执行方疏忽」两个替代解释。
- ⭐ **横向检索**：`worktree remove` / `worktree prune` 在**整个 `~/.workbuddy/skills/` 0 命中**；`retention` / `保留期` / `TTL` 命中均域外 ⇒ **没有任何 skill 定义过"产物必须拆除"**。
- **主因＝SACW**（`shio-al-coding-workflow` v5.7.0）5 条缺陷：①隔离工作区只建不拆 ②收尾清单①判据可空转（`cleaned: []` 即 PASS）③门禁触发面被 `workspace.ref` 收窄 ④零跨会话残留自检 ⑤**无中断态现场回收定义**。完整证据（文件 + 行号）见 `docs/sacw-cleanup-defect-report.md`。
- ⚠️ **口径**：「主因」指**机制责任的上游性**（SACW 是整条流程的上游，且是唯一有收尾钩子的一环），**不是体积占比** —— 实测 8.75 GB 中约 **7.5 GB 不属 SACW 域**（SAE 6.1 G + 项目自建隔离区 1.4 G）。
- **次因＝本项目自身**：

| 缺失层 | 实测事实 | 后果 |
|---|---|---|
| 机制层 | `.codebuddy/` 下**只有 `rules/`，无 `settings.json` / `hooks/`** | 没有"不清理就过不去"的闸门 |
| 入口层 | `package.json` 的 scripts 里**没有任何 clean 入口**（只有 6 个 `verify:*`） | 没有一键可执行的动作 |
| 信号层 | `.gitignore` 忽略 `out/ artifacts/ release/ exe/ release163/ *.log` → `git status` **实测 0 条** | 没做也看不出来，唯一天然提醒信号被切断 |
| 生成层 | 4 个门禁脚本**都写了** `fs.rmSync(tmpDir)`，但注释是「清理失败可忽略」 | `out/` 里实测堆积 **9 个 `desktop-parity-*` + 8 个 `dp-*` + 十余个 `layout-gate-*`** 泄漏目录 |

- **历史教训**：`artifacts/cleanup-manifest-v1.16.0.json`（2026-08-29）证明**做过一次完整清理规划**，但那是**一次性人工清单**，未迭代成机制 → 18 天后 `out/` 涨到 435MB。**"做过一次" ≠ "以后都会做"。**
- **反模式**：把纪律只写进 AGENTS.md / 日志，就认为已经约束住了（用户级记忆 §约束强制）。
- **注意**：`.gitignore` 忽略产物本身是**对的**（产物不该入库），代价是失去信号 → **必须配补偿机制**，否则清理需求永不可见。
- **报告落盘通道**：stdout 在本环境可能整体失效（§19），需要留证据时用 `--json artifacts/cleanup-report-<date>.json`，再读文件核对。

### 项目外同源产物（`E:\Code\CodeProduct\` 下，但由本项目产生）

清理器第二段专扫这里 —— **项目内扫描结构上看不见它们**。

| 目录 | 体积 | 性质 | 处置 |
|---|---|---|---|
| `ta-a7-ctl` · `ta-a7-new` · `ta-gate-baseline` · `ta-gate-ctl` | 180 MB | 冻结 worktree（detached，工作区干净） | 可摘除 |
| `ta-gate-ctl-g21` | 37 MB | 冻结 worktree，**含 2 处未提交注入改动** | 先导出 diff 再摘 |
| `thunder-accounting-archive` | 5.93 GB | SAE 自改进 09-15 23:52 授权归档区（36 目录 / 57784 文件） | **保留期待裁定** |
| `thunder-accounting-cleanup-quarantine-v1.16.1` | 1.30 GB | 08-29 隔离区，搁置 18 天未确认 | 待确认后删 |

- **worktree 必须用 `git worktree remove` 摘除，禁止 `rm`** —— 否则 `.git/worktrees/` 留悬空元数据。（清理器判 `isWorktree` 时自动走 git 路径）
- **脏 worktree 永不自动删** —— 即使开了 `--include-risky` 也会跳过，必须人工先导出 diff。
- **判据是白名单式，不是模糊匹配**：worktree 只认 `git worktree list` 的**登记项**（权威来源）；archive / quarantine 只认 `thunder-accounting-` 前缀；**其余兄弟目录一律列为 OUT OF SCOPE，不统计、不删除**（`CodeProduct/` 下有 10 个用户的其他项目）。
- **`git worktree list` 是权威判据**：它同时暴露**悬空登记**（git 有记录、目录已不在）→ 用 `git worktree prune` 清。

### ⭐ 更深的根因：「移出」动作只定义了入口，没定义出口（2026-09-16 定）

- **冻结 worktree**：建它有纪律（量测须在 detach 树上做，见 §28），**拆它的纪律没有** → 09-14 建的 5 个挂到今天，且在项目外，项目内清理器看不见。
- **归档**：09-15 的 SAE 归档**有授权、有 report、`failed=0`**，动作本身完全合规 —— 但**归档目的地没有保留期限规则** → 6 GB 从项目搬到项目外，堆积只是换了个地方继续。
- **隔离区**：设计意图是「缓冲待确认」，但**没有到期机制** → 08-29 建的隔离区搁置 18 天。
- **生态侧同样如此（2026-09-16 审计新增）**：SAE 的 `retention` / `TTL` / `保留期` 检索**全目录 0 命中**；`<project>-archive` 同级根**只规定「建/复用」、无容量与保留期约束** ⇒ **归档根处于规则真空**（删除边界被锁死在"项目根内"，而归档根在项目根外，不受任何规则约束）。
- **推论（写进纪律）**：任何「把东西挪走」的机制，必须**同时**定义 ①挪到哪 ②什么时候销毁 ③谁负责检查。缺了 ②③，它只是把问题转移到**可见性更低**的地方 —— 项目外没有 `git status`、没有门禁、没有清理器，**比留在项目内更难被发现**。
- **适用边界**：清单里的 `exe/`（486 MB）与 `artifacts/`（审计证据）是 AGENTS.md 指定保留项，**不在清理范围**；判据见本脚本的 `KEEP` 级。

### 执行记录（2026-09-16 首次执行，A+B+C 分层）

| 档 | 内容 | 结果 |
|---|---|---|
| A | `out/`(434.9M) · `app-out/` · `dist-android/` · `__missing_android_project__/` · 5 个 worktree(224M) | ✅ 已删 |
| A | `release163/`(384M) | ⚠️ **未完成** —— 其余已删，剩 `win-unpacked/resources/app.asar` **98 MB** 被占用 |
| B | 隔离区 1.30 GB + `release/*.log` ×4 + `progress.state.v1176-archive-20260913` | ✅ 已删 |
| C | 归档区可重建层 **22 项 / 5.87 GB**（`build-*`×7 · `custom-install-*`×4 · `installed-*`×3 · `inspect-*`×2 · `verify-app-asar-*` · `inno-v*`×2 · `inno-syntax-check-*`×3） | ✅ 已删，0 失败 |
| C | 证据层 18 项 / 60 MB + 根级索引 | ✅ 保留；归档区 **5.93 G → 62 M** |

**实际释放 ≈ 7.8 GB**（计划 8.5 GB；差额＝`release163` 残留 98 MB 与估算偏差）。

- ⚠️ **`release163/win-unpacked/resources/app.asar`（102 MB）被锁** —— `EBUSY: Device or resource busy`，3 次重试（含 5s 等待）均失败。已排除：无进程路径指向该目录、无 Electron 实例。**嫌疑＝火绒（`HipsDaemon`/`HipsTray`）实时防护**持有该 102 MB 归档文件句柄。**处置：把 `release163` 加入火绒信任区后重删，或重启后重试；不建议关闭实时防护。**
- ⚠️ **危险结构（本次避坑，务必记住）**：5 个 `ta-*` worktree 内各有一个 `node_modules` **符号链接指向主项目 `node_modules`**。`git worktree remove` 后这些链接仍在 —— **任何跟随符号链接的清理（如 `rm -rf <dir>/node_modules/*`）都会摧毁主项目依赖**。正确做法：`unlink <dir>/node_modules` 只解除链接，再 `rmdir <dir>`。本次已按此执行，主项目 `node_modules`（613 项 / 852 M）完好。
- **索引留档**：归档区 4 个根级文件已复制到 `artifacts/sae-self-20260915-index/`。⚠️ `artifacts/` 被 `.gitignore` 忽略 ⇒ 该备份**在盘不在库**，若要入库需 `git add -f`。
- **新增安全门闩**：`--include-risky` **不再**整体删除 `*-archive`（会连带丢掉难以复现的历史视觉基线）；归档一律走 `--archive-prune`（正向前缀白名单，默认保留）。
