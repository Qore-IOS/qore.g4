@echo off
REM ============================================================================
REM Firestore baglanti tanisi.
REM
REM Worker "PERMISSION_DENIED" verdiginde calistirin. .env dosyasini worker'in
REM kullandigi YONTEMLE ayni sekilde yukler, boylece worker'in gordugu ortamin
REM aynisini gorursunuz — .env'i elle okuyup "dogru gorunuyor" demek yeterli
REM degil, sorun cogu zaman yuklemenin kendisinde (tirnak, bosluk, eksik satir).
REM
REM Ozel anahtar hicbir zaman ekrana basilmaz.
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
node check-firestore.js %* > "%LOG%" 2>&1
set RC=%ERRORLEVEL%
type "%LOG%"
echo.
echo ---- Bu cikti "%~dp0%LOG%" dosyasina da yazildi.
echo ---- Kapatmak icin bir tusa basin.
pause >nul
endlocal & exit /b %RC%
