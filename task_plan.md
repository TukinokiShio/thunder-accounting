# 个人中心功能 — 实施计划

> 创建时间：2026-07-27 | 参考：shadcn-admin + Origin UI (MIT)

## DAG 拓扑

```
A(数据模型+账号补全) ─┐
                      ├─→ C(IPC) → D(页面) → E(导航) → F(迁移) → G(收尾)
B(CloudBase API)    ─┘
```

## 执行顺序

| # | 阶段 | 内容 | 等级 | 状态 |
|---|------|------|------|------|
| A | 数据模型扩展与账号补全 | 扩展 CloudBaseUser + store；注册/登录返回 accountId；补全旧用户 | ⭐⭐ | pending |
| B | CloudBase API | bindEmail/unbindEmail/deleteAccount/getUserStats；改造 bindPhone/unbindPhone 加验证码 | ⭐⭐⭐ | pending |
| C | IPC 通道 | 为 B 新增 API 添加 IPC + preload 类型 | ⭐⭐ | pending |
| D | 个人中心页面 | Profile.tsx：左侧标签导航+右侧内容区，5 个标签页 | ⭐⭐⭐ | pending |
| E | 导航集成 | Sidebar 添加入口；App.tsx 路由；用户区跳转 | ⭐⭐ | pending |
| F | 功能迁移 | 从 SettingsDialog 移除 AccountBinding 和账户管理 | ⭐ | pending |
| G | 翻译与收尾 | i18n 词条；Final Verification | ⭐ | pending |

## 验证方法

- **A**: 类型检查通过；旧用户登录后 store.user.accountId 有值
- **B**: 每个 API 端到端手动测试：发送验证码→验证→执行操作→验证结果
- **C**: preload.ts 类型编译通过；IPC 调用返回预期结果
- **D**: 页面渲染正常；5 个标签切换正常；所有交互功能正常
- **E**: 点击 Sidebar 和个人中心入口均能正确导航
- **F**: 设置弹窗无 AccountBinding/账户管理组件；功能均可通过个人中心访问
- **G**: 中英切换无遗漏；`npm run build` 通过；无 console.log/调试代码残留
