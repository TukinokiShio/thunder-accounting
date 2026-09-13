# Thunder Accounting Android v1.0.0 Task Plan — 安卓端移植（Capacitor）

> Run 2026-09-13 · SACW v5.6.1 · 状态机 `TASK_CLASSIFY→…→PLAN`（**当前停点 = PLAN 人为终审**）

## 执行形态：多 Agent 编排（三证之二）

| 状态 | 模式 | 选型依据（loop-spec §7.2 决策树） |
|---|---|---|
| `KNOWLEDGE_GATE` | Supervisor + **Explore 子代理**（已执行 `agent-a6a9459b`） | 摸底必须派 Explore，主 Agent 只收摘要 |
| `PLAN` | Supervisor 汇总（**非黑板**） | 移植路径已由事实收敛，非开放方案探索 |
| `EXEC` | **Supervisor 流水线**（分 4 阶段派 Worker） | 阶段可分解、依赖清晰、无并行冲突模块 |
| `REVIEW` | **辩论**（独立 Reviewer，R ≠ W） | 移植正确性无唯一答案（行为等价性 + 视觉），需独立证伪 |
| `EVAL` | Supervisor 网关 + **独立 Judge**（J ≠ W ≠ R） | 双门槛 eval ≥90 / quality ≥70 |
| `FINAL` | Supervisor + 独立 quality 审查 | 按项目交付纪律 |

**编排落盘**：`contracts/orchestration/android-*.json`（Worker 回执必须落盘，禁止只有声明无文件）

## 版本与范围

- **安卓版本线独立**：`androidVersionName = 1.0.0`，`versionCode = 1`（与桌面 v1.17.x 解耦）
- **首版范围（用户答复 D1–D3）**：纯本地单机 · 竖屏手机（360–430px）· 不做平板/横屏 · 不做云端登录与同步
- **桌面版本线**：本次若改动共享 `src/`，桌面按 SemVer 判定 bump 并走完整交付链；仅 `android/` 内改动不触发桌面发布

## 需求（用户答复 → 可验收标准）

| id | 来源（用户原话） | 可验收标准 | 验证方式 |
|---|---|---|---|
| RL-A1 | 「安卓端一定要实现和 windows 端数据同步，否则毫无意义，当然，首版可以先暂时不做这一步」 | ① 首版**无**云依赖即可完整使用全部核心功能 ② 适配层**已为云同步预留位**：41 个方法名与返回契约与桌面**完全一致**，云相关方法在未开启时返回「不可用」而非抛错 | ① APK 断网可用全流程 ② 契约一致性测试（方法名集合 == 桌面 `ElectronAPI`） |
| RL-A2a | 同上 | 记账 → 统计 → 分类管理 全链路在安卓端可用 | 真机/模拟器端到端冒烟 |
| RL-A2b | 同上（**2026-09-13 拆分**） | **备份导出/导入**：真实文件通道（Capacitor Share / Filesystem）可用 | 属 **P1-5**。**在其完成前，UI 必须明确标注「不可用」，不得呈现为可用** —— 当前适配器 `showSaveDialog`/`showOpenDialog` → `null`、`writeFile` → `false`，是"明确不可用"而非"假成功"（符合 C2），但确实**未满足本项** |
| RL-A3 | 「参考上一点 oq」（跨端互通） | 安卓导出的 JSON 备份可被桌面端 `importBackup` 导入，反之亦然 | 双向实测：安卓导出 → 桌面导入 → 数据一致 |
| RL-A4 | 「暂且仅做标准竖屏」 | 360/390/430px 宽下**无横向溢出**；触控目标 ≥44px；无平板断点 | headless Chromium 多档视口 + 几何断言 |
| RL-A5 | （自证，非用户原话）纯本地前提 | 安卓端**不出现登录页**，也不因 `user === null` 卡在加载态 | 冷启动直达首页 |
| RL-A6 | 项目交付纪律（AGENTS.md + 用户级记忆） | 桌面端**行为零变化**：既有测试套件全绿；`git diff` 不触及 62 处生产调用点 | `npm test` 全绿 + diff 审查 |
| RL-A7 | 项目踩坑 KI-001 | **修正原措辞**（原「`package.json` 只允许 version 行差异」在 Capacitor 依赖必须登记时**字面不可满足**，会逼执行者破戒）：① `scripts`/`devDependencies`/`build` 三段结构**完整无损** ② 新增依赖显式登记、人工可审，**禁止**写入嵌套 `package.json` 造成双份 node_modules（React 重复实例化 → hooks 报错） | `node -e` 逐段断言 + `git diff package.json` 人工审 |
| RL-A8 | 独立 Judge（`agent-d9dfa538`）发现的「死线」 | 安卓端**不伪造用户身份**，顶栏**不得谎报「已同步」** | 断言 `user === null` 且 `syncStatus === 'offline'`；顶栏渲染未登录态 |
| RL-A9 | 独立 Judge + 红队共同指出 | **云能力门真正接线**：`Profile.tsx` 的 `cloudAvailable` 下传至 `:426/:706/:1226` 但**三个消费组件零引用**，且 `:121-125` 挂载期**无条件**调 `CloudbaseContract` 三个接口。<br>⚠️ **2026-09-13 需求修正（原措辞有误）**：原写「`:91/:103/:114` 三个**云**调用」是错的 —— 已独立核实 `:103` 对应的 `getUserStats` 在桌面（`cloudbase.ts:1382-1402`）与安卓适配器（`android-adapter.ts:389-395`）**都是读本地库聚合** → **它不是云调用**。按事实修正为：**门控范围 = 2 个真云调用（`getAccountBindings` / `isCloudSyncEnabled`）+ `getUserStats` 必须移出云门**（否则安卓「我的 → 数据概览」恒为空态，属用户可见功能缺失）。 | 断言本地模式下：`getAccountBindings` / `isCloudSyncEnabled` **未被调用**，且 `getUserStats` **被调用并返回真实本地数值** |
| RL-A9b | Phase 2 执行者提出 + Supervisor 采纳 | 门控的**实现方式**不按云状态短路 | **采用平台短路（`if (localMode) {…return}`）**。理由：按 `cloudAvailable === false` 短路会让桌面在 `checkCloud()` 返回后 **effect 重跑** → 云可用时重复发起 IPC、云不可用时把 `loadAccount` 的错误态覆盖成 ready，**两者都破坏「桌面零变化」不变量**。平台短路在安卓侧可观测行为等价，且更好地守住不变量 | 断言桌面路径的挂载期调用次数与顺序**不变** |

