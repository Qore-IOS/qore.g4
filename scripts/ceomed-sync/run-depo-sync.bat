@echo off
REM Ceomed Merkez Depo -> Firestore sync (gunde 1 kez)
setlocal
cd /d %~dp0

REM Env yukle: once varsa set-env.bat, sonra varsa .env okunur.
REM .env satirlari KEY=VALUE formatinda olmali; .env, set-env.bat degerlerini ezebilir.
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

if not defined CEOMED_BASE_URL (
  echo [HATA] CEOMED_BASE_URL tanimli degil. >> sync-depo.log
  exit /b 1
)
if not defined CEOMED_EPOSTA (
  echo [HATA] CEOMED_EPOSTA tanimli degil. >> sync-depo.log
  exit /b 1
)
if not defined CEOMED_PAROLA (
  echo [HATA] CEOMED_PAROLA tanimli degil. >> sync-depo.log
  exit /b 1
)

if not defined APP_BASE_URL (
  echo [HATA] APP_BASE_URL tanimli degil. >> sync-depo.log
  exit /b 1
)

echo [%date% %time%] Depo sync basliyor >> sync-depo.log
node syncMerkezDepo.js >> sync-depo.log 2>&1
set SYNC_EXIT=%ERRORLEVEL%

if not "%SYNC_EXIT%"=="0" (
  echo [%date% %time%] Depo sync HATALI bitti. ExitCode=%SYNC_EXIT% >> sync-depo.log
  echo. >> sync-depo.log
  exit /b %SYNC_EXIT%
)

echo [%date% %time%] Depo sync bitti. ExitCode=0 >> sync-depo.log
echo. >> sync-depo.log

endlocal
exit /b 0
