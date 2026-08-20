# install-desktop.ps1
#
# Manually install dsh-deepseek-balance into a DSH profile — the path for
# desktop wrappers / environments without pnpm (the official `dsh plugin
# --profile <name> add` command forwards to pnpm and needs it on PATH).
#
# What it does:
#   1. copies this package into  $DshHome\profiles\node_modules\dsh-deepseek-balance\
#   2. appends "dsh-deepseek-balance" to the profile's dsh.profile.bundles
#      (backing up package.json first)
#
# Usage (from the plugin folder, or wherever this script lives):
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1 -Profile web
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-desktop.ps1 -DshHome "D:\my-dsh-home"
#
# After it finishes: fully restart DSH, then open  Settings → DeepSeek 用量.
#
# Uninstall (manual):
#   - remove "dsh-deepseek-balance" from $DshHome\profiles\<Profile>\package.json
#     (dsh.profile.bundles), or restore the saved package.json.dsh-balance.bak
#   - delete the folder $DshHome\profiles\node_modules\dsh-deepseek-balance

param(
	[string]$Profile = "web",
	[string]$DshHome = ""
)

$ErrorActionPreference = "Stop"
$packageName = "dsh-deepseek-balance"

function Resolve-Home {
	if ($DshHome) { return $DshHome }
	if ($env:DSH_DESKTOP_HOME) { return $env:DSH_DESKTOP_HOME }
	if ($env:DSH_HOME) { return $env:DSH_HOME }
	if (Test-Path "$env:APPDATA\dsh-desktop\dsh") { return "$env:APPDATA\dsh-desktop\dsh" }
	return Join-Path $HOME ".dsh"
}

$dshHome = Resolve-Home
$profileDir = Join-Path $dshHome "profiles\$Profile"
$manifest = Join-Path $profileDir "package.json"
if (-not (Test-Path $manifest)) {
	throw "profile '$Profile' not found at $profileDir - start DSH once so it initializes, or pass -DshHome"
}

$src = Split-Path -Parent $PSScriptRoot
$target = Join-Path (Join-Path $dshHome "profiles\node_modules") $packageName

Write-Host "==> installing $packageName into profile '$Profile' at $dshHome"
# 1) copy the package (lib contents copied file-wise to avoid dir nesting)
New-Item -ItemType Directory -Force -Path (Join-Path $target "lib") | Out-Null
foreach ($file in @("package.json", "cordis.patch.yml", "README.md")) {
	Copy-Item (Join-Path $src $file) $target -Force
}
foreach ($file in (Get-ChildItem (Join-Path $src "lib") -File)) {
	Copy-Item $file.FullName (Join-Path $target "lib") -Force
}

# 2) register the bundle (backup first; textual edit keeps original formatting)
$backup = "$manifest.dsh-balance.bak"
if (-not (Test-Path $backup)) { Copy-Item $manifest $backup }
$json = [System.IO.File]::ReadAllText($manifest)
if ($json -match '"dsh-deepseek-balance"') {
	Write-Host "==> already registered in dsh.profile.bundles; nothing to change."
} else {
	$json = [regex]::Replace($json, '("bundles"\s*:\s*\[)([^\]]*?)(\s*\])', {
		param($m)
		$head = $m.Groups[1].Value
		$body = $m.Groups[2].Value.TrimEnd()
		$tail = $m.Groups[3].Value
		if ($body -eq "") { "$head`n      `"$packageName`"$tail" }
		else { "$head$body,`n      `"$packageName`"$tail" }
	})
	[System.IO.File]::WriteAllText($manifest, $json)
	Write-Host "==> registered $packageName in $manifest (backup at $backup)"
}

Write-Host ""
Write-Host "Done. Fully restart DSH, then open  Settings -> DeepSeek Usage (DeepSeek 用量)."
Write-Host "If something looks wrong, restore $backup over $manifest and delete $target."
