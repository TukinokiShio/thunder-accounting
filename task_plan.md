# Task Plan — 雷霆记账安全加固与代码质量优化

> 版本策略：v1.7.12 → v1.7.13 ... v1.7.19（每阶段独立 patch 升版 + 单独 git commit）
> 收尾：v1.7.19 后调用 inno-packager 打包

---

## 阶段概览（DAG + 版本 + Commit 策略）

| 阶段 | 版本 | 标题 | 类型 | 依赖 | 难度 |
|------|------|------|------|------|------|
| P1 | v1.7.13 | API Key 迁移至环境变量 | chore(security) | — | ⭐ |
| P2 | v1.7.14 | safeStorage 凭据加密 | feat(security) | — | ⭐⭐ |
| P3 | v1.7.15 | 云函数 `resetUserPassword` 加固 | feat(security) | — | ⭐⭐⭐ |
| P4 | v1.7.16 | 客户端 `resetPassword` 委托云函数 | feat(security) | P3 | ⭐⭐ |
| P5 | v1.7.17 | StrictMode 生产环境条件化 | fix(perf) | — | ⭐ |
| P6 | v1.7.18 | 大文件拆分（database / SettingsDialog / CategoryManager） | refactor | — | ⭐⭐⭐ |
| P7 | v1.7.19 | 页面组件测试覆盖 | test | P6 | ⭐⭐ |
| P8 | (无版本) | **inno-packager 打包 v1.7.19** | build | P1-P7 | ⭐⭐ |

---

## DAG 依赖图

```
   P1 (API Key env)          P2 (safeStorage)        P5 (StrictMode)
       │                          │                       │
       │                     [auto-fix 🔍]                 │
       │                          │                       │
       └──────────┐    ┌─────────┘                       │
                  ▼    ▼                                 │
              P3 (云函数加固) ──→ P4 (客户端委托) ──┐     │
                                             [auto-fix]   │
                                                  ▼       │
                                              P6 (大文件拆分)
                                             [auto-fix 🔍]
                                                  │       │
                                                  ▼       │
                                              P7 (测试覆盖)
                                                  │
                                                  ▼
                                        P8 (inno-packager 打包)
```

**执行顺序**（线性化）：
```
P1 → commit → P2 → auto-fix 🔍 → commit → P3 → P4 → auto-fix 🔍 → commit
    → P5 → P6 → auto-fix 🔍 → commit → P7 → commit → P8
```

**关键路径**：P3 → P4 → P6 → P7 → P8（最长）
**3 次 auto-code-fixer 门禁**：分别在 P2（安全基石）、P4（全链路 auth）、P6（大重构）之后

---

## P1 — v1.7.13: API Key 迁移至环境变量

**问题**：cloudbase.ts:15 Admin API Key 明文硬编码，随 EXE 分发

**修改**：
- 删除 cloudbase.ts 第 15 行硬编码的 API_KEY
- 新增 `import dotenv` 加载 `.env`（首次启动；如不存在则警告并降级为无 Admin 功能）
- 新增 `.env.example` 模板（含 API_KEY、CLOUD_BASE_ENV_ID 占位）
- 新增 `.env` 到 `.gitignore`
- 更新 README.md 说明环境变量配置
- 更新 CLAUDE.md

**Commit**：`chore(security): v1.7.13 - migrate Admin API Key to .env`

**验证**：
- TypeScript 编译通过
- 单元测试通过（130/130）
- 手动：复制 `.env.example` 为 `.env`，填入真实 key，启动应用，云同步功能正常

---

## P2 — v1.7.14: safeStorage 凭据加密

**问题**：cloudbase.ts:97 用户密码以明文 JSON 写入磁盘 `remembered-auth.json`

