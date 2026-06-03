@echo off
REM Ceomed companyId backfill — eski tag'siz dokumanlari mevcut companyId ile tagler.
REM run-sync.bat ile ayni env yukleme mantigini kullanir, boylece .env veya set-env.bat
REM hangisi varsa otomatik okur.

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

if not defined GOOGLE_APPLICATION_CREDENTIALS (
  echo [HATA] GOOGLE_APPLICATION_CREDENTIALS tanimli degil.
  exit /b 1
)
if not defined FIREBASE_PROJECT_ID (
  echo [HATA] FIREBASE_PROJECT_ID tanimli degil.
  exit /b 1
)
if not defined CEOMED_COMPANY_ID (
  echo [HATA] CEOMED_COMPANY_ID tanimli degil. .env veya set-env.bat icine ekleyin.
  exit /b 1
)

echo Backfill basliyor: companyId=%CEOMED_COMPANY_ID%
node backfillCompanyId.js
set BACKFILL_EXIT=%ERRORLEVEL%

if not "%BACKFILL_EXIT%"=="0" (
  echo Backfill HATALI bitti. ExitCode=%BACKFILL_EXIT%
  exit /b %BACKFILL_EXIT%
)

echo Backfill bitti. ExitCode=0
endlocal
exit /b 0
