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
set SET_ENV_VAR=
if exist set-env.bat (
  call set-env.bat
  set ENV_LOADED=1
  set SET_ENV_VAR=1
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

REM ============================================================================
REM ETKIN AYARLAR — ve degerlerin NEREDEN geldigi.
REM
REM Sahada bir tur kaybedildi: operator .env'den ORACLE_FILL_ONLY satirini silip
REM worker'i yeniden baslatti, log yine "GONDER'e basilmayacak" dedi. Sebep
REM yukaridaki yukleme sirasi: set-env.bat ONCE okunuyor, .env yalnizca KENDI
REM TANIMLADIGI anahtarlari eziyor. .env'den bir satiri silmek, set-env.bat'in
REM ya da Windows kullanici ortam degiskeninin koydugu degeri TEMIZLEMEZ.
REM
REM Bu blok etkin degerleri ve modu basar; deger .env'de yoksa nereye bakilacagini
REM soyler. Tahmin etmeye gerek kalmasin.
REM ============================================================================
set "MOD=GERCEK GONDERIM - E-IRSALIYE GONDERILECEK"
if /I not "%ORACLE_DRY_RUN%"=="0" set "MOD=KURU PLAN - hicbir sey gonderilmez"
if /I "%ORACLE_FILL_ONLY%"=="1"   set "MOD=FORM DOLDUR TESTI - GONDER'e basilmaz"

call :yaz "================ ETKIN AYARLAR ================"
call :yaz "  ORACLE_INTEGRATION_ENABLED = %ORACLE_INTEGRATION_ENABLED%"
call :yaz "  ORACLE_DRY_RUN             = %ORACLE_DRY_RUN%"
call :yaz "  ORACLE_FILL_ONLY           = %ORACLE_FILL_ONLY%"
call :yaz "  MOD                        = %MOD%"
if defined SET_ENV_VAR call :yaz "  NOT: set-env.bat okundu. .env'de TANIMLI OLMAYAN her degisken oradan gelir."
REM Parantezler ZORUNLU: `if COND cmd1 || cmd2` tek satirda cmd tarafindan
REM belirsiz ayristiriliyor, || bazen if'in kendisine baglaniyor. Blok icinde
REM || dogrudan findstr'a bagli olur. Mesajlarda parantez KULLANMAYIN, blogu
REM erken kapatir.
if defined ORACLE_FILL_ONLY (
  findstr /b /i /c:"ORACLE_FILL_ONLY" .env >nul 2>&1 || call :yaz "  UYARI: ORACLE_FILL_ONLY .env'de YOK ama tanimli. Kaynak set-env.bat ya da Windows ortam degiskeni."
)
if defined ORACLE_DRY_RUN (
  findstr /b /i /c:"ORACLE_DRY_RUN" .env >nul 2>&1 || call :yaz "  UYARI: ORACLE_DRY_RUN .env'de YOK ama tanimli. Kaynak set-env.bat ya da Windows ortam degiskeni."
)
call :yaz "==============================================="

if /I not "%ORACLE_INTEGRATION_ENABLED%"=="1" (
  echo [%date% %time%] Oracle/Ceomed yazma entegrasyonu KAPALI. Worker baslatilmadi. >> oracle-worker.log
  echo Oracle/Ceomed yazma entegrasyonu kapali. Acmak icin kontrollu geciste ORACLE_INTEGRATION_ENABLED=1 gerekir.
  exit /b 0
)

:loop
echo [%date% %time%] oracle worker basliyor (BUILD=fill-only-v2-no-controls, DRY_RUN=%ORACLE_DRY_RUN%, FILL_ONLY=%ORACLE_FILL_ONLY%) >> oracle-worker.log
node oracleIrsaliyeWorker.js >> oracle-worker.log 2>&1
echo [%date% %time%] oracle worker durdu (exit %ERRORLEVEL%), 15 sn sonra yeniden baslatiliyor >> oracle-worker.log
timeout /t 15 /nobreak > nul
goto loop

REM ---------------------------------------------------------------------------
REM Hem ekrana hem log'a yazar. Etkin ayarlar banner'i yalnizca log'a gitseydi
REM operator pencereye bakip yanlis modda oldugunu goremezdi; yalnizca ekrana
REM gitseydi sonradan neden o modda kosuldugu kayitsiz kalirdi.
REM
REM :loop sonsuz oldugu icin bu altyordama dusulmez, yalnizca call ile gelinir.
REM ---------------------------------------------------------------------------
:yaz
echo %~1
echo [%date% %time%] %~1 >> oracle-worker.log
exit /b 0
