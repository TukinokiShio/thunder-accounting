# Phase 0 发现记录

> 2026-07-27 | 个人中心功能

## 现有架构

### 认证系统
- 完全依赖腾讯云 CloudBase Auth
- 登录/注册通过 REST API 调用 `/auth/v1/signin`, `/auth/v1/signup`
- Session 存 JSON 文件，支持 refresh token 续期
- 每次启动强制重新登录（App.tsx 第 26 行）

### 数据存储
- **本地 SQLite**: `thunder-accounting-{uid}.db`（按用户分文件），含 bills、categories 表
- **CloudBase NoSQL**: `accounts` 集合（accountId, uid, email, phone, createdAt）
- 双层存储：账单/分类本地为主，云端备份同步

### 现有账户管理（分散在多个组件）
- `SettingsDialog/AccountBinding.tsx`: accountId 显示、手机号绑定/解绑
- `SettingsDialog/SyncStatus.tsx`: 邮箱显示、修改密码、退出登录
- `Sidebar.tsx`: 用户头像（首字母）+ 邮箱 + 退出按钮

### 关键发现
1. **CloudBaseUser 类型缺少 accountId** — 前端无法展示 TB 账号
2. **手机号绑定无验证码** — bindPhone 直接修改 CloudBase 记录
3. **无邮箱绑定功能** — 邮箱是注册时的主标识符
4. **无账号注销功能** — 缺少 deleteAccount API
5. **无 accountId 补全逻辑** — 早期用户可能没有 TB 账号

## 参考实现

| 来源 | License | 借鉴点 |
|------|---------|--------|
| shadcn-admin | MIT | Settings 模块布局、Profile 表单、Password 页 |
| Origin UI | MIT | Danger Zone（红边警示+类型确认）、Settings Profile 组件 |

## 技术决策

1. 个人中心作为独立页面（profile 路由），非弹窗
2. 布局：左侧标签导航 + 右侧内容区
3. 绑定/解绑均需验证码确认
4. 注销账号使用 Danger Zone 模式：验证码 + 输入 accountId 二次确认
5. accountId 生成规则不变：TB + 6 位随机字符（排除 I/O/0/1）
