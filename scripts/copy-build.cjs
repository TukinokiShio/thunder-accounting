const fs = require('fs');
const path = require('path');

const SRC = 'E:/Code/BlackHorse/VibeCoding/记账app/release/win-unpacked';
const DEST = 'E:/Code/BlackHorse/VibeCoding/记账app/雷霆记账app_exe/win-unpacked';

// Remove old dest
if (fs.existsSync(DEST)) {
  fs.rmSync(DEST, { recursive: true, force: true });
}

// Copy recursively
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

copyDir(SRC, DEST);
console.log('Copied to output directory');

// Create desktop shortcut
const os = require('os');
const { execSync } = require('child_process');
const exePath = path.join(DEST, '雷霆记账.exe');
const desktopDir = path.join(os.homedir(), 'Desktop');
const shortcutPath = path.join(desktopDir, '雷霆记账.lnk');

// Delete old shortcuts
try { fs.unlinkSync(shortcutPath); } catch (e) {}
try { fs.unlinkSync(path.join(desktopDir, 'Thunder Accounting.lnk')); } catch (e) {}

const psScript = `
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$Shortcut.TargetPath = '${exePath.replace(/'/g, "''")}'
$Shortcut.WorkingDirectory = '${DEST.replace(/'/g, "''")}'
$Shortcut.IconLocation = '${exePath.replace(/'/g, "''")},0'
$Shortcut.Save()
Write-Host 'OK'
`;

const tmpFile = path.join(os.tmpdir(), 'thunder-desk-shortcut.ps1');
fs.writeFileSync(tmpFile, '﻿' + psScript, 'utf-8');
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, { stdio: 'inherit' });
console.log('Desktop shortcut created: ' + shortcutPath);