## 不变量（must-keep，违反即 P0）

1. **`src/` 的 62 处生产调用点（`grep -o 'electronAPI\.[a-zA-Z]*' src` 排除 `*.test.*`）一个都不改** —— UI↔宿主契约冻结在「方法名 + 返回结构」
2. **`src/` 不得 import `mobile/` 任何东西** —— 适配器只在 `mobile/` 入口安装；违反 = 桌面包被污染 + 10 个 UI 测试可能看见真实适配器。**须写成可 grep 的门禁断言**
3. **禁止构建期平台分支** —— 绝不在构建时改 renderer 入口或注入代码（`electron.vite.config.mjs:28` renderer `outDir = app-out/renderer`，而 `package.json:60` 把 `app-out/**/*` 打进桌面包 → 构建期分支会**覆盖桌面产物**，属 KI-003 式静默污染）。平台分支一律**运行时**判定
5. **桌面分支行为逐位等价** —— 新增平台分流必须默认走 electron 分支；`saveDb()` 必须保持**同步签名**（`main.ts:72-79` 的 `will-quit` 只 `unregisterAll`，**无 flush** → 若改 async 会丢最后一批写）
6. **模态层 Portal + 作用域替身不得回退**（KI-003；本轮重排 DOM 祖先极易复发）
7. **`saveDb()` 顺序语义不得变** —— 取 `last_insert_rowid()` 必须在 saveDb **之前**（踩坑 #1；本机实测 `db.export()` 后 rowid `1 → 0`）
8. **不 fork `src/`**，不产生第二份 UI 真源
9. **`android/`（Capacitor 宿主工程）与 Electron 打包链物理隔离** —— 不污染 `release/`、`exe/`、`app-out/`、`out/`
10. **`Buffer` 不得出现在安卓可达路径上** —— `main-process/database/index.ts:306` 用 `Buffer.from(data)`，Android WebView **无 `Buffer`**

## 拓扑（DAG）

```
Phase 0 可行性 spike ──┐
  P0-1 sql.js@WebView   │  任一失败 → 回流 PLAN 换方案（不硬推）
  P0-2 Gradle 非沙箱构建 ┘
        │
        ▼
Phase 1 适配层抽取（桌面零行为变化）
  P1-1 平台无关契约 AppAPI ──→ P1-2 DB 纯逻辑 + StoragePort ──→ P1-3 android 适配器 ──→ P1-4 启动注入
        │
        ▼
Phase 2 移动端 UI 适配（竖屏）
  P2-1 底部导航  ┃  P2-2 hover→常显  ┃  P2-3 拖拽→按钮  ┃  P2-4 安全区/100dvh  ┃  P2-5 本地模式门禁
  （P2-2/P2-3/P2-4 相互独立 → 可并行派 Worker）
        │
        ▼
Phase 3 打包与验收
  P3-1 Gradle 工程配置 ──→ P3-2 assembleDebug ──→ P3-3 模拟器/真机冒烟 ──→ P3-4 用户真机验收
```

