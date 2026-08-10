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
  echo Bu betik scripts\ceomed-sync klasorunden calismalidir.
  pause >nul
  exit /b 1
)

REM Cikti hem ekrana hem dosyaya: pencere kapanirsa ya da hata uzunsa geriye
REM bakilacak bir yer kalsin. Cift tiklamayla calistirildiginda pencere is biter
REM bitmez kapaniyordu ve operator hicbir sey goremiyordu.
set "LOG=%~n0.log"
node release-review.js %* > "%LOG%" 2>&1
set RC=%ERRORLEVEL%
type "%LOG%"
echo.
echo ---- Bu cikti "%~dp0%LOG%" dosyasina da yazildi.
echo ---- Kapatmak icin bir tusa basin.
pause >nul
endlocal & exit /b %RC%
