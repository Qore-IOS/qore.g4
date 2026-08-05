@echo off
REM ============================================================================
REM Qore -> Ceomed muhasebe irsaliyesi YAZMA worker'i (surekli acik)
REM
REM watch.js Ceomed'den Qore'a OKUR; bu worker ters yonde YAZAR: bir teknik/
REM aplikasyon formunda yedek parca kullanildiginda Ceomed masaustu
REM uygulamasindaki Cikis Irsaliyesi formunu doldurup e-irsaliyeyi gonderir.
REM
REM ONEMLI - VARSAYILAN KURU CALISMADIR (ORACLE_DRY_RUN=1). Bu modda hicbir
REM e-irsaliye gonderilmez; worker sadece ne yazacagini loga basar. Gercek
REM gonderim icin .env dosyasina ORACLE_DRY_RUN=0 yazin. E-irsaliye gonderimi
REM GERI ALINAMAZ - once kuru calismada loglari dogrulayin.
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
echo [%date% %time%] oracle worker basliyor (DRY_RUN=%ORACLE_DRY_RUN%) >> oracle-worker.log
node oracleIrsaliyeWorker.js >> oracle-worker.log 2>&1
echo [%date% %time%] oracle worker durdu (exit %ERRORLEVEL%), 15 sn sonra yeniden baslatiliyor >> oracle-worker.log
timeout /t 15 /nobreak > nul
goto loop