**关键路径（AOE）**：`P0-1 → P0-2 → P1-1 → P1-2 → P1-3 → P3-1 → P3-2 → P3-3 → P3-4`
（P1-2 为最长单点；P2 全系列可与 P1 后半并行，但需 P1-1 契约先冻结）

## Phase 细节与验证门禁

### Phase 0 — 可行性 spike（最高风险前置，先证后建）

> **本轮经独立方案（`agent-4d7fad9d`）+ 红队（`agent-ee67cb48`）+ Judge（`agent-d9dfa538`）三方证伪后重排**：原方案只有 2 项 spike，遗漏 5 项被证伪出的高危面。

| # | 要证/要证伪的事 | 通过判据 | 成本 |
|---|---|---|---|
| **S1** | Capacitor 8 + 本机 Gradle 8.10.2 / AGP 8.5.2 / JBR 21 组合可用（空工程，不含本项目代码） | `assembleDebug` 产出 APK → `adb install` 到 Pixel_8 → 启动无白屏。失败则降级试 Capacitor 7 | 中（需非沙箱联网补 `androidx.webkit`/`coordinatorlayout`） |
| **S2** | `saveDb()` **全量落盘**在安卓上可接受（每次记账 `db.export()` 全库 + base64 往返 ≈ +33%） | **纯 Node 即可先测**：造 50k 行库测 `export + Buffer + base64` 耗时 <50ms 可忽略；再在 Pixel_8 连做 100 次写，**无 UI 卡顿 >100ms、无 ANR** | 低（前段不需安卓） |
| **S3** | 触屏下「仅 hover 可达」与「HTML5 拖拽」类交互的**完整清单** | headless Chromium 375×812 加载现有构建，枚举所有依赖 `:hover` 才可见/可用的元素 + 布局塌陷位置，**逐条给出「首版必改 / 推 2.0」处置决定**（判据不是"清单为空"，它一定不空） | 低 |
| **S4** | 适配器契约与云降级语义（零成本，与 S1 并行） | 41 方法集合与 `preload.ts` **全等**；逐个 await 全部云方法，断言「文档化降级值 **或** `CloudUnavailableError`」，**任何"假成功"判失败**（尤其 `loadCredentials` 必须返回对象不可抛错——`App.tsx:33` 直接读 `.autoLogin`）；断言安装前 `window.electronAPI` 为 `undefined` | **零** |
| **S5** | `user === null` 下 `Profile` 与顶栏的渲染路径不崩、不谎报 | 断言不抛异常；`syncStatus === 'offline'`；顶栏为未登录态（RL-A8） | 低 |
| **S6** | **循环依赖**在换打包器后的求值顺序（`database/index.ts:5` ↔ `export.ts:2`） | 抽出共享模块后 `getDb()` 不因静态求值得 `undefined` | 低 |
| **S7** | `sql.js` 在 WebView 下解析到的是 **browser 变体**（`sql-wasm-browser.js`），其 `.wasm` 资源如何进 APK | 产物级断言：APK 内**存在** wasm 资源且运行时可加载（不是"能 init"就算过） | 中 |

- **失败处置**：任一 P0 级 spike 失败 → 记录归因 → **回流 PLAN 重选方案**（不硬推；不得降级成"只出 Web 版"充数）
- **S1/S2 为阻塞项**：未通过不得进入 Phase 1

### 执行结果（2026-09-13）

