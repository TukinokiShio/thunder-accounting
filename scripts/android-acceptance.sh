#!/usr/bin/env bash
# 雷霆记账 安卓端 —— 本机安卓环境（模拟器）自动验收
#
# 用途：阶段 A 验收。一条命令完成「出包 → 装模拟器 → 冷启动 → 重启读回 → 拉回 .db 校验」，
#       产出截图与日志供判读。手机端（阶段 B）见 docs/android-acceptance.md。
#
# ⚠️ 必须在**非沙箱**环境执行：Gradle 依赖解析与模拟器都不能在沙箱内跑。
# ⚠️ 未加 --pm-clear 时**不动设备数据**；加了会清空 com.thunder.accounting 的本地数据。
#
# 用法：
#   bash scripts/android-acceptance.sh                 # 保留设备数据
#   bash scripts/android-acceptance.sh --pm-clear      # 清数据（等价全新首启，会删本地账本）
#   OUT=release-android/acc5 bash scripts/android-acceptance.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/release-android/acc-$(date +%H%M%S)}"
mkdir -p "$OUT"
LOG="$OUT/run.log"
: > "$LOG"

PM_CLEAR=0
[ "${1:-}" = "--pm-clear" ] && PM_CLEAR=1

export ANDROID_HOME="${ANDROID_HOME:-E:/Code/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export JAVA_HOME="${JAVA_HOME:-E:/Code/Android Studio/AS/jbr}"   # JBR 21；禁用系统 JDK 24
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
ADB="$ANDROID_HOME/platform-tools/adb.exe"
PKG=com.thunder.accounting
AVD="${AVD:-Pixel_8}"

N="C:/Users/d8502/.workbuddy/binaries/node/versions/22.12.0/node.exe"
NPM="C:/Users/d8502/.workbuddy/binaries/node/versions/22.12.0/node_modules/npm/bin/npm-cli.js"
PY="C:/Users/d8502/.workbuddy/binaries/python/versions/3.13.12/python.exe"

log() { echo "$@" | tee -a "$LOG"; }
step() { log ""; log "===== $* ====="; }

step "0 环境"
log "JAVA_HOME=$JAVA_HOME"; "$JAVA_HOME/bin/java.exe" -version 2>&1 | head -1 | tee -a "$LOG"
log "OUT=$OUT"; log "PM_CLEAR=$PM_CLEAR"
if [ $PM_CLEAR -eq 1 ]; then
  log "⚠️ 即将执行 pm clear：会删除 $PKG 的**全部本地账本数据**（含已录入账单）。"
  log "   若设备上有你想保留的数据，请立刻 Ctrl-C 并改用不带 --pm-clear 的方式。"
fi

cd "$ROOT" || exit 1

