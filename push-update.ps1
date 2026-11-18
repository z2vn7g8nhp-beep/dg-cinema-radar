$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "=== 更新代码到现有 dg-cinema-radar 仓库 ===" -ForegroundColor Cyan
$sec = Read-Host "请粘贴你的 GitHub Token (输入时已隐藏)" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try {
  $plainToken = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
} finally {
  [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

if ([string]::IsNullOrWhiteSpace($plainToken)) {
  Write-Host "未输入 Token，已取消。" -ForegroundColor Red
  exit 1
}

$env:GH_BOOTSTRAP_TOKEN = $plainToken.Trim()
$env:REPO_NAME = "dg-cinema-radar"
node scripts/push-update.mjs
$exitCode = $LASTEXITCODE
Remove-Item Env:GH_BOOTSTRAP_TOKEN -ErrorAction SilentlyContinue
if ($exitCode -ne 0) {
  Write-Host "`n更新失败 (退出码 $exitCode)" -ForegroundColor Red
  exit $exitCode
}
