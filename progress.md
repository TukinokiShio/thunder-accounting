# Progress — 阶段进度跟踪

> 起始版本：v1.7.12
> 目标：v1.7.19 + Inno 打包

---

## Round 0 — 规划阶段

- [x] Phase 0 文件发现（关键文件全量读取）
- [x] Phase 0 API 文档研究（CloudBase SDK + Electron safeStorage）
- [x] 写 task_plan.md
- [x] 写 findings.md
- [ ] **用户确认计划**
- [ ] 写 progress.md（本文件）

---

## Round 1 — P1 API Key 环境变量化（v1.7.13）

**状态**：⏳ 待用户确认后开始

**计划动作**：
- [ ] 删除 cloudbase.ts:15 硬编码 API_KEY
- [ ] 添加 dotenv 加载 .env
- [ ] 创建 .env.example 模板
- [ ] .gitignore 添加 .env
- [ ] 更新 README.md
- [ ] TypeScript 编译验证
- [ ] 单元测试验证
- [ ] git commit: `chore(security): v1.7.13 - migrate Admin API Key to .env`

---

## Round 2 — P2 safeStorage 加密（v1.7.14）

**状态**：⏳ 待开始

**计划动作**：
- [ ] 新建 main-process/credential-store.ts
- [ ] 修改 cloudbase.ts saveCredentials/loadCredentials 为异步
- [ ] 兼容旧明文文件 + 清理
- [ ] main.ts IPC handlers async
- [ ] preload.ts 类型更新
- [ ] TypeScript 编译验证
- [ ] 单元测试验证
- [ ] git commit: `feat(security): v1.7.14 - encrypt credentials with Electron safeStorage`
- [ ] **🔄 auto-code-fixer 门禁**（验证安全基石，P0/P1=0 + test 通过 + Quality ≥ 75 方才进入 P3）

---

## Round 3 — P3 云函数加固（v1.7.15）

**状态**：⏳ 待开始

**计划动作**：
- [ ] 改造 index.js：email+verifyCode+newPassword 入参
- [ ] 内部 queryUserInfo 查 UID
- [ ] rate_limits 集合 + 每 IP 每分钟 3 次
- [ ] HTTPS timeout: 5000ms
- [ ] 密码强度校验
- [ ] package.json 添加 @cloudbase/node-sdk
- [ ] 手动测试部署
- [ ] git commit: `feat(security): v1.7.15 - harden resetUserPassword cloud function`

---

## Round 4 — P4 resetPassword 委托（v1.7.16）

**状态**：⏳ 待开始（依赖 P3）

**计划动作**：
- [ ] 修改 cloudbase.ts resetPassword：传 email+verifyCode 给云函数
- [ ] 删除硬编码 UID
- [ ] 更新 IPC handler 签名
- [ ] Login.tsx 忘记密码流程改造
- [ ] TypeScript 编译验证
- [ ] 单元测试验证
- [ ] git commit: `feat(security): v1.7.16 - delegate password reset to hardened cloud function`
- [ ] **🔄 auto-code-fixer 门禁**（验证 auth 全链路 + P1-P4 累积变更，确保无回归）

---

## Round 5 — P5 StrictMode 条件化（v1.7.17）

**状态**：⏳ 待开始

**计划动作**：
- [ ] main.tsx NODE_ENV 判断
- [ ] TypeScript 编译验证
- [ ] 单元测试验证
- [ ] git commit: `fix(perf): v1.7.17 - gate React.StrictMode behind NODE_ENV`

---

## Round 6 — P6 大文件拆分（v1.7.18）

**状态**：⏳ 待开始

**计划动作**：
- [ ] database.ts → database/index.ts + database/export.ts
- [ ] main.ts 更新 import
- [ ] SettingsDialog.tsx → SettingsDialog/{DataManagement,SyncSettings,About}.tsx
- [ ] CategoryManager.tsx → CategoryManager/{CategoryForm,CategoryList}.tsx
- [ ] TypeScript 编译验证
- [ ] 单元测试 130/130 通过（保证行为不变）
- [ ] git commit: `refactor: v1.7.18 - split database.ts / SettingsDialog / CategoryManager into modules`
- [ ] **🔄 auto-code-fixer 门禁**（最重要一次：验证大规模重构后行为不变、test 全绿）

---

## Round 7 — P7 页面组件测试（v1.7.19）

**状态**：⏳ 待开始（依赖 P6）

**计划动作**：
- [ ] Home.test.tsx
- [ ] Bills.test.tsx
- [ ] Stats.test.tsx
- [ ] Login.test.tsx
- [ ] SettingsDialog.test.tsx
- [ ] npm test 通过率 ≥ 95%
- [ ] git commit: `test: v1.7.19 - add component tests for Home/Bills/Stats/Login/SettingsDialog`

---

## Round 8 — P8 inno-packager 打包

**状态**：⏳ 待 P1-P7 完成后开始

**计划动作**：
- [ ] 加载 inno-packager skill
- [ ] electron-vite build
- [ ] ISCC.exe 编译 thunder-setup.iss → 雷霆记账_Inno_v1.7.19.exe
- [ ] 复制 win-unpacked
- [ ] 桌面/开始菜单快捷方式
- [ ] 验证启动

---

## 最终检查清单

- [ ] P1-P7 每个阶段独立 commit
- [ ] **3 次 auto-code-fixer 门禁全部通过**（P2 后 / P4 后 / P6 后）
- [ ] API Key 不在源码中
- [ ] 密码加密存储
- [ ] 云函数加固
- [ ] StrictMode 生产环境关闭
- [ ] 大文件已拆分
- [ ] 测试覆盖率提升
- [ ] Inno 安装包生成