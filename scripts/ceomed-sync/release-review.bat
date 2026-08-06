@echo off
REM ============================================================================
REM Incelemede bekleyen isleri serbest birakir (awaiting_review -> previewed).
REM
REM ORACLE_FILL_ONLY=1 modunda worker bir formu doldurduktan sonra operator
REM onayini bekler ve siradaki isi almaz. Panelde "Testi tamamla" butonuyla ayni
REM isi yapar; pes pese test yaparken PowerShell'den cikmadan halletmek icin.
REM
REM Kullanim:
REM   release-review.bat            serbest birakir
REM   release-review.bat --listele  yalnizca listeler
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

node release-review.js %*
endlocal
