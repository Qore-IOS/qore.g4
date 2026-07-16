@echo off
REM Ceomed sevkiyat istek dinleyicisi (long-running). Kapanirsa otomatik yeniden baslar.
setlocal
cd /d %~dp0

if exist set-env.bat (
  call set-env.bat
) else (
  echo [HATA] set-env.bat bulunamadi.
  exit /b 1
)

:loop
echo [%date% %time%] Watcher basliyor >> sevkiyat-watcher.log
node watchSevkiyatRequests.js >> sevkiyat-watcher.log 2>&1
echo [%date% %time%] Watcher durdu, 10 sn sonra yeniden baslatiliyor >> sevkiyat-watcher.log
timeout /t 10 /nobreak > nul
goto loop
