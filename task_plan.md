# SACW Task Plan — Thunder Accounting restart to v1.15.0

## 执行形态：多 Agent 编排

本轮按 SACW 的可审计编排格式重启；由于当前 Codex 会话未暴露可用的
`multi_agent_v1` 派生工具，执行降级为主执行者 + 外部规则门禁。降级范围仅限
审查、修复和验证，不把主执行者的工作冒充为子代理回执；真实用户验收仍保持阻塞。

## 版本与基线决策

- 回滚基线：用户已安装并验证的雷霆记账 `v1.14.14`。
- 作废版本：`v1.14.15`、`v1.14.16`，不作为交付版本或验收依据。
- 下一交付版本：`v1.15.0`。
- 需求台账：`PRD.md`。
- 遗留问题来源：`E:/Code/shio-al-ecosystem/artifacts/sae-v16-2026-08-20/thunder-accounting-legacy-report.md`。

## 执行阶段

1. 重置旧 SAE/SACW 状态并建立版本决策、需求和证据台账。
2. 审查 Aurora 合同、主题语义、组件状态和报告中的蓝色泄漏问题。
3. 修复确认存在的问题，保留与 `v1.14.14` 基线无关的用户工作区改动。
4. 执行单元测试、类型检查、Aurora lint、构建和 Windows 安装包校验。
5. 更新 `exe` 交付产物到 `v1.15.0`；不自动启动安装程序，避免覆盖用户已安装的基线。
6. 将真实 GUI 截图和用户验收作为最终收口门，不用 headless 结果替代。

## 收口标准

- `package.json`、`package-lock.json`、`scripts/thunder-setup.iss` 和 `app.asar` 均为 `1.15.0`。
- 主题源码无旧 blue/primary 语义泄漏；图表和状态组件直接消费项目 token。
- 测试、构建和打包结果有可复核命令与外部事实引用。
- 未生成或弹出 `1.14.15`/`1.14.16` 安装包作为交付物。
- 缺少真实 GUI 截图或用户验收时，状态不得进入 `DONE`。
