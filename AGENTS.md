# 项目交付规则

## 版本与安装包

- 每次完成代码、配置或云端行为更新后，按 Semantic Versioning 判定升级级别：兼容性修复用 PATCH，兼容新增功能用 MINOR，不兼容公开接口变更用 MAJOR。
- 同步更新 `package.json`、`package-lock.json` 与 `scripts/thunder-setup.iss` 的版本号。
- 完成测试后执行干净的 Windows 构建和 Inno Setup 打包；将生成的安装包与静默安装后的应用文件更新至 `E:\Code\CodeProduct\thunder-accounting\exe`。
- 交付前验证 `exe\resources\app.asar` 中的 `package.json` 版本与源代码一致。

## 发布后 Git 与工作区纪律

- 每次完成代码、配置或云端行为更新并完成打包验证后，必须直接执行 `git commit` 和 `git push`；提交前检查提交范围，禁止把密钥、用户数据、缓存或临时构建目录纳入提交。
- 每次更新后必须整理工作区：优先清理可重建的构建缓存、旧安装包、旧解压目录、临时截图和过期验证产物。删除或覆盖可能包含用户数据、历史证据、未提交工作或唯一回滚包的内容前，必须先向用户说明具体路径、风险和替代方案并获得确认。
- 作废版本的安装包不作为交付物；若删除作废包可能影响回滚或审计，先保留并在汇报中列明，待用户确认后再清理。