step "1 构建安卓 web 产物 + APK"
"$N" "$NPM" run build:android >> "$LOG" 2>&1; log "BUILD_ANDROID_EXIT=$?"
log "--- wasm 必须在 webDir 根 ---"; ls -la "$ROOT/dist-android"/*.wasm 2>&1 | tee -a "$LOG"
(cd "$ROOT/android" && sh ./gradlew assembleDebug --console=plain >> "$LOG" 2>&1); log "ASSEMBLE_EXIT=$?"
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
log "APK: $APK"
"$ANDROID_HOME/build-tools/36.0.0/aapt2.exe" dump badging "$APK" 2>/dev/null | grep -E "^package|^application-label:" | tee -a "$LOG"

step "2 启动模拟器（整条链同一条命令，变量不跨调用）"
"$ANDROID_HOME/emulator/emulator.exe" -avd "$AVD" -no-snapshot -no-boot-anim -no-audio \
  -no-window -gpu swiftshader_indirect > "$OUT/emu.log" 2>&1 &
timeout 300 "$ADB" wait-for-device >> "$LOG" 2>&1; log "WAIT_FOR_DEVICE_EXIT=$?"
for i in $(seq 1 75); do
  b=$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
  [ "$b" = "1" ] && { log "boot_completed=1 @probe#$i"; break; }
  sleep 4
done

step "3 安装"
# 注意：adb.exe 是 Windows 程序，路径必须给 E:/... 形式（`/e/...` 会导致静默安装失败）
timeout 240 "$ADB" install -r -t "$APK" 2>&1 | tail -2 | tee -a "$LOG"
if [ $PM_CLEAR -eq 1 ]; then log "--- pm clear（已在步骤 0 声明）---"; "$ADB" shell pm clear "$PKG" 2>&1 | tee -a "$LOG"; fi

step "4 首次启动"
"$ADB" logcat -c
"$ADB" shell am start -n "$PKG/.MainActivity" 2>&1 | tee -a "$LOG"
# ⚠️ 冷启动在 swiftshader 下需 20~40s；等待 <20s 会把「慢」误判为「白屏」
log "等待 32s（冷启动在模拟器上很慢，这是已知现象）…"
sleep 32
log "--- 前台 Activity ---"; "$ADB" shell dumpsys activity activities 2>/dev/null | grep -m1 topResumedActivity | tee -a "$LOG"
log "--- 进程 ---";         "$ADB" shell ps -A 2>/dev/null | grep -i "$PKG" | tee -a "$LOG"
log "--- 崩溃日志（应为空）---"; "$ADB" logcat -b crash -d 2>/dev/null | tail -15 | tee -a "$LOG"
log "--- wasm 是否真被请求（最脆一环）---"
"$ADB" logcat -d 2>/dev/null | grep -oE "Handling local request: https://localhost/[^ ]*" | sort -u | tee -a "$LOG"
log "--- Filesystem 调用统计 ---"
"$ADB" logcat -d 2>/dev/null | grep -oE 'methodName: [A-Za-z]+' | sort | uniq -c | tee -a "$LOG"
"$ADB" shell screencap -p /sdcard/a1.png && "$ADB" pull /sdcard/a1.png "$OUT/01-home.png" 2>&1 | tail -1

step "5 滚动后 sticky 顶栏（安全区）"
"$ADB" shell input swipe 540 1600 540 900 300; sleep 2
"$ADB" shell screencap -p /sdcard/a2.png && "$ADB" pull /sdcard/a2.png "$OUT/02-scrolled.png" 2>&1 | tail -1

step "6 杀进程 → 重启读回（持久化闭环）"
"$ADB" shell am force-stop "$PKG"; sleep 2
"$ADB" logcat -c
"$ADB" shell am start -n "$PKG/.MainActivity" 2>&1 | tee -a "$LOG"
sleep 25
log "--- 应出现 readFile（证明旧库被读回）---"
"$ADB" logcat -d 2>/dev/null | grep -oE 'methodName: (readFile|readdir|writeFile|deleteFile)' | sort | uniq -c | tee -a "$LOG"
"$ADB" shell screencap -p /sdcard/a3.png && "$ADB" pull /sdcard/a3.png "$OUT/03-restart.png" 2>&1 | tail -1

step "7 拉回设备上的 .db 并校验（二进制安全）"
DBA="$("$ADB" shell run-as "$PKG" find /data/data/$PKG -name '*.db' 2>/dev/null | tr -d '\r' | head -1)"
log "设备路径: ${DBA:-（未找到）}"
if [ -n "$DBA" ]; then
  log "size=$("$ADB" shell run-as "$PKG" stat -c %s "$DBA" 2>/dev/null | tr -d '\r')"
  "$ADB" exec-out run-as "$PKG" cat "$DBA" > "$OUT/pulled.db" 2>/dev/null
  log "本地拉回: $(stat -c %s "$OUT/pulled.db" 2>/dev/null) bytes"
  "$PY" - "$OUT/pulled.db" <<'PYEOF' 2>&1 | tee -a "$LOG"
import sqlite3, sys, hashlib
p = sys.argv[1]
d = open(p, "rb").read()
print("  头部:", d[:16], "| 合法 SQLite:", d[:15] == b"SQLite format 3")
con = sqlite3.connect(p); cur = con.cursor()
print("  表:", [(n,) for (n,) in cur.execute("select name from sqlite_master where type='table' order by name")])
print("  索引:", [n for (n,) in cur.execute("select name from sqlite_master where type='index' and name not like 'sqlite_%' order by name")])
print("  预设分类:", cur.execute("select type, count(*) from categories group by type").fetchall())
print("  账单数:", cur.execute("select count(*) from bills").fetchone()[0])
print("  integrity_check:", cur.execute("pragma integrity_check").fetchone()[0])
con.close()
PYEOF
fi

step "8 收尾"
"$ADB" shell dumpsys package "$PKG" 2>/dev/null | grep -m1 versionName | tee -a "$LOG"
"$ADB" emu kill 2>&1 | tee -a "$LOG"
log ""
log "证据目录: $OUT"
log "通过判据：crash 空 · wasm 请求命中 · 二次启动出现 readFile · 拉回的库 integrity_check=ok"
log "         · 02-scrolled.png 顶栏完整落在状态栏下方 · 17 个预设分类在库"