**修改**：
- 新增 `main-process/credential-store.ts`，封装 safeStorage 加密/解密
- 修改 cloudbase.ts:88-110 的 `saveCredentials`/`loadCredentials`：
  - 异步 API：`safeStorage.encryptStringAsync` / `decryptStringAsync`
  - 处理 `shouldReEncrypt` 标志（密钥轮换）
  - 写入新文件 `remembered-auth.enc`（旧文件兼容读取并删除）
  - Linux `basic_text` 后端降级：警告并强制使用 Electron 自带加密（不写入磁盘）
- 修改 main.ts:289-295 IPC handlers 改为 async
- 修改 preload.ts:113-117 类型为 Promise<...>

**Commit**：`feat(security): v1.7.14 - encrypt credentials with Electron safeStorage`

**🔄 阶段后门禁**：运行 `@auto-code-fixer`（并行 subagent：Code Review + Unit Test + Quality Test）
→ 须满足 P0/P1=0、测试通过、Quality ≥ 75 方才进入 P3

**验证**：
- TypeScript 编译通过
- 单元测试通过
- 手动：登录后记住密码 → 重启 → 自动填充可用；删除旧 `remembered-auth.json` 不影响

---

## P3 — v1.7.15: 云函数 `resetUserPassword` 加固

**问题**：cloudfunctions/resetUserPassword/ 缺认证/授权/限频/超时

**修改**：
- index.js 新增接收 `{ email, newPassword, verificationCode }`（不再接收 uid）
- 内部用 `@cloudbase/node-sdk`（自动注入管理员凭据）调用 `auth.queryUserInfo({ platform: 'EMAIL', platformId: email })` 查 UID
- 速率限制：使用 CloudBase 数据库 `rate_limits` 集合，每 IP 每分钟最多 3 次
- HTTPS 请求：增加 `timeout: 5000` + `req.setTimeout()` 主动销毁
- 密码强度校验：≥6 字符，禁止纯数字
- 完整错误处理：try-catch 包裹每个外部调用
- 更新 package.json 添加依赖：`@cloudbase/node-sdk`

**Commit**：`feat(security): v1.7.15 - harden resetUserPassword cloud function`

**验证**：
- 部署云函数后手动调用：未传 email/参数错误 → 400；同 IP 第 4 次 → 429；正常调用 → 200
- 修改了 CloudBase 数据库 schema（新增 rate_limits 集合）

---

## P4 — v1.7.16: 客户端 `resetPassword` 委托云函数

**问题**：cloudbase.ts:243 硬编码单个用户 UID

**修改**：
- 修改 cloudbase.ts:237-254 的 `resetPassword(email, newPassword, verificationCode)`：
  - 删除硬编码 UID
  - 调用加固后的云函数（POST email + newPassword + verificationCode）
  - 不再调用本地 authFetch 发送验证码（云函数内部完成）
- 修改 main.ts IPC handler 签名
- 修改 Login.tsx 忘记密码流程：传入 verificationCode
- 验证流程：忘记密码 → 输入邮箱 → 收验证码 → 输入验证码 + 新密码 → 重置成功

**Commit**：`feat(security): v1.7.16 - delegate password reset to hardened cloud function`

**🔄 阶段后门禁**：运行 `@auto-code-fixer`（验证 auth 全链路 + P1-P4 累积变更无回归）

**验证**：
- TypeScript 编译通过
- 单元测试通过
- 手动：忘记密码流程跑通

---

## P5 — v1.7.17: StrictMode 生产环境条件化

**问题**：src/main.tsx:23 生产构建保留 `<React.StrictMode>` 导致 Effect 双重调用

**修改**：
- main.tsx 第 22-26 行改为：
  ```tsx
  const Strict = process.env.NODE_ENV === 'development' ? React.StrictMode : React.Fragment
  r.render(<Strict><App /></Strict>)
  ```

**Commit**：`fix(perf): v1.7.17 - gate React.StrictMode behind NODE_ENV`

