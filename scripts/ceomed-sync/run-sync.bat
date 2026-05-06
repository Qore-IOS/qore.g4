@echo off
REM Ceomed -> Firestore sync (Windows Task Scheduler tarafindan calistirilir)
REM Bugun ve bir onceki gunu kapsayan tarih araligiyla calisir.

setlocal

REM Calisma dizini
cd /d %~dp0

REM Env yukle: set-env.bat (gitignored) icinde plain "set KEY=VALUE" satirlari olmali.
if exist set-env.bat (
  call set-env.bat
) else (
  echo [HATA] set-env.bat bulunamadi. Ornek icerik:
  echo   set CEOMED_BASE_URL=http://192.168.1.5:8081
  echo   set CEOMED_EPOSTA=merkez
  echo   set CEOMED_PAROLA=12345
  echo   set GOOGLE_APPLICATION_CREDENTIALS=C:\Users\btuba\Desktop\firebase-sa.json
  echo   set FIREBASE_PROJECT_ID=invpilot
  exit /b 1
)

REM Tarih araligi: dunden bugune (Turkiye lokal saatine gore)
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('dd.MM.yyyy')"') do set BAS=%%i
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).ToString('dd.MM.yyyy')"') do set BIT=%%i

echo [%date% %time%] Sync basliyor: %BAS% - %BIT% >> sync.log

REM 3 durumu da cek (filtre yok = ALLOWED_STATUSES hepsi)
node syncToFirestore.js %BAS% %BIT% >> sync.log 2>&1

echo [%date% %time%] Sync bitti. >> sync.log
echo. >> sync.log

endlocal
