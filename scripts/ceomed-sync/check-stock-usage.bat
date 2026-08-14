@echo off
REM ============================================================================
REM "Stok dusmus ama form yok" tanisi. Stok -> form -> Ceomed kuyrugu zincirini
REM ucdan uca okur ve hangi halkada koptugunu soyler.
REM
REM Kullanim:
REM   check-stock-usage.bat --stok-kodu 03753379001
REM   check-stock-usage.bat --stok-kodu 03753379001 --gun 2026-08-11
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
  echo Bu betik scripts\ceomed-sync klasorunden calismalidir.
  pause >nul
  exit /b 1
)

set "LOG=%~n0.log"
node check-stock-usage.js %* > "%LOG%" 2>&1
set RC=%ERRORLEVEL%
type "%LOG%"
echo.
echo ---- Bu cikti "%~dp0%LOG%" dosyasina da yazildi.
echo ---- Kapatmak icin bir tusa basin.
pause >nul
endlocal & exit /b %RC%
