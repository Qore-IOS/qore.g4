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

node check-firestore.js
endlocal
