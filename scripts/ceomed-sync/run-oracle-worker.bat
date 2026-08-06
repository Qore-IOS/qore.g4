@echo off
chcp 65001 > nul
REM ============================================================================
REM Qore -> Ceomed muhasebe irsaliyesi YAZMA worker'i (surekli acik)
REM
REM watch.js Ceomed'den Qore'a OKUR; bu worker ters yonde YAZAR: bir teknik/
REM aplikasyon formunda yedek parca kullanildiginda Ceomed masaustu
REM uygulamasindaki Cikis Irsaliyesi formunu doldurup e-irsaliyeyi gonderir.
REM
REM ORACLE_FILL_ONLY=1: Oracle formunu gercekten doldurur ama GONDER'e basmaz;
REM operator panelden testi tamamlayana kadar siradaki is kuyrukta bekler.
REM ORACLE_DRY_RUN=1 ve FILL_ONLY=0: yalnizca plani loglar.
REM
REM Bu worker Ceomed masaustu uygulamasinin ACIK ve irsaliye formunun EKRANDA
REM oldugu makinede calismalidir (UI surucusu kullaniliyorsa). Oturum kilitliyse
REM tus vuruslari gitmez - Task Scheduler'da "Yalnizca kullanici oturum acmisken
REM calistir" secili olmalidir.
REM
REM Log: oracle-worker.log
REM ============================================================================

setlocal
cd /d %~dp0

REM Log'a UTF-8 yaz: varsayilan kod sayfasinda Turkce karakterler bozuluyor
REM ve hata mesajlari okunamaz hale geliyor ("e le ti" <- "eslesti").
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
  echo [HATA] set-env.bat veya .env bulunamadi. Ornek .env icerigi:
  echo   GOOGLE_APPLICATION_CREDENTIALS=C:\Users\btuba\Desktop\firebase-sa.json
  echo   FIREBASE_PROJECT_ID=invpilot
  echo   CEOMED_COMPANY_ID=your-company-id
  echo   ORACLE_DRY_RUN=1
  echo   ORACLE_FILL_ONLY=1
  echo   ORACLE_DRIVER=ui
  exit /b 1
)

if not defined FIREBASE_PROJECT_ID (
  echo [HATA] FIREBASE_PROJECT_ID tanimli degil. >> oracle-worker.log
  exit /b 1
)
if not defined GOOGLE_APPLICATION_CREDENTIALS (
  echo [HATA] GOOGLE_APPLICATION_CREDENTIALS tanimli degil. >> oracle-worker.log
  exit /b 1
)
if not defined CEOMED_COMPANY_ID (
  echo [HATA] CEOMED_COMPANY_ID tanimli degil - worker hangi firmanin islerini alacagini bilemez. >> oracle-worker.log
  exit /b 1
)

:loop
echo [%date% %time%] oracle worker basliyor (BUILD=fill-only-v2-no-controls, DRY_RUN=%ORACLE_DRY_RUN%, FILL_ONLY=%ORACLE_FILL_ONLY%) >> oracle-worker.log
node oracleIrsaliyeWorker.js >> oracle-worker.log 2>&1
echo [%date% %time%] oracle worker durdu (exit %ERRORLEVEL%), 15 sn sonra yeniden baslatiliyor >> oracle-worker.log
timeout /t 15 /nobreak > nul
goto loop
