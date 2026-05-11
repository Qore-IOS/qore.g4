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

echo [%date% %time%] Depo sync basliyor >> sync-depo.log
node syncMerkezDepo.js >> sync-depo.log 2>&1
echo [%date% %time%] Depo sync bitti. >> sync-depo.log
echo. >> sync-depo.log

endlocal