| # | 状态 | 结论摘要 |
|---|---|---|
| **S1** | ✅ **PASS（阻塞项打通）** | `BUILD SUCCESSFUL in 3m 14s` / `GRADLE_EXIT=0` / APK 4.0MB；`Pixel_8` 安装 `Success`，`topResumedActivity` 命中，崩溃日志空，**截图确认 WebView 非白屏** |
| **S2** | ✅ **PASS（渲染路径段）** | 5 万行库单次「记一笔」全链路 **10.1ms** → 证伪红队 R2，维持 sql.js。**设备段待 Phase 1 后补测** |
| **S4** | ✅ **前置 PASS** | 接口 41 == preload 41，集合相等；**新发现契约有两份独立定义会静默漂移** → C1 断言须同时覆盖两份 |
| **S6** | ✅ **取证完成** | 确认真实值级循环依赖（`index.ts:5` ↔ `export.ts:1-2`），靠 `getDb()` 惰性调用绕过 → **P1-2 必须保留该形态** |
| **S3** | ✅ **PASS** | 触屏可达性盘点完成（只读代理 `agent-d9d7dc60`）。量化：CSS `:hover` **32** 条 / Tailwind `hover:` **53** 处 / `onMouse*` **1** 处 / `draggable+onDrag*` **13** 行 / 源码 `onKeyDown` **6** 处 / `100vh` **4** 处 / `100dvh` **1** 处 / **`env(safe-area-inset*)` 0 处** / **无任何 hover 能力检测媒体查询**。<br>**首版最小阻断集＝2 项**：① `CategoryManager/CategoryList.tsx:91` 删除按钮 hover 才可见（编辑模式方案已覆盖）② 同文件 `:68-71`+`:80-85` 拖拽必须**从 HTML5 DnD 换成 pointer 事件**（编辑模式只解决"何时可拖"，不解决"怎么拖"）。<br>**重要减压结论**：键盘依赖**不阻断** —— Esc 关弹窗有背景点击 + X 按钮、Enter 添加子分类有等价按钮、日期选择器 `readOnly` 且格子可点、首页卡片本身有 `onClick`。 |
| **S5** | ⏳ 待做 | `user === null` 下 Profile / 顶栏渲染路径 |
| **S7** | ⏳ 待做 | WASM 资源进 APK 的产物级断言 |

> **关键环境结论（已写入项目 wiki）**：Capacitor 8 要求 **Gradle 8.14.3 + AGP 8.13.0**（`android-packager` skill 固化的 8.10.2/8.5.2 对 Capacitor 项目**不成立**）；wrapper 应用 `-bin` + 腾讯镜像；**沙箱内既不能解析 Maven 也不能跑模拟器** —— 完整链路必须非沙箱单命令串行。

### Phase 1 — 适配层抽取（**桌面零行为变化**）

> **执行状态（2026-09-13）**：P1-1 / P1-2 / P1-3 / P1-4 代码层 **已交付并经独立验证后提交**（commit `8b75018`，15 文件）。
> 独立验证（`general-purpose-2`，非执行者本人）结论：**字节级 + 语义级 + 构建产物 + 356 测试 四路证据一致 → 「桌面行为零变化」在实测范围内成立**，判 **conditional**，两处放行条件（错误注释）已修。
> **未闭环两块 → P1-5 / P1-6 已派发**（不完成则安卓端在真机上是"fail-loud 的不可用"，属已知未闭环项，非缺陷）：

> 📌 **方法论沉淀（验证者实测发现，务必沿用）**：`bills.created_at DEFAULT (datetime('now','localtime'))` 使**墙钟成为 `.db` 字节的真实输入** → 任何跨版本/跨平台的落盘字节比对**必须先冻结时钟**，否则会把时间差异误判为行为差异。
> 📌 **残余风险（环境限制）**：本沙箱**无法启动 Electron**，故「真实宿主 + preload/IPC + will-quit」端到端烟测**未做**，验证用 electron stub 替代 → 已列为**交付前用户侧烟测项**。
- **P1-1**：`src/types/index.ts` 的 `ElectronAPI` 提取为平台无关契约 `AppAPI`（**同 41 方法名**，`ElectronAPI = AppAPI` 别名保持兼容）
- **P1-2**：DB 纯逻辑与持久化解耦（注入 `StoragePort`）；桌面实现 = 现有 `fs` 路径，**行为逐位不变**
- **P1-3**：android 适配器实现 41 方法；云/账号/文件对话框类方法返回明确「不可用」语义
- **P1-4**：启动时注入（`window.electronAPI ??= androidAdapter`），**不改任何调用点**
- **门禁**：`npm test` 全绿 + `git diff` 调用点零改动（**实测 62 → 62**）+ C1 契约三方集合相等断言
  > ⚠ **门禁补强（2026-09-13）**：**「测试全绿」不能证明类型正确** —— vitest/esbuild 会剥掉类型不做检查，且本项目**没有 `typecheck` 脚本**，而 `mobile/` **不在任何 tsconfig include 内**。→ 门禁必须增加 **`tsc --noEmit` + 基线对比**（把既有配置噪音与新引入错误逐条分开），否则"改名漏改引用"这类错误会静默通过测试（本轮已真实发生一次）。

