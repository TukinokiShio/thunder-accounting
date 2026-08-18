# 项目交付规则

## 版本与安装包

- 每次完成代码、配置或云端行为更新后，按 Semantic Versioning 判定升级级别：兼容性修复用 PATCH，兼容新增功能用 MINOR，不兼容公开接口变更用 MAJOR。
- 同步更新 `package.json`、`package-lock.json` 与 `scripts/thunder-setup.iss` 的版本号。
- 完成测试后执行干净的 Windows 构建和 Inno Setup 打包；将生成的安装包与静默安装后的应用文件更新至 `E:\Code\CodeProduct\thunder-accounting\exe`。
- 交付前验证 `exe\resources\app.asar` 中的 `package.json` 版本与源代码一致。
