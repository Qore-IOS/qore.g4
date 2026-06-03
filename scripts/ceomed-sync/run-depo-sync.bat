@echo off
REM Ceomed Merkez Depo -> Firestore sync (gunde 1 kez)
setlocal
cd /d %~dp0

if exist set-env.bat (
  call set-env.bat
) else (
  echo [HATA] set-env.bat bulunamadi.
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
if not defined GOOGLE_APPLICATION_CREDENTIALS (
  echo [HATA] GOOGLE_APPLICATION_CREDENTIALS tanimli degil. >> sync-depo.log
  exit /b 1
)
if not defined FIREBASE_PROJECT_ID (
  echo [HATA] FIREBASE_PROJECT_ID tanimli degil. >> sync-depo.log
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