| # | 遗留项 | 内容 | 前置 | 状态 |
|---|---|---|---|---|
| **P1-5** | **安卓 StoragePort + 文件通道** | ① 实现安卓侧 `StoragePort`：Capacitor Filesystem/Preferences **全是异步 API**，无法满足 `saveDb()` 的同步签名 → 采用 **「启动期 hydrate + 内存副本 + 写合并队列」**：`await port.hydrate()` 异步预读 DB 进内存 Map → 同步方法读 Map；`writeDbFile` 同步更新 Map + 标脏 + 调度异步 flush（**按 path 合并、保序、失败不静默**），并在 `appStateChange` 切后台时强制 flush ② 实现文件通道使 **RL-A2b 备份导出/导入**真正可用：`showSaveDialog` → 返回 cache 虚拟路径；`writeFile` → 写 cache 后 `Share.share()`；`showOpenDialog` → **隐藏 `<input type="file">` + FileReader**（不引第三方插件），取消返回 `null` ③ 装 `@capacitor/filesystem` / `app` / `share`（写根 `package.json` 的 `dependencies`） | P1-2 的 `StoragePort`；Phase 3 的 Capacitor 工程 | **已派发** |
| **P1-6** | **让契约注解参与 CI** | ① `mobile/**` 纳入类型检查（新增 `tsconfig.mobile.json` 或并入 `tsconfig.web.json`）② 加 `typecheck` script ③ 建**类型检查基线**（区分既有噪音与新引入错误）④ 补**签名级**契约断言 —— 现有 C1 **只比键名集合、不比签名**，故参数/返回类型漂移无人拦 | P1-5 | **已派发** |

> **决策记录（Supervisor 自定，非 OQ）**：v1 本地库名**保持默认共享库名**，v2 首登走 `migrateSharedData=true` —— 见上文 C4 修订。

### Phase 2 — 移动端 UI 适配（竖屏）
| 子项 | 现状（取证位置） | 目标（**已按 2026-09-13 终审定稿**） |
|---|---|---|
| P2-1 底部导航 | 固定 224px 侧栏不收缩（`index.css:140-141`、`Sidebar.tsx:37`） | **采纳方案 B**：<640px 改 **4 Tab（首页/账单/统计/我的）+ 中央凸起「记一笔」FAB**；与侧栏 5 项一一对应；桌面侧栏保持原样。FAB 须避让底部安全区，且与弹层有遮挡关系需处理 |
| P2-1b **当前页指示** | 无（桌面靠侧栏选中态） | **文字 + 图标发金棕色光**，**不使用色块**。发光用 `text-shadow`，金棕色取品牌 `--accent #d59b25`（深色主题 `--accent-h #efb82f`）。**四档强度待用户挑定**（关 / 弱 / 标准 / 强，demo 默认「标准」）。<br>⚠ 实现坑（本轮 demo 已踩）：通用 `button.on{background:...}` 会误命中 `class="tab on"` → 选择器必须限定作用域 |
| P2-2 hover→常显 | **删除按钮靠 `group-hover` 才可见**（`CategoryManager/CategoryList.tsx:91`）；S3 量化：CSS `:hover` 32 条 + Tailwind `hover:` 53 处 | 触屏常显 / `:active` 反馈；**单列删除按钮点不到 = 功能性阻断，优先修**。装饰性 hover 保留即可（触屏无功能语义），仅需注意 Android 点按后可能残留"粘滞 hover"高亮 |
| P2-2b **账单列表编辑/删除按钮**（S3 新发现） | `Bills.tsx:298/308` → `opacity-100 md:opacity-0 md:group-hover:opacity-100` | **严重度已下调（我复核后更正 S3 的判断）**：Tailwind `md` = **768px**，而手机竖屏 CSS 宽度约 **360–430px** → 该分支**不触发**，按钮常显，**首版不阻断**。但它是**平板/横屏（≥768px）的潜在雷**，且修复只是删掉 `md:opacity-0 md:group-hover:opacity-100`。因本轮已在改共享 `src/`，**顺带修掉**（零额外代价） |
| P2-3 排序与删除交互 | **S3 核实**：`CategoryManager/CategoryList.tsx:68-71` 整行 `draggable` + `onDragStart/onDragOver/onDragEnd`（**HTML5 DnD**）；`:80-85` 的把手是 `<span>` **只做了 `onMouseDown` stopPropagation，本身不是拖拽源** | **编辑模式方案（用户定稿）**：普通模式点分类只做重命名/改图标；点「编辑」进入编辑态后，每行 **左侧拖动把手（按住才能拖）+ 右侧删除按钮**。拖动与删除**仅编辑模式可用**。<br>**S3 关键纠正**：编辑模式只解决了"**何时可拖**"，**没解决"怎么拖"** —— 必须把底层从 HTML5 DnD **换成 pointer 事件**，否则 Android WebView 仍不可用。且把手需从"仅 stopPropagation"改为**真正的拖拽源**（`pointerdown` + `setPointerCapture` + `touch-action:none` + 长按激活）。<br>**删除必须二次确认**（UX 防误删）：确认框显示将删除的子类数量，并说明已使用该分类的账单**不会被删、只变成「未分类」**。不引入第三方拖拽库（避开与弹层/滚动的手势冲突，且可自动化测试） |
| P2-4 安全区/视口 | 无 `viewport-fit=cover`、无 `env(safe-area-inset-*)`、`100vh`（`index.css:233,259,410,414`） | `viewport-fit=cover` + `100dvh` + 安全区内边距 |
| P2-5 本地模式门禁（**按 Judge 裁决定稿**） | `AuthGuard.tsx:25` `if (!user) return <LoginPage/>`；**且** `App.tsx:49-54` 数据加载以 `if (user)` 为条件（漏改则分类恒空、记一笔不可用）；**且** `Profile.tsx` 云能力门是死线 | **机制 = 平台门 + 诚实 `null` user + 接上能力门**（**否决合成 user**：`store/index.ts:166` 会把 `syncStatus` 抬成 `idle` → `Layout.tsx:35-37/52` 顶栏谎报「已同步」）。最小文件集：① `AuthGuard.tsx` 加平台分支（electron 保持现有行为）② `App.tsx:49-54` 加载门改为「会话已判定」（`isCheckingSession` 在 `:40` 的 `finally` 恒置假）③ `Profile.tsx` 真正消费 `cloudAvailable` 并在 false 时跳过 `:91/:103/:114` 三个挂载期云调用 ④ `mobile/` 适配器 `isCloudSyncEnabled → false` |
- **门禁**：`aurora_lint.py` 无 error + headless Chromium 360/390/430px **几何断言**（无横向溢出、44px 触控、底部导航可见）+ 独立 UI/UX Reviewer（UX 轴）

