@echo off
REM Ceomed -> Firestore sync (Windows Task Scheduler tarafindan calistirilir)
REM Bugun ve bir onceki gunu kapsayan tarih araligiyla calisir.

setlocal

REM Calisma dizini
cd /d %~dp0

REM .env yukle (varsa). Bu dosyada CEOMED_*, GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_PROJECT_ID olmali.
if exist .env (
  for /f "usebackq eol=# tokens=1,* delims==" %%A in (".env") do (
    if not "%%A"=="" set "%%A=%%B"
  )
)

REM Tarih araligi: dunden bugune (Turkiye lokal saatine gore)
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).AddDays(-1).ToString('dd.MM.yyyy')"') do set BAS=%%i
for /f %%i in ('powershell -NoProfile -Command "(Get-Date).ToString('dd.MM.yyyy')"') do set BIT=%%i

echo [%date% %time%] Sync basliyor: %BAS% - %BIT% >> sync.log

REM 3 durumu da cek (hicbir filtre yok = ALLOWED_STATUSES hepsi)
node syncToFirestore.js %BAS% %BIT% >> sync.log 2>&1

echo [%date% %time%] Sync bitti. >> sync.log
echo. >> sync.log

endlocal
