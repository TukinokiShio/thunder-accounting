# 安卓端验收清单（两阶段）

> 版本：安卓 `1.0.0`（`versionCode 1`）· 桌面 `1.17.7`
> 说明：**阶段 A 在这台机器上跑**（模拟器）；**阶段 B 在手机上跑**（最终验收）。
> 本文是 OQ-3 的交付物：执行者已完成「尽最大努力交付」，剩下两步由你执行。

---

## 0. APK 在哪、怎么装到手机（最直接的路径）

**APK 位置**（仓库根目录下）：

```
E:\Code\CodeProduct\thunder-accounting\release-android\thunder-accounting-debug.apk          ← 先装这个（5.0 MB）
E:\Code\CodeProduct\thunder-accounting\release-android\thunder-accounting-release-signed.apk ← 内测侧载用（3.7 MB，自签名）
```

装到手机的**两种方式**（任选）：

**方式一：拷过去装（不用数据线）**
1. 把 `thunder-accounting-debug.apk` 传到手机（微信「文件传输助手」/ U 盘 / 网盘都行）
2. 手机上点它安装；若提示被拦截，去「设置 → 应用 → 特殊应用权限 → 安装未知应用」里允许来源
3. 装完在桌面找「雷霆记账」图标，点开即可

**方式二：连线用 adb 装**
```cmd
cd /d E:\Code\CodeProduct\thunder-accounting
E:\Code\Android\sdk\platform-tools\adb.exe devices
E:\Code\Android\sdk\platform-tools\adb.exe install -r -t release-android\thunder-accounting-debug.apk
```
（手机需先开「开发者选项 → USB 调试」并在弹窗里点允许；若报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`，先 `adb uninstall com.thunder.accounting`）

---

## 阶段 A —— 本机安卓环境（Pixel_8 模拟器）

### 运行方式（**在 cmd 里就能跑，不需要 bash**）

```cmd
cd /d E:\Code\CodeProduct\thunder-accounting
npm run android:accept
```

需要「全新首启」语义时（⚠️ **会删除该应用的全部本地账本数据**）：

```cmd
npm run android:accept -- --pm-clear
```

> **踩过的坑（2026-09-14，用户在 cmd 里踩到）**
> - ❌ `bash scripts/android-acceptance.sh` —— **cmd 里的 `bash` 指向 WSL**，本机没装 WSL 分发，必然报「适用于 Linux 的 Windows 子系统没有已安装的分发」。**不要用 bash**。
> - ❌ 在 `C:\Users\<你>` 下跑 `npm run` —— 会报 `ENOENT ... C:\Users\d8502\package.json`。**必须先 `cd /d` 到项目根**。
> - ❌ 把文档里的 `# 注释行` 一起粘进 cmd —— cmd 会把 `#` 当成命令。**只粘命令行本身**。
> - ✅ 脚本已改写为 **Node**（`scripts/android-acceptance.cjs`），所以 **cmd / PowerShell / Git Bash 三处都能直接跑**；`.sh` 版本已删除（只保留一份实现，避免漂移）。
> - `--pm-clear` 这种参数要写在 `--` 之后：`npm run android:accept -- --pm-clear`

脚本会自动完成：出包 → 装模拟器 → 冷启动 → 滚动截图 → 杀进程重启 → 拉回设备上的 `.db` 校验 → 收尾关模拟器。产物落在 `release-android/acc-<时间戳>/`（内含 `run.log` 与三张截图）。

### 通过判据（逐条对照）

| # | 判据 | 看哪里 |
|---|---|---|
| 1 | 崩溃日志为空 | `run.log` 的「崩溃日志」段（应为空） |
| 2 | 前台 Activity 命中 + 进程存活 | `run.log` 的 topResumedActivity / ps 段 |
| 3 | **wasm 真被请求**（最脆一环） | `run.log` 出现 `Handling local request: https://localhost/sql-wasm-browser.wasm` |
| 4 | 二次启动**出现 `readFile`** | `run.log` 的「应出现 readFile」段应有 `readFile` 计数 ≥1（首启无、重启后有 ⇒ 旧库被读回） |
| 5 | 拉回的库合法 | `integrity_check: ok`、4 个索引在、**预设分类 `expense 11 / income 6`** |
| 6 | 顶栏不被状态栏压住 | `02-scrolled.png`：状态栏（时钟/信号/电量）独占一行，标题与「记一笔」在其下方 |
| 7 | 版本正确 | `versionName=1.0.0` |

### 已知的模拟器特有现象（**不是缺陷**，别误判）

| 现象 | 说明 |
|---|---|
| 冷启动约 **12 秒白屏** | swiftshader 软渲染；脚本固定等 32s 再判读。**判「白屏」必须等 ≥20s** |
| SystemUI 偶发 ANR 对话框 | 会挡住截图 → 需要时补拍干净截图 |
| `stat -c '%y'` 不支持 | 该模拟器 toybox 缺项 → 用 md5 + size 比对 |
| 启动期 2~4 条 `Error injecting safe area CSS` | Capacitor 上游 `SystemBars` 在 `documentElement` 为 null 时报的，**对结果无影响** |
| 模拟器后台任务约 13 分钟被回收 | 所以脚本写成「一条长命令内自带 emulator 生命周期」 |

---

## 阶段 B —— 手机端最终验收

### 准备