### Phase 3 — 打包与验收

> **打包 skill 强制激活（用户确认 2026-09-13）**：`android-packager` 是**安卓打包的专用 skill**（对标 `inno-packager`，同样固化本机环境、带 helper 脚本与版本发布纪律）。
> **SACW §5.11 第 9 条对 APK 豁免 inno 门禁** —— Windows exe 才走 `inno-packager` + `artifacts/inno/inno-receipt.json`；**APK 走 `android-packager`，两者互不替代、互不冒充**。

- **P3-1**：包名 `com.thunder.accounting`、`versionName 1.0.0`/`versionCode 1`、图标、**本地 keystore 签名配置**（密码走 `gradle.properties` 或环境变量，**不入库**）
- **P3-2**：激活 `android-packager` skill 出包 —— 优先用其 helper `scripts/build_apk.py`（自动配 `ANDROID_HOME` / `JAVA_HOME` / `PATH`），必要时 `--gradle "E:/Code/Android/HelloApp/gradle/gradle-home/gradle-8.10.2/bin/gradle.bat"`。产物落 `release-android/`（**不污染 `release/`**）
- **P3-3**：模拟器（`Pixel_8` / API 37）安装 + 冒烟（冷启动直达首页、记一笔、统计、分类编辑模式、备份导出）；`adb shell dumpsys package <包名> | grep versionName` 验证版本
- **P3-4**：**用户真机验收**（三证：端到端实跑 + APK 产物 + 用户回填签字）
- **门禁（全部来自 android-packager 的实测结论）**：
  - **JDK 必须 JBR 21**（`E:/Code/Android Studio/AS/jbr`）——系统 JDK 24 会报 `Unsupported class file major version`
  - `gradlew` 会尝试联网下发行版 → 用已解压的 **Gradle 8.10.2**（`--gradle` 指定）
  - 改代码/版本号后先 `clean` 再构建（防缓存污染）
  - 新增 `androidx.webkit` / `coordinatorlayout` 等未缓存依赖时，Gradle 需**非沙箱**联网（沙箱内 Maven 返回 200 但 0 字节）
  - 版本纪律：`versionCode` **必须单调递增**，否则无法覆盖升级

## 反模式清单（本轮强制禁止）

