$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
Write-Host "=== 东莞三影院开票雷达：一键初始化上线 ===" -ForegroundColor Cyan
$sec = Read-Host "请粘贴你刚生成的 GitHub Classic Token (输入时已隐藏)" -AsSecureString
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
node scripts/bootstrap-github.mjs
$exitCode = $LASTEXITCODE
Remove-Item Env:GH_BOOTSTRAP_TOKEN -ErrorAction SilentlyContinue
if ($exitCode -ne 0) {
  Write-Host "`n执行失败 (退出码 $exitCode)，请把上面的报错发给我。" -ForegroundColor Red
  exit $exitCode
}
if (Test-Path "PAIR_URL.txt") {
  Write-Host "`n打开 PAIR_URL.txt 即可复制你的手机免配置配对链接与 cron-job.org 参数！" -ForegroundColor Green
  notepad.exe PAIR_URL.txt
}
