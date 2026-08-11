@echo off
REM ============================================================================
REM Bir irsaliyenin Ceomed'de GERCEKTEN olustugunu okuma API'siyle dogrular.
REM
REM Yazma tarafi ekran otomasyonu; "gonderildi" bilgisi ekrandan geliyor. Bu
REM arac ayni soruyu Ceomed'in kendi verisinden cevaplar.
REM
REM Kullanim:
REM   verify-irsaliye.bat --no BK10134 --tarih 2026-08-11
REM   verify-irsaliye.bat --no BK10134 --tarih 2026-08-11 --kesfet
REM   verify-irsaliye.bat --tarih 2026-08-11 --listele
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
node verify-irsaliye.js %* > "%LOG%" 2>&1
set RC=%ERRORLEVEL%
type "%LOG%"
echo.
echo ---- Bu cikti "%~dp0%LOG%" dosyasina da yazildi.
echo ---- Kapatmak icin bir tusa basin.
pause >nul
endlocal & exit /b %RC%