1. ❌ 改 `src/` 里 62 处生产 `window.electronAPI.xxx` 调用点（契约冻结）
2. ❌ 在 `db.export()` / `saveDb()` **之后**取 `last_insert_rowid()`（踩坑 #1）
3. ❌ 把 `dark` 类提到 `<html>`（会让历史失效规则突然生效，blast radius 不可控）
4. ❌ 去掉模态的 Portal 或作用域替身（KI-003，本轮重排祖先极易复发）
5. ❌ fork `src/` 产生第二份 UI 真源
6. ❌ 在 `src/` 内直调 Capacitor 原生插件（会让 10 个 UI 测试全部失效）
7. ❌ 用系统 JDK 24 构建安卓（AGP `Unsupported class file major version`）
8. ❌ 把 keystore 密码写进版本库
9. ❌ 把 Capacitor/Gradle 产物写进 `release/` / `exe/` / `app-out/`
10. ❌ 以「只出 Web 版」替代 APK 交付（属降级冒名）；亦禁止把 `capacitor.config` 的 `server.url` 指向远程页面来"产出"一个只是远程页壳的 APK
11. ❌ 在 `src/` 里 import `mobile/`（破坏解耦、污染桌面包）
12. ❌ **构建期**平台分支（改 renderer 入口/注入）—— 会覆盖 `app-out/renderer`，而它被打进桌面包
13. ❌ 用**合成 user** 绕过登录门（谎报身份 + 顶栏谎报已同步；见 RL-A8）
14. ❌ 把 `Buffer` 留在安卓可达路径（`database/index.ts:306`）
15. ❌ 在 `mobile/` 或安卓侧**零测试**就交付（红队认定的最大门禁漏洞）
16. ❌ 用 `file://` 加载页面（sql.js 的 `.wasm` 无法 fetch）—— 必须 `androidScheme: 'https'`

## 目录与依赖落点（消除歧义，自定并留痕）

| 路径 | 角色 | 是否进桌面包 |
|---|---|---|
| `mobile/` | **安卓前端接入层（源）**：唯一入口 `mobile/main.tsx`、适配器 `mobile/bridge/`、移动端 CSS 覆盖层 `mobile/android.css` | **否**（`src/` 不得 import 它） |
| `dist-android/` | 安卓 renderer 构建产物 = Capacitor `webDir` | 否 |
| `android/` | Capacitor 生成的原生 Gradle 工程（签名、图标、包名） | 否 |
| `release-android/` | APK 产物 | 否 |

- **Capacitor 依赖落点 = 根 `package.json` 的 `dependencies`**（已否决嵌套 `mobile/package.json`：会导致双份 `node_modules` → React 重复实例化 → hooks 报错）。RL-A7 已据此改写措辞
- **页面来源必须 `androidScheme: 'https'`（`https://localhost`）**，禁用 `file://`（sql.js 的 `.wasm` 靠 fetch）
- **后端共享策略**：`main-process/database/index.ts` 的 DB 逻辑抽为共享模块，**只换最后一跳**（`StoragePort`：`getDataDir/readDbFile/writeDbFile/exists/copyFile/mkdirp`）；`saveDb()` 内 `db.export()` 的位置与副作用**一字节不动**，且**保持同步签名 + 内部写队列**（`main.ts:72-79` 无 flush）

## 云同步「预留位」的真实判据（修正：原方案只冻结方法名 = 假预留）

红队与 Judge 共同认定：**方法名冻结 ≠ 迁移路径存在**。41 方法里**没有** `claimLocalData` 类入口，而 `main-process/database/index.ts:186-188` 在首次登录且 `migrateSharedData=false` 时**直接 `new SQL.Database()`** → 首版用户的本地数据会被**静默遗弃**。故「预留住」必须满足：

| # | 判据 | 可检验方式 |
|---|---|---|
| C1 | 适配器方法名集合 == `preload.ts` 的 41 个（不多不少） | 测试断言两侧集合相等 |
| C2 | 云方法返回**明确降级值或抛 `CloudUnavailableError`**，**绝无"假成功"** | 逐方法 await 断言 |
| C3 | 沿用桌面 `cloud_id` 生成规则（`bills.cloud_id`/`categories.cloud_id` + 唯一索引已存在，`database/index.ts:87/125/139/147`） | 源码契约断言同一生成函数 |
| C4 | **（2026-09-13 修订）** v1 必须使用**默认共享库名** `thunder-accounting.db`（**不得**自定为 `local` 等其它名字）；v2 首次登录必须走既有 `switchToUserDatabase(uid, migrateSharedData=**true**)` | 断言 v1 不传自定义库名 + 断言 v2 传 `true` + 断言迁移会**先备份原库**（`index.ts:186-198` 既有逻辑）。**修订理由**：原 C4 要求库名取 `local` 以便 v2 走 `switchToUserDatabase('local')`，属**新增特殊分支**；而用默认共享库名可**直接复用桌面已测试的迁移代码**（含 `.migrated` 备份），是零新机制路径。Android 无 admin 概念，共享库语义无副作用 |
| C5 | **远端读写抽为 `RemoteStore` port**（`@cloudbase/node-sdk` + 服务端 accessKey 实现**只留 Windows 构建**）—— 密钥不能进可反编译的 App，这是**安全边界**不是移植问题 | 断言安卓构建树不含 `@cloudbase/node-sdk` |
| C6 | 每个写方法内**预留 `trySync()` 调用点**（首版 no-op），与桌面 `main.ts:200-214` 的 IPC handler 一一对应 | 对应关系断言 |
| C7 | **首版本地数据认领路径必须被设计并落文档**（v2 首次登录时把 `local` 库迁移进用户库），v1 至少留出可接的钩子 | 设计文档 + 钩子存在性断言 |

