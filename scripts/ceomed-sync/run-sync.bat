@echo off
REM Ceomed -> Firestore sync (Windows Task Scheduler tarafindan calistirilir)
REM Tarih araligi node tarafinda otomatik hesaplanir: son basarili sync'ten bugune.
REM Boylece makine gunlerce kapali kalsa bile aradaki irsaliyeler atlanmaz.

setlocal

REM Calisma dizini
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
  echo [HATA] set-env.bat veya .env bulunamadi. Ornek .env icerigi:
  echo   CEOMED_BASE_URL=http://192.168.1.5:8081
  echo   CEOMED_EPOSTA=merkez
  echo   CEOMED_PAROLA=12345
  echo   GOOGLE_APPLICATION_CREDENTIALS=C:\Users\btuba\Desktop\firebase-sa.json
  echo   FIREBASE_PROJECT_ID=invpilot
  echo   CEOMED_COMPANY_ID=your-company-id
  exit /b 1
)

REM Zorunlu env kontrolleri. Task Scheduler normalde son komutun exit code'unu
REM basarili gorebildigi icin eksik ayarlari burada net sekilde fail ettiriyoruz.
if not defined CEOMED_BASE_URL (
  echo [HATA] CEOMED_BASE_URL tanimli degil. >> sync.log
  exit /b 1
)
if not defined CEOMED_EPOSTA (
  echo [HATA] CEOMED_EPOSTA tanimli degil. >> sync.log
  exit /b 1
)
if not defined CEOMED_PAROLA (
  echo [HATA] CEOMED_PAROLA tanimli degil. >> sync.log
  exit /b 1
)
if not defined GOOGLE_APPLICATION_CREDENTIALS (
  echo [HATA] GOOGLE_APPLICATION_CREDENTIALS tanimli degil. >> sync.log
  exit /b 1
)
if not defined FIREBASE_PROJECT_ID (
  echo [HATA] FIREBASE_PROJECT_ID tanimli degil. >> sync.log
  exit /b 1
)
if not defined CEOMED_COMPANY_ID (
  echo [HATA] CEOMED_COMPANY_ID tanimli degil. Yeni irsaliyeler panelde gorunmez. .env veya set-env.bat icine ekleyin. >> sync.log
  exit /b 1
)

echo [%date% %time%] Sync basliyor (tarih araligi otomatik) >> sync.log

REM Tarih verilmez -> syncToFirestore.js son basarili sync'ten bugune otomatik aralik kurar.
REM 3 durumu da cek (filtre yok = ALLOWED_STATUSES hepsi)
node syncToFirestore.js >> sync.log 2>&1
set SYNC_EXIT=%ERRORLEVEL%

if not "%SYNC_EXIT%"=="0" (
  echo [%date% %time%] Sync HATALI bitti. ExitCode=%SYNC_EXIT% >> sync.log
  echo. >> sync.log
  exit /b %SYNC_EXIT%
)

echo [%date% %time%] Sync bitti. ExitCode=0 >> sync.log
echo. >> sync.log

endlocal
exit /b 0
