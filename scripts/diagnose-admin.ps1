# Deep check: why 雷霆记账 needs admin
$desktop = [Environment]::GetFolderPath('Desktop') + '\雷霆记账.lnk'
$exe = 'E:\Code\BlackHorse\VibeCoding\记账app\雷霆记账app_exe\win-unpacked\雷霆记账.exe'

Write-Host "========== 1. Shortcut .lnk analysis =========="
$lnkBytes = [System.IO.File]::ReadAllBytes($desktop)
Write-Host "File size: $($lnkBytes.Length) bytes"

# ShellLinkHeader: offset 0x14 = DataFlags byte
# Bit 6 (0x20) = HasDarwinID
# Bit 5 (0x10) = HasLinkInfo
# Bit 4 (0x08) = ForceNoLinkInfo
# The RunAsAdmin flag for shortcuts is NOT in the .lnk header - it's stored in
# the "special folder" settings or as a separate property

# Check COMPATIBILITY PROPERTIES STORED in the .lnk
$text = [System.Text.Encoding]::Unicode.GetString($lnkBytes)
if ($text -contains 'RUNASADMIN') { Write-Host "HAS RUNASADMIN!" }

Write-Host ""
Write-Host "========== 2. Registry: all AppCompatFlags for our EXE =========="
$base = 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags'
Get-ChildItem $base -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
    if ($props) {
        foreach ($p in $props.PSObject.Properties) {
            if ($p.Name -like '*BlackHorse*记账*app_exe*') {
                Write-Host "KEY: $($_.PSPath)"
                Write-Host "  $($p.Name) = $($p.Value)"
            }
        }
    }
}

Write-Host ""
Write-Host "========== 3. Try to decode SACP flags =========="
$store = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store' -ErrorAction SilentlyContinue
foreach ($p in $store.PSObject.Properties) {
    if ($p.Name -like '*BlackHorse*') {
        $data = [byte[]] ($p.Value -split ' ' | Where-Object { $_ -ne '' } | ForEach-Object { [byte]"0x$_" })
        Write-Host "Data length: $($data.Length)"
        # Show as hex
        $hex = ($data | ForEach-Object { $_.ToString('X2') }) -join ' '
        Write-Host "Hex: $hex"

        # Try to find the path string embedded in the data
        $text = [System.Text.Encoding]::Unicode.GetString($data)
        Write-Host "Embedded text: $text"
    }
}

Write-Host ""
Write-Host "========== 4. Check EXE properties =========="
$exeItem = Get-Item $exe -ErrorAction SilentlyContinue
if ($exeItem) {
    Write-Host "EXE exists: Yes"
    Write-Host "Attributes: $($exeItem.Attributes)"

    # Check if file is blocked (Zone.Identifier)
    $zone = Get-Item $exe -Stream Zone.Identifier -ErrorAction SilentlyContinue
    if ($zone) { Write-Host "Zone.Identifier: PRESENT (blocked)" }
    else { Write-Host "Zone.Identifier: none" }

    # Try unblock
    Unblock-File $exe -ErrorAction SilentlyContinue
    Write-Host "Unblock-File executed"
}