> **诚实的返工点声明**：加云时以下三处必然要动 —— ① 远端读写由 node-sdk 换为「用户 access_token + 安全规则」的 HTTP 路径 ② WebView 的 `Origin: https://localhost` 会撞 CloudBase Auth 的 CORS/来源校验（故**首版就应决定**云请求走 Capacitor 原生 HTTP 插件）③ 会话恢复时序。已写入 `progress.state.open_unknowns`。

## 三方独立审查记录（本轮 PLAN 阶段真实编排产出）

| 角色 | 子代理 | 职责 | 结论 |
|---|---|---|---|
| **Worker（方案）** | `agent-4d7fad9d` | 独立产出安卓移植方案（不与主方案对照，避免锚定） | 推荐 Capacitor；提出 `mobile/` 独立入口 + CSS 覆盖层 + 只换末跳 StoragePort + 否决合成 user；给出 R1–R4 风险与 S1–S5 spike |
| **Reviewer（红队）** | `agent-ee67cb48` | 对抗攻击 `task_plan.md` | **conditional**；证伪出 4 项 P0/P1（`App.tsx:49-54` user 门禁、`Buffer`、`package.json` 措辞自相矛盾、安卓侧零测试）；纠正调用点计数 80 → **62** |
| **Judge（裁决）** | `agent-d9dfa538` | 裁决 A/B 分歧 + 双门槛打分 | **conditional**；裁决 = **机制甲 + 接上能力门**，**否决合成 user**；找到 A/B 都漏的 `Profile.tsx:426/706/1226` **云能力死线** |

**Judge 双分数（对原方案，已据此修正）**：`eval_score = 72`（取证扎实但 62 写成 80、P2-5 机制未定稿）／`quality_score = 68`（先证后建与 `saveDb()` 冻结正确，但云能力门缺失 + `package.json` 措辞不可满足）。
**`score_semantics`**：`n = 2`（A 方案 / B 红队）；`gap_note` = **门通过 ≠ 任务成功** —— 即使门禁方案正确，本地数据认领缺口、`Buffer` 兼容、无 flush、安卓侧零测试仍会导致交付失败。



## 人为终审点 —— **已通过（2026-09-13）**，进入 EXEC

### 用户答复回执（OQ-1，原话要点）

| # | 议题 | 用户答复 | 落点 |
|---|---|---|---|
| 1① | 底部导航形态 | 「暂时决定采纳**方案 B** 4 Tab + 中央凸起按钮」 | P2-1 |
| 1② | demo 的 UI bug | 「色块遮挡了…**最好的实现方式是将所在页面的底部菜单目录文字发光显示，且发光为金棕色**，符合雷霆记账 UI 风格」 | P2-1b；根因 = 通用 `button.on{background}` 误命中 `tab on`，**demo v2 已修** |
| 2 | 分类删除二次确认 | 「**肯定需要**，这是 UX，防止用户误删除」 | P2-3 / RL-A11 |
| 3 | 拖动与删除入口 | 「拖动和删除**只在编辑模式内可用**」 | P2-3 / RL-A12 |
| 4 | 其他 OQ | 「暂未看到其他需要讨论的 oq」 | 无新增 |

- 附带确认：打包交给 **`android-packager`** skill（安卓专用，对标 inno-packager）
- **交付纪律口径**（我自定并留痕，用户未反对）：仅 `mobile/`、`android/` 内改动不触发桌面版本 bump 与安装验收；触及共享 `src/` 或 `main-process/` 时，桌面仍按 SemVer 走完整链路

### 遗留待定（不阻塞 EXEC）
- **当前页发光强度四档待挑定**（关 / 弱 / 标准 / 强）—— demo 顶部可实时切换，默认「标准」

## 交付纪律（本轮新增口径，自定并留痕）

- **仅 `android/**` 内改动** → 不触发桌面版本 bump 与安装验收（不改桌面产物）
- **触及共享 `src/**` 或 `main-process/**`** → 桌面按 SemVer 判定 bump，走完整链路（clean build → electron-builder → ISCC → 静默安装 `exe/` → asar 校验 → commit/push）
- 理由：AGENTS.md 的意图是「桌面交付物完整性」，而非「任何目录的文件变动都发桌面版」

---

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
