@echo off
REM ============================================================================
REM Kuyruga TEST isi ekler — Qore'da gercek form kapatmadan surucuyu denemek icin.
REM
REM Kullanim:
REM   enqueue-test-job.bat
REM   enqueue-test-job.bat --irsaliye-no BT10099 --stok-kodu 03753379001
REM   enqueue-test-job.bat --cari-kodu M51009 --miktar 2 --lot LOT123
REM
REM DIKKAT: uygulama mukerrer irsaliye numarasini reddediyor. Her denemede
REM farkli numara verin; verilmezse saat/dakika/saniyeden turetilir.
REM ============================================================================

setlocal
cd /d %~dp0
chcp 65001 >nul 2>&1

set ENV_LOADED=
if exist set-env.bat (
  call set-env.bat
  set ENV_LOADED=1
)
if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do set "%%A=%%B"
  set ENV_LOADED=1
)
if not defined ENV_LOADED (
  echo [HATA] set-env.bat veya .env bulunamadi.
  exit /b 1
)

node enqueue-test-job.js %*
endlocal