**验证**：
- TypeScript 编译通过
- 单元测试通过
- 手动：开发模式 `npm run dev` 仍启用 StrictMode；`npm run build` 后 StrictMode 关闭

---

## P6 — v1.7.18: 大文件拆分

**问题**：database.ts (647 行) / SettingsDialog.tsx (439 行) / CategoryManager.tsx (453 行) 过大

**修改**：
- **database.ts 拆分**：
  - 新建 `main-process/database/index.ts` 保留核心 CRUD
  - 新建 `main-process/database/export.ts` 包含 `escapeCSV`、`exportCSV`、`exportAllJSON`、`importAllJSON`、`rowsToObjects`
  - main.ts 修改 import 路径
- **SettingsDialog.tsx 拆分**：
  - 拆出 `SettingsDialog/DataManagement.tsx`（备份/恢复/清空）
  - 拆出 `SettingsDialog/SyncSettings.tsx`（云同步状态）
  - 拆出 `SettingsDialog/About.tsx`（关于/版本）
- **CategoryManager.tsx 拆分**：
  - 拆出 `CategoryManager/CategoryForm.tsx`（新增/编辑表单）
  - 拆出 `CategoryManager/CategoryList.tsx`（分类列表项）

**Commit**：`refactor: v1.7.18 - split database.ts / SettingsDialog / CategoryManager into modules`

**🔄 阶段后门禁**：运行 `@auto-code-fixer`（**最重要一次**：验证大规模重构后行为不变、测试全绿）

**验证**：
- TypeScript 编译通过
- 单元测试 130/130 全部通过（保证拆分前后行为一致）
- 手动：所有功能正常

---

## P7 — v1.7.19: 页面组件测试覆盖

**目标**：补充 Home / Bills / Stats / Login / SettingsDialog 页面组件测试

**修改**：
- 新建 `src/pages/Home.test.tsx`
- 新建 `src/pages/Bills.test.tsx`
- 新建 `src/pages/Stats.test.tsx`
- 新建 `src/pages/Login.test.tsx`
- 新建 `src/components/SettingsDialog.test.tsx`
- 沿用 `src/test-setup.ts` + jsdom + @testing-library/react

**Commit**：`test: v1.7.19 - add component tests for Home/Bills/Stats/Login/SettingsDialog`

**验证**：
- `npm test` 通过率 ≥ 95%
- 测试覆盖：渲染、空状态、关键交互、错误状态

---

## P8 — inno-packager 打包 v1.7.19

**目标**：使用 inno-packager skill 打包 Windows 安装包

**步骤**：
1. 加载 inno-packager skill
2. 执行 `electron-vite build` → `release/win-unpacked/`
3. 用 ISCC.exe 编译 `scripts/thunder-setup.iss` → `雷霆记账_Inno_v1.7.19.exe`
4. 复制 win-unpacked 到 `release/`
5. 更新桌面/开始菜单快捷方式
6. 验证产物可正常启动

**Commit**（如有元数据改动）：`build: v1.7.19 - packaged with Inno Setup`

---

## 退出条件

满足以下全部条件时进入 P8：
- ✅ P1-P7 全部完成，每个阶段独立 commit
- ✅ 3 次 auto-code-fixer 门禁全部通过（P2/P4/P6 之后）
- ✅ 单元测试 ≥ 95% 通过
- ✅ TypeScript 零错误
- ✅ 安全审计：API Key 不在源码中、密码加密存储、云函数加固

---

## 工具使用计划

| 工具/Skill | 阶段 | 用途 |
|-----------|------|------|
| `strict-coding-workflow`（本流程） | 全流程 | 流程约束 |
| `auto-code-fixer` 🔍 | P2 后 / P4 后 / P6 后 | **3 道质量门禁**（并行 Code Review + Unit Test + Quality Test） |
| `inno-packager` | P8 | Inno Setup 打包 |
| Subagent: general-purpose | P3 文档研究 | CloudBase SDK 文档 |