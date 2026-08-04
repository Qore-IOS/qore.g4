@echo off
REM ============================================================================
REM Ceomed -> Qore SUREKLI ACIK watcher (irsaliye + depo + sevkiyat, tek surec)
REM
REM Bu bat, watch.js'i surekli acik tutar ve cokerse yeniden baslatir.
REM Task Scheduler'a "Oturum acildiginda" tetikleyicisiyle eklenmelidir; eski
REM 15 dakikada bir calisan "Ceomed Sync" gorevi DEVRE DISI birakilmalidir
REM (ikisi ayni anda calisirsa ayni irsaliyeler iki kez islenir; belge
REM kimlikleri deterministik oldugu icin mukerrer stok olusmaz ama ERP ve
REM Firestore gereksiz yuk alir).
REM
REM Log: watch.log
REM ============================================================================

setlocal
cd /d %~dp0

REM Env yukle: once varsa set-env.bat, sonra varsa .env okunur.
REM .env satirlari KEY=VALUE formatinda olmali; .env, set-env.bat degerlerini ezer.
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
  echo   CEOMED_BASE_URL=http://192.168.1.5:8081
  echo   CEOMED_EPOSTA=merkez
  echo   CEOMED_PAROLA=12345
  echo   GOOGLE_APPLICATION_CREDENTIALS=C:\Users\btuba\Desktop\firebase-sa.json
  echo   FIREBASE_PROJECT_ID=invpilot
  echo   CEOMED_COMPANY_ID=your-company-id
  exit /b 1
)

REM Zorunlu ayarlar. Eksikse sonsuz yeniden baslatma dongusune girmek yerine
REM burada net sekilde durdurulur.
if not defined CEOMED_BASE_URL (
  echo [HATA] CEOMED_BASE_URL tanimli degil. >> watch.log
  exit /b 1
)
if not defined CEOMED_EPOSTA (
  echo [HATA] CEOMED_EPOSTA tanimli degil. >> watch.log
  exit /b 1
)
if not defined CEOMED_PAROLA (
  echo [HATA] CEOMED_PAROLA tanimli degil. >> watch.log
  exit /b 1
)
if not defined FIREBASE_PROJECT_ID (
  echo [HATA] FIREBASE_PROJECT_ID tanimli degil. >> watch.log
  exit /b 1
)
if not defined GOOGLE_APPLICATION_CREDENTIALS (
  echo [HATA] GOOGLE_APPLICATION_CREDENTIALS tanimli degil. >> watch.log
  exit /b 1
)
if not defined CEOMED_COMPANY_ID (
  echo [HATA] CEOMED_COMPANY_ID tanimli degil - yazilan dokumanlar panelde gorunmez. >> watch.log
  exit /b 1
)

:loop
echo [%date% %time%] watcher basliyor >> watch.log
node watch.js >> watch.log 2>&1
echo [%date% %time%] watcher durdu (exit %ERRORLEVEL%), 10 sn sonra yeniden baslatiliyor >> watch.log
timeout /t 10 /nobreak > nul
goto loop
