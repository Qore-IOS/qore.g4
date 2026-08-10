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
  echo Bu betik scripts\ceomed-sync klasorunden calismalidir.
  pause >nul
  exit /b 1
)

REM Cikti hem ekrana hem dosyaya: pencere kapanirsa ya da hata uzunsa geriye
REM bakilacak bir yer kalsin. Cift tiklamayla calistirildiginda pencere is biter
REM bitmez kapaniyordu ve operator hicbir sey goremiyordu.
set "LOG=%~n0.log"
node enqueue-test-job.js %* > "%LOG%" 2>&1
set RC=%ERRORLEVEL%
type "%LOG%"
echo.
echo ---- Bu cikti "%~dp0%LOG%" dosyasina da yazildi.
echo ---- Kapatmak icin bir tusa basin.
pause >nul
endlocal & exit /b %RC%