1. 手机开「开发者选项 → USB 调试」，用数据线连电脑
2. 手机上点「允许 USB 调试」
3. 确认识别：

```bash
export ANDROID_HOME="E:/Code/Android/sdk"
export PATH="$ANDROID_HOME/platform-tools:$PATH"
adb devices          # 应列出你的设备序列号 + device
```

> 若显示 `unauthorized`：在手机上重新点允许。若列表为空：换线/换口，或确认驱动。

### 安装 debug 包

```bash
adb install -r -t release-android/thunder-accounting-debug.apk
# 若报 INSTALL_FAILED_UPDATE_INCOMPATIBLE：先 adb uninstall com.thunder.accounting
```

### 逐项测试（请照此顺序，并把结论填进下表）

| # | 要测什么 | 怎么做 | 该看到什么 |
|---|---|---|---|
| B1 | **冷启动不白屏** | 点图标启动 | 直接进首页（卡片 + 底部 4 Tab），**看不到登录页** |
| B2 | **顶部不被状态栏压住** | 看首页顶部 | 标题与「记一笔」完整落在状态栏下方；**下滑页面后再看一次** |
| B3 | **底部不被手势条压住** | 看底部 | 4 Tab 与中央圆钮在系统手势条之上 |
| B4 | **记一笔** | 点中央圆钮 → 填金额 → 选一二级分类 → 保存 | 提示成功；首页数字变化 |
| B5 | **杀进程后数据还在** | 最近任务里划掉应用 → 重新打开 | 刚才那笔还在，数字与 B4 一致 |
| B6 | **统计** | 切到「统计」 | 环形图/柱状图正常，数字与账单一致；**动画不卡顿** |
| B7 | **分类管理（编辑模式）** | 我的 → 分类管理 → 点「编辑」 | 每行左侧出现拖动把手、右侧出现**红色**删除图标；**普通模式没有这两个入口** |
| B8 | **拖动排序** | 在编辑模式里**按住左侧把手**上下拖 | 行能跟随移动，松手后顺序保存；退出重进顺序仍在 |
| B9 | **删除二次确认** | 点某行右侧红色图标 | 弹确认框，写明子分类数量 + 「已用该分类的账单不会被删、只会变成未分类」；点取消不留痕 |
| B10 | **导出 CSV / 备份** | 统计 → 导出 CSV（或 我的 → 备份） | 弹出**系统分享面板**（可存文件/发微信），文件名正确；取消也不报错 |
| B11 | **导出内容正确** | 分享面板选「保存到文件」后用文本/表格打开 | 首行是表头，之后是逐笔明细，金额与日期对得上 |
| B12 | **导入备份** | 我的 → 恢复（选一个之前导出的备份文件） | 能选文件、能恢复；**取消选择不报错** |
| B13 | **切后台再回来** | 按 Home 键 → 等几秒 → 回应用 | 界面状态还在，无重启 |
| B14 | **强制停止后数据完整** | 系统设置里强制停止 → 再打开 | 数据与停止前一致（这条验落盘） |
| B15 | **断网可用** | 飞行模式下重复 B4/B5 | 完全可用（首版无云依赖） |
| B16 | **退出后无账号痕迹** | 「我的」页 | **不出现**登录/注册/账号绑定/云同步任何入口 |

### 回填表（这一节是 SACW 的「验收三证」之一，需由你填）

| 项 | 结论 | 备注 / 截图 |
|---|---|---|
| 设备型号 / Android 版本 | | |
| B1 | | |
| B2 | | |
| B3 | | |
| B4 | | |
| B5 | | |
| B6 | | |
| B7 | | |
| B8 | | |
| B9 | | |
| B10 | | |
| B11 | | |
| B12 | | |
| B13 | | |
| B14 | | |
| B15 | | |
| B16 | | |
| 总体是否通过 | | |
| 验收人 / 日期 | | |

### 出问题时怎么取证据

```bash
adb logcat -b crash -d > crash.txt                 # 崩溃
adb logcat -d | grep -iE "wasm|readFile|启动失败|Permission denied" > key.txt
adb shell dumpsys package com.thunder.accounting | grep versionName
adb exec-out run-as com.thunder.accounting cat \
  /data/data/com.thunder.accounting/files/thunder-accounting/thunder-accounting.db > pulled.db
```
（最后一条把设备上的账本拉到本地，可用 sqlite3/DB 工具直接打开核对；`exec-out` 是二进制安全的，**不要**用 `adb shell ... cp` 到 `/sdcard`，会被拒。）

若看到红字**「启动失败」**：这是**有意的 fail-loud**（宁可不启动也不覆写你的数据）。请把该截图 + `adb logcat` 发我，并**先不要点重试以外的操作**。

---

## 尚未被任何验收覆盖的项（诚实清单）

以下**只在模拟器上验过**或**完全未验**，手机端测试正好覆盖：

- 真实 GPU 渲染下的安全区让位（模拟器是软渲染）
- `appStateChange` 切后台时的 flush 时机（模拟器只能粗测）
- `Share` 面板在不同厂商 ROM 的可用性（FileProvider 兼容）
- 冷启动耗时（模拟器的 12s 不代表真机）
- `@capacitor/filesystem` 在真机上的错误文案是否与我们的匹配规则一致（**首次启动若被误判会 fail-loud，属有意设计，不是数据风险**）
- 低端机内存（三份 9.27MB 数据叠加的 OOM 风险）
