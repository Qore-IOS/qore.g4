"""Ceomed "Çıkış İrsaliyesi" formunu doldurur (Oracle Forms 6i).

Node tarafı (`drivers/uiDriver.js`) işi stdin'e JSON olarak verir; bu betik son
satıra tek satırlık JSON sonuç basar.

TASARIM — neden alan sırası sabit varsayılmıyor:

Formun görünen alanları Windows kontrolü değil, tuvale çizilmiş; `child_window()`
ile bulunamıyorlar. Elimizde ölçülmüş TAB/ENTER sırası var ama ona körlemesine
güvenmek tehlikeli: form sürümü değişir, bir alan eklenir, koşullu bir alan
atlanırsa sürücü yanlış alana yazar ve bunu fark etmez. Muhasebeye yanlış kayıt
gider.

Bunun yerine sürücü her adımda **odağın nerede olduğunu okur** ve konumdan hangi
alanda olduğunu tanır. Tanımadığı alanı atlar, tanıdığına yazar, beklediği yere
varamazsa durur. Ölçülen konumlar pencereye GÖRE tutulur; pencere taşınsa da
geçerli kalır.

GÜVENLİK:
  * Varsayılan KURU çalışma: form doldurulur, doğrulanır, ekran görüntüsü alınır
    ama E-İRSALİYE GÖNDER'e BASILMAZ. Gerçek gönderim `--gercek` ister.
  * Her alan yazıldıktan sonra GERİ OKUNUR; uyuşmazlıkta gönderim yapılmaz.
  * Odak ilerlemediyse değer reddedilmiştir (Forms `WHEN-VALIDATE-ITEM`); iş
    durur. Bu, hatanın modal pencere açmadığı durumlarda da çalışır.
  * `ui60.tehlikeli_odak_kontrol()` her tuştan önce çalışır.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui60  # noqa: E402

# Sonuç JSON'u Node'a boru üzerinden gidiyor ve Node onu UTF-8 okuyor. Windows'ta
# Python'un stdout kodlaması varsayılan olarak cp1254/cp857 olduğu için Türkçe
# karakterler bozuluyordu: worker log'unda "yaz ld " (yazıldı), "do ruland "
# (doğrulandı) gibi okunamaz adımlar çıkıyordu. Adım log'u teşhis aracı;
# okunamaz olması onu işlevsiz kılar.
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except AttributeError:
    pass  # Python 3.6 ve öncesi; bu makinede 3.7+ var.


# Ölçülmüş alan konumları — MDI BELGE penceresinin sol üst köşesine göre.
#
# Neden ana pencereye göre değil: Ceomed bir MDI uygulaması, form ana pencerenin
# içinde ayrı bir alt pencerede duruyor. Ana pencereye göre ölçmek kırılgan —
# provada İrsaliye No (123,113) yerine (9,100)'de göründü ve sürücü "form yarıda
# kalmış" sanıp durdu. MDI belge penceresine göre konum, ana pencere boyutundan
# bağımsız.
#
# Ham ölçüm ana pencere kökü (-1929,-62), MDI belge kökü (-1923,-31) ile
# yapıldı; aradaki (-6,-31) farkı aşağıdaki değerlere işlenmiştir.
# Tutanak: ORACLE-IRSALIYE.md
ALAN_KONUMLARI: dict[str, tuple[int, int]] = {
    # Başlık
    "irsaliyeNo":      (117, 82),
    "tarih":           (240, 82),
    "fiiliSevkTarihi": (438, 79),
    "cariKodu":        (117, 101),
    "sevkAdresi":      (117, 143),
    "islemTipi":       (849, 118),
    "depo":            (849, 138),
    "teslimEden":      (849, 158),
    "teslimAlan":      (849, 178),
    "anlasmaNo":       (849, 198),
    # Grid ilk satır (y sabit; sonraki satırlarda y artar, eşleştirme x'e bakar)
    "stokKodu":        (8, 266),
    "lot":             (569, 266),
    "miat":            (643, 266),
    "kt":              (719, 266),
    "miktar":          (754, 266),
    # Sol alttaki Açıklama tablosunun ilk satırı. Prova 5 sonrasında
    # alan elle odaklanarak MDI belgeye göre ölçüldü.
    "aciklama":        (64, 667),
}

# Prova 5'te aynı Açıklama Edit'i ana Ceomed penceresine göre de ölçüldü.
# Grid ile alt Açıklama alanı farklı iç MDI document'lere bağlanabildiği
# için bu iki bölge arasındaki tıklama ana pencereye göre yapılır.
ACIKLAMA_PENCERE_KONUMU = (70, 698)
# Açıklama tablosunun 2. ve 3. satırı — GÖNDERİM KANITI.
#
# Operatör ölçüsü: "açıklamanın 2. ve 3. satırına irsaliye bilgileri geldiğinde
# irsaliye kesin kesilmiş oluyor". Bu, ekran otomasyonunun elindeki EN GÜÇLÜ
# doğrulama: uygulamanın kendi yazdığı bir kayıt, bizim yazdığımız değil.
#
# Satır aralığı ÖLÇÜLMEDİ. Aşağıdaki adaylar sırayla denenip okunanlar log'a
# yazılıyor; hangisinin tuttuğu ilk koşuda görülecek ve tek değere indirilecek.
ACIKLAMA_SATIR_ARALIK_ADAYLARI = (11, 12, 13, 14)
# Prova loglarında ilk Stok Kodu Edit'i ana pencereye göre tutarlı olarak
# (14, 297) konumunda ölçüldü. Başlık ile grid de farklı iç MDI köklerine
# bağlanabildiği için bölgeler arası geçişte bu karşılık kullanılır.
STOK_KODU_PENCERE_KONUMU = (14, 297)
# İrsaliye No'nun ana pencereye göre karşılığı. Yukarıdaki ölçüm notunda geçen
# (123,113) değeriyle aynı; MDI(117,82) + (6,31) ofseti de bunu veriyor.
# F6 için gerekli: temizleme yalnızca odak İrsaliye No'dayken çalışıyor.
IRSALIYE_NO_PENCERE_KONUMU = (123, 113)

KONUM_TOLERANS = 18

# Bu alanlardan çıkışta Forms bir LOV (arama) penceresi açar. Filtre alanı
# yazdığımız değer + '%' olarak kendiliğinden dolar; ENTER seçili satırı kabul
# eder. Liste çizilmiş olduğu için OKUNAMAZ — pencere kapandıktan sonra alanı
# geri okumak tek güvencedir.
LOV_ALANLARI = {"cariKodu", "depo", "stokKodu"}

# Grid satırındaki sütunlar, ENTER ile gezilen sırada.
GRID_SIRASI = ["stokKodu", "lot", "miat", "kt", "miktar"]

MAX_ADIM = 60  # sonsuz döngü koruması

# Formu boşaltan menü maddesinin adı — F6 reddedildiğinde kullanılan ikinci yol.
#
# Desen KASITLI OLARAK DAR: menü maddesi ateşlemek tuş göndermek kadar
# tehlikeli, "Yeni Cari Kart" gibi başka bir form açan bir madde de "Yeni" ile
# eşleşirdi. Bu yüzden eylem KAYIT/FORM/BELGE ile birlikte anılmak zorunda.
# `ui60.MENU_YASAKLI` ayrıca Sil/Kaydet/Gönder gibi maddeleri baştan atıyor.
FORM_YENILE_MENU_DESENI = re.compile(
    r"(YENI|BOS)\s*(KAYIT|BELGE|FORM|IRSALIYE)"
    r"|(KAYIT|FORM|BELGE|EKRAN)\s*(TEMIZLE|BOSALT|YENILE)"
    # Yalnız başına "Temizle" maddesi. Desen TÜM YOLA uygulandığı için
    # ("Düzen > Temizle") satır başı çapası yetmiyor; son parçayı yakalıyoruz.
    r"|(^|>\s*)TEMIZLE$"
    r"|CLEAR\s*(FORM|RECORD|BLOCK)"
    r"|NEW\s*RECORD",
    re.IGNORECASE,
)


def emit(payload: dict) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    return 0 if payload.get("ok") else 1


def fail(error: str, retryable: bool, screenshot: str | None = None,
         log: list[str] | None = None, form_kirli: bool = False) -> int:
    """Hata sonucu. `log` HER ZAMAN eklenir: bir kuru çalışma tıkandığında
    'nerede durdu' sorusunun cevabı adım geçmişindedir, ekran görüntüsü tek
    başına yetmez.

    `form_kirli`: hata İŞLE İLGİLİ DEĞİL, ekranda duran formla ilgili. Bu ayrım
    worker için kritik — ayrıntı `FormTemizlenemedi`in gövdesinde.
    """
    payload = {"ok": False, "error": error, "retryable": retryable}
    if screenshot:
        payload["screenshotPath"] = screenshot
    if form_kirli:
        payload["formKirli"] = True
    payload["log"] = log or []
    return emit(payload)


def alan_adi(pencere_ici: tuple[int, int], grid_modu: bool = False) -> str | None:
    """Konumdan alan adını çözer; tanınmayan konumda None.

    Grid modunda yalnızca x karşılaştırılır: aynı sütun sonraki satırda farklı
    y'de olur.
    """
    px, py = pencere_ici
    for ad, (bx, by) in ALAN_KONUMLARI.items():
        if grid_modu and ad in GRID_SIRASI:
            if abs(px - bx) <= KONUM_TOLERANS:
                return ad
        elif abs(px - bx) <= KONUM_TOLERANS and abs(py - by) <= KONUM_TOLERANS:
            return ad
    return None


class Durdu(RuntimeError):
    """Sürücü güvenli biçimde durdu; gönderim yapılmayacak."""

    def __init__(self, mesaj: str, retryable: bool = False):
        super().__init__(mesaj)
        self.retryable = retryable


class FormTemizlenemedi(Durdu):
    """Ekranda duran form boşaltılamadı — HATA İŞTE DEĞİL, EKRANDA.

    NEDEN AYRI BİR TÜR: bu hata sıradaki her işi de düşürür, çünkü hepsi aynı
    dolu formu bulur. Sahada tam olarak bu oldu — bir işin gönderim sonrası F6
    yenilemesi tutmadı, form 'DC10095' ile ekranda kaldı ve sonraki işler o
    formun üstüne yazamadıkları için deneme haklarını tüketip
    "ELLE MÜDAHALE GEREKİR" ile `failed` oldular. Oysa o işlerde hiçbir sorun
    yoktu: tek bir ekran, birden çok işi yanlış yere yazdırdı.

    Worker bu türü görünce işi deneme hakkı harcamadan kuyruğa geri koyuyor ve
    turu bitiriyor; form elle boşaltılınca kuyruk kendiliğinden akmaya devam
    ediyor.
    """


def ilerle(etiket: str) -> None:
    """ENTER'la bir sonraki alana geçer ve gerçekten geçtiğini doğrular."""
    kimlik = ui60.odak_kimligi()
    ui60.tus("ENTER", bekle_ms=350)
    if not ui60.odak_ilerledi_mi(kimlik):
        ipucu = ""
        if etiket == "irsaliyeNo":
            # Provada görüldü: aynı numara ikinci kez denendiğinde Forms alandan
            # çıkmaya izin vermiyor. Uygulamanın kendi mükerrer koruması.
            ipucu = (" Bu numara zaten kullanılmış olabilir — uygulama mükerrer "
                     "irsaliye numarasını reddediyor.")
        raise Durdu(
            f"{etiket} alanından çıkılamadı — uygulama değeri reddetti.{ipucu} "
            "Formun alt mesaj satırında bir hata olabilir (ör. WHEN-VALIDATE-ITEM). "
            "Ekran görüntüsüne bakın."
        )


def konum_eslesiyor(pencere_ici: tuple[int, int], hedef: tuple[int, int]) -> bool:
    return (abs(pencere_ici[0] - hedef[0]) <= KONUM_TOLERANS
            and abs(pencere_ici[1] - hedef[1]) <= KONUM_TOLERANS)


def lov_ile_yaz(ad: str, deger: str, ana_pencere: int, log: list[str]) -> None:
    """LOV açan bir alana yazar ve seçimi DOĞRULAR.

    Liste çizilmiş olduğu için hangi satırın seçildiğini göremiyoruz; tek güvence
    seçim sonrası alandaki değeri okumak.

    ZORLUK: Forms, LOV kabul edilince odağı çoğu zaman BİR SONRAKİ alana taşıyor.
    Odakta olmayan alan okunamıyor (hepsi tuvale çizili), dolayısıyla "odaktaki
    değeri oku" yaklaşımı yanlış alanı okur — ilk provada Cari Kodu yerine Sevk
    Adresi okundu ve geçerli bir seçim reddedilmiş gibi göründü.

    Çözüm: odak ilerlediyse SHIFT+TAB ile alana geri dön, oku, sonra ileri dön.
    Geri dönüşte beklenen alana varılamazsa iş durur — körlemesine kabul edilmez.
    """
    hedef = ALAN_KONUMLARI[ad]

    ui60.alan_yaz(deger, ad)
    log.append(f"{ad}: {deger!r} yazıldı")

    ui60.tus("ENTER", bekle_ms=600)

    bitis = time.time() + 6
    while time.time() < bitis and not ui60.lov_acik_mi(ana_pencere):
        time.sleep(0.15)

    if ui60.lov_acik_mi(ana_pencere):
        if ui60.uyari_penceresi_mi(ana_pencere):
            raise Durdu(
                f"{ad}: arama penceresi yerine uyarı penceresi açıldı "
                f"({deger!r} kabul edilmemiş olabilir)."
            )
        ui60.lov_kabul_et(ana_pencere)
        log.append(f"{ad}: arama penceresi onaylandı")
        time.sleep(0.5)

    o = ui60.odak()
    if not konum_eslesiyor(o["mdi_ici"], hedef):
        # Forms ilerletmiş; okumak için geri dön.
        ui60.tus("SHIFTTAB", bekle_ms=450)
        o = ui60.odak()
        if not konum_eslesiyor(o["mdi_ici"], hedef):
            raise Durdu(
                f"{ad}: seçim sonrası alana geri dönülemedi "
                f"(odak {o['pencere_ici']}, beklenen {hedef}). "
                "Değer doğrulanamadığı için gönderim yapılmayacak."
            )

    okunan = o["deger"]
    if okunan != deger:
        raise Durdu(
            f"{ad}: arama penceresinden {okunan!r} seçildi, beklenen {deger!r}. "
            "Liste okunamadığı için seçim körlemesine yapılıyor; uyuşmazlıkta "
            "gönderim yapılmaz."
        )
    log.append(f"{ad}: geri okundu, {okunan!r} doğrulandı")

    if konum_eslesiyor(ui60.odak()["mdi_ici"], hedef):
        # Geri okuma sonrası (veya Forms seçimden sonra ilerlemediyse) ileri
        # dön. Alandan çıkış LOV'u yeniden açabilir; değer artık çözülmüş
        # olduğu için aynı satır seçilir. Fonksiyonun sözleşmesi: döndüğünde
        # odak bir sonraki alandadır.
        ui60.tus("ENTER", bekle_ms=600)
        if ui60.lov_acik_mi(ana_pencere) and not ui60.uyari_penceresi_mi(ana_pencere):
            ui60.lov_kabul_et(ana_pencere)
            time.sleep(0.4)


def baslik_doldur(degerler: dict[str, str], ana_pencere: int, log: list[str]) -> None:
    """Başlık alanlarını konumdan tanıyarak doldurur, grid'e varınca durur."""
    for _ in range(MAX_ADIM):
        o = ui60.odak()
        ad = alan_adi(o["mdi_ici"])

        if ad == "stokKodu":
            return  # grid'e ulaşıldı

        if ad == "anlasmaNo":
            # Bu kurulumda boş Anlaşma No'dan ENTER ile çıkış kararlı
            # değil: Prova 5'te grid'e geçti, Prova 6'da aynı alan odağı
            # hapsetti. Boş alanı valide etmeye çalışmak yerine ölçülmüş
            # Stok Kodu hücresini doğrulamalı tıkla.
            log.append("anlasmaNo: dokunulmadı")
            grid_stok_koduna_git(ana_pencere, log)
            return

        if ad == "sevkAdresi" and degerler.get(ad):
            # SEVK ADRESİ İKİNCİL BİLGİDİR — irsaliyeyi düşürmemeli.
            #
            # Sahada: adres Türkçe karakter içeriyor, Ceomed'in karakter kümesi
            # bunları taşımıyor ('Ç' → '?'). alan_yaz geri okuyup karşılaştırdığı
            # için uyuşmazlıkta iş duruyordu; yani Türkçe adresli HER ek hizmet
            # işi bu alanda kalırdı. Değer ASCII'ye indirgenerek yazılıyor.
            #
            # Yine de yazılamazsa ATLANIYOR: cari kodu doğru olduğu sürece
            # irsaliye kesilebilir, adres olmadan da muhasebe kaydı geçerlidir.
            # Bu alan yüzünden gönderimi iptal etmek, ikincil bir bilgi için
            # birincil işi feda etmek olurdu.
            ascii_adres = ui60.ascii_indirge(degerler[ad])
            try:
                ui60.alan_yaz(ascii_adres, ad)
                if ascii_adres != degerler[ad]:
                    log.append(
                        f"{ad}: {ascii_adres!r} yazıldı "
                        f"(Türkçe karakterler ASCII'ye indirgendi)"
                    )
                else:
                    log.append(f"{ad}: {ascii_adres!r} yazıldı ve geri okundu")
            except Exception as exc:
                log.append(f"{ad}: YAZILAMADI, atlandı — {exc}")
        elif ad and degerler.get(ad):
            if ad in LOV_ALANLARI:
                lov_ile_yaz(ad, degerler[ad], ana_pencere, log)
                # Geri okuma için dönülen alandan sonraki alana yeniden
                # lov_ile_yaz geçer; aşağıdaki ilerle ikinci kez geçmemeli.
                continue
            else:
                ui60.alan_yaz(degerler[ad], ad)
                log.append(f"{ad}: {degerler[ad]!r} yazıldı ve geri okundu")
        elif ad:
            log.append(f"{ad}: dokunulmadı")
        else:
            log.append(f"tanınmayan alan {o['pencere_ici']} — atlandı")

        ilerle(ad or f"konum {o['pencere_ici']}")

    raise Durdu(
        f"{MAX_ADIM} adımda grid'e ulaşılamadı. Form beklenenden farklı; "
        "sessizce yanlış alana yazmamak için durduruldu."
    )


def grid_stok_koduna_git(ana_pencere: int, log: list[str]) -> None:
    """Başlıktan grid'in ilk Stok Kodu hücresine doğrulamalı geçer."""
    # Prova 10, Anlaşma No'nun bağlı olduğu MDI köküne göre hesaplanan
    # grid noktasının grid'e geçmediğini gösterdi. Header -> grid bir bölge
    # geçişidir; sahada ölçülmüş ana pencere koordinatını kullan.
    tiklama = ui60.pencere_noktasina_tikla(
        ana_pencere,
        (STOK_KODU_PENCERE_KONUMU[0] + 10,
         STOK_KODU_PENCERE_KONUMU[1] + 8),
    )
    o = ui60.odak()
    if (alan_adi(o["mdi_ici"], grid_modu=True) != "stokKodu"
            or o["sinif"] != "Edit"):
        raise Durdu(
            f"Grid Stok Kodu alanı odaklanamadı; odak {o['mdi_ici']} "
            f"({o['sinif'] or 'sınıfsız'}) konumunda. "
            f"Tıklama: {tiklama!r}. Yazılmadı."
        )
    log.append(
        f"grid: Stok Kodu alanı tıklanarak odaklandı "
        f"(mdi {o['mdi_ici']}, pencere {o['pencere_ici']})"
    )


def satir_doldur(satir: dict, ana_pencere: int, log: list[str],
                 miktar_uyarisini_onayla: bool = False) -> None:
    """Bir grid satırını doldurur: Stok Kodu → LOT → Miat → KT → Miktar."""
    stok = str(satir.get("stokKodu") or "")
    if any(ord(ch) > 127 for ch in stok):
        # Provada ölçüldü: 'ALK-BİO-E-CI' alana doğru yazıldı ve Edit'ten doğru
        # okundu, ama Forms değeri veritabanına yazarken 'İ' harfi '?' oldu ve
        # stok kartı bulunamadı. GERİ OKUMA BU HATAYI YAKALAYAMAZ — kayıp
        # commit anında, alanın içeriği doğru görünürken oluşuyor. Bu yüzden
        # denenmeden durduruluyor.
        raise Durdu(
            f"Stok kodu {stok!r} ASCII dışı karakter içeriyor. Ceomed'in "
            "karakter kümesi bunları taşımıyor (ör. 'İ' → '?') ve stok kartı "
            "bulunamıyor. Kaybı geri okuma yakalayamadığı için denenmedi; "
            "stok kodunu Ceomed'deki gerçek yazımıyla girin."
        )
    hedefler = {
        "stokKodu": str(satir.get("stokKodu") or ""),
        "lot": str(satir.get("lot") or ""),
        "miat": str(satir.get("miad") or ""),
        "kt": "",  # dokunulmuyor
        "miktar": str(satir.get("miktar") or ""),
    }

    for beklenen_sutun in GRID_SIRASI:
        o = ui60.odak()
        ad = alan_adi(o["mdi_ici"], grid_modu=True)
        log.append(
            f"grid: {beklenen_sutun} bekleniyor, "
            f"mdi {o['mdi_ici']}, pencere {o['pencere_ici']} "
            f"({ad or 'tanınmayan'})"
        )
        if ad != beklenen_sutun:
            raise Durdu(
                f"Grid'de {beklenen_sutun} bekleniyordu, odak {ad or o['pencere_ici']} "
                "konumunda. Sütun sırası beklenenden farklı; durduruldu."
            )

        deger = hedefler[beklenen_sutun]
        if deger:
            if beklenen_sutun in LOV_ALANLARI:
                lov_ile_yaz(beklenen_sutun, deger, ana_pencere, log)
            else:
                ui60.alan_yaz(deger, beklenen_sutun)
                log.append(f"{beklenen_sutun}: {deger!r} yazıldı ve geri okundu")
        else:
            log.append(f"{beklenen_sutun}: boş bırakıldı")

        # UYARI HER ALANDAN SONRA ÇIKABİLİR.
        #
        # Sahada ölçüldü: uyarı yalnızca Miktar'dan sonra değil, LOT ya da seri
        # no girildikten sonra da açılıyor. Yalnızca Miktar sonrası ele
        # alındığı için sürücü uyarı penceresi açıkken öylece kalıyordu —
        # sonraki her tuş uyarı penceresine gidiyor, iş zaman aşımına düşüyordu.
        if ui60.uyari_penceresi_mi(ana_pencere):
            if not miktar_uyarisini_onayla:
                raise Durdu(
                    f"{beklenen_sutun} alanından sonra bir uyarı penceresi açıldı. "
                    "Uyarı metni Forms tuvaline çizildiği için okunamıyor; "
                    "otomatik onaylanmadı. Ekran görüntüsündeki uyarı kabul "
                    "edilecekse --miktar-uyarisini-onayla ile tekrarlayın.",
                    retryable=True,
                )
            ui60.uyari_kabul_et(ana_pencere)
            log.append(f"{beklenen_sutun} sonrası uyarı: operatör tercihiyle onaylandı")
            time.sleep(0.3)

        if (beklenen_sutun != GRID_SIRASI[-1]
                and beklenen_sutun not in LOV_ALANLARI):
            ilerle(beklenen_sutun)


def irsaliye_numarasina_git(log: list[str]) -> None:
    """Odağı İrsaliye No'ya getirir; var olan değeri yazma adımı siler."""
    for adim in range(MAX_ADIM):
        o = ui60.odak()
        if alan_adi(o["mdi_ici"]) == "irsaliyeNo":
            if adim:
                log.append(f"başlangıç: İrsaliye No alanına {adim} geri adımda gelindi")
            if o["deger"]:
                log.append("başlangıç: mevcut İrsaliye No otomatik temizlenecek")
            return

        baslik_alani = alan_adi(o["mdi_ici"])
        grid_alani = alan_adi(o["mdi_ici"], grid_modu=True)
        if baslik_alani is None and grid_alani is None:
            raise Durdu(
                f"Başlangıç odağı tanınmıyor (mdi {o['mdi_ici']}, "
                f"pencere {o['pencere_ici']}); "
                "yanlış forma tuş göndermemek için durduruldu.",
                retryable=True,
            )
        ui60.tus("SHIFTTAB", bekle_ms=250)

    raise Durdu(
        f"{MAX_ADIM} geri adımda İrsaliye No alanına ulaşılamadı.",
        retryable=True,
    )


def aciklama_doldur(deger: str, ana_pencere: int, log: list[str],
                    miktar_uyarisini_onayla: bool = False) -> None:
    """Sol alttaki Açıklama ilk satırına personel adını yazar."""
    if not deger.strip():
        raise Durdu("Açıklama/personel adı boş; gönderim yapılmayacak.")

    # Son satır doldurulduğunda odak Miktar'da olmalı. Başka bir yerden
    # koordinatlı tıklamaya geçmek, yarım formu sessizce kabul etmek olur.
    once = ui60.odak()
    if alan_adi(once["mdi_ici"], grid_modu=True) != "miktar":
        raise Durdu(
            f"Açıklama öncesi Miktar alanı bekleniyordu; odak "
            f"{once['mdi_ici']} konumunda. Tıklanmadı."
        )

    # Prova 7, grid odağındaki MDI kökünün Açıklama bölgesinin kökü
    # olmadığını gösterdi. Aynı saha ölçümünün ana pencere karşılığını
    # kullan; tıklama sonrası MDI konumunu yine geri okuyup doğrula.
    tiklama = ui60.pencere_noktasina_tikla(
        ana_pencere,
        (ACIKLAMA_PENCERE_KONUMU[0] + 10, ACIKLAMA_PENCERE_KONUMU[1] + 8),
    )
    if ui60.uyari_penceresi_mi(ana_pencere):
        if not miktar_uyarisini_onayla:
            raise Durdu(
                "Miktar alanından çıkarken bir uyarı açıldı. Uyarı içeriği "
                "Forms tuvalinden okunamadığı için otomatik onaylanmadı. Ekran "
                "görüntüsündeki uyarı kabul edilecekse kuru provayı "
                "--miktar-uyarisini-onayla ile tekrarlayın."
            )
        ui60.uyari_kabul_et(ana_pencere)
        log.append("miktar sonrası uyarı: operatör tercihiyle onaylandı")
        time.sleep(0.3)
        o = ui60.odak()
        if alan_adi(o["mdi_ici"]) != "aciklama":
            tiklama = ui60.pencere_noktasina_tikla(
                ana_pencere,
                (ACIKLAMA_PENCERE_KONUMU[0] + 10,
                 ACIKLAMA_PENCERE_KONUMU[1] + 8),
            )
            if ui60.uyari_penceresi_mi(ana_pencere):
                raise Durdu(
                    "Miktar sonrası uyarı onaylandı ancak Açıklama'ya "
                    "geçerken yeniden açıldı; ikinci kez onaylanmadı."
                )
    o = ui60.odak()
    if alan_adi(o["mdi_ici"]) != "aciklama" or o["sinif"] != "Edit":
        raise Durdu(
            f"Açıklama alanı odaklanamadı; odak {o['mdi_ici']} "
            f"({o['sinif'] or 'sınıfsız'}) konumunda. "
            f"Tıklama: {tiklama!r}. Yazılmadı."
        )

    # ASCII'ye indirgenerek yazılır. Sahada ölçüldü: 'PİNCH TUBE' alana
    # "PA'NCH TUBE" olarak düştü — Ceomed karakter kümesi 'İ' harfini taşımıyor
    # ve bozulma yalnızca gözle fark edilebiliyor, geri okuma yakalamıyor.
    # Muhasebe açıklamasında bozuk karakter, okunabilir ASCII'den kötüdür.
    ascii_aciklama = ui60.ascii_indirge(deger.strip())
    ui60.alan_yaz(ascii_aciklama, "aciklama")
    if ascii_aciklama != deger.strip():
        log.append(
            f"aciklama: {ascii_aciklama!r} yazıldı "
            f"(Türkçe karakterler ASCII'ye indirgendi)"
        )
    else:
        log.append(f"aciklama: {ascii_aciklama!r} yazıldı ve geri okundu")


def form_yenile(ana_pencere: int, log: list[str], sebep: str) -> None:
    """F6 ile formu temizleyip yeni boş forma geçer.

    Ceomed'de E-İRSALİYE GÖNDER'den sonra form KAPANMIYOR: kayıt bilgileriyle
    ekranda kalıyor ve operatör F6'ya basarak yeni boş form açıyor. Sürücü bunu
    kendisi yapmazsa sıradaki iş dolu bir formun üstüne yazmaya çalışır.

    İşin BAŞINDA da çağrılır: form önceki işten (ya da elle yapılmış bir
    denemeden) dolu kalmış olabilir. Böylece worker gözetimsiz çalışırken
    operatörün her seferinde elle boş form açması gerekmez.
    """
    if ui60.lov_acik_mi(ana_pencere):
        raise FormTemizlenemedi(
            "Form yenilenemedi: ekranda açık bir pencere var (uyarı ya da arama "
            "penceresi). F6 bu durumda çalışmaz; pencere kapatılmalı.",
            retryable=True,
        )

    # ODAK İRSALİYE NO'DA OLMALI. Sahada ölçüldü: başka bir alan seçiliyken F6
    # hiçbir şey yapmıyor — hata da vermiyor. Sessiz başarısızlık en kötüsü:
    # sürücü "yenilendi" sanıp sıradaki işi DOLU formun üstüne yazardı.
    #
    # DOĞRULAMA PENCERE KOORDİNATIYLA YAPILIR, MDI'yle DEĞİL.
    #
    # Sahada ölçüldü (HE20097): işin BAŞINDAKİ F6 çalıştı, gönderim
    # SONRASINDAKİ çalışmadı ve odak "mdi (1334, 664) — tanınmayan alan" diye
    # raporlandı. Sebep, gönderimden sonra odağın BAŞKA BİR MDI BELGESİNE
    # düşmesi: o belgeye göre hesaplanan konum alan haritasıyla hiç örtüşmüyor,
    # dolayısıyla doğru yere tıklanmış olsa bile "yanlış alan" görünüyor.
    #
    # Tıklamayı zaten ANA PENCEREYE göre yapıyoruz; doğrulamayı da aynı
    # düzlemde yapmak tek tutarlı seçim.
    def irsaliye_noda_mi(odak_bilgisi: dict) -> bool:
        return konum_eslesiyor(odak_bilgisi["pencere_ici"], IRSALIYE_NO_PENCERE_KONUMU)

    o = ui60.odak()
    if not o["hwnd"] or not irsaliye_noda_mi(o):
        ui60.pencere_noktasina_tikla(ana_pencere, IRSALIYE_NO_PENCERE_KONUMU)
        o = ui60.odak()

    # ODAK HAPSOLMUŞ OLABİLİR.
    #
    # Sahada ölçüldü: tıklamaya rağmen odak Cari Kodu'nda kaldı
    # (pencere (123,132) / mdi (117,101)). Forms, doğrulaması tamamlanmamış bir
    # alandan çıkışa izin vermiyor; önceki iş yarıda kaldıysa form bu durumda
    # kalıyor ve tıklamak odağı taşımıyor.
    #
    # ESC alandaki bekleyen düzenlemeyi iptal eder ve kilidi çözer. Yazma
    # yapmıyor, yalnızca yarım kalmış girdiyi geri alıyor — güvenli.
    if not irsaliye_noda_mi(o):
        log.append(
            f"odak {o['pencere_ici']} konumunda takıldı; ESC ile serbest bırakılıyor"
        )
        try:
            ui60.tus("ESC", bekle_ms=400)
        except Exception as exc:
            log.append(f"ESC gönderilemedi: {exc}")
        ui60.pencere_noktasina_tikla(ana_pencere, IRSALIYE_NO_PENCERE_KONUMU)
        o = ui60.odak()

    if not o["hwnd"]:
        raise FormTemizlenemedi(
            "Form yenilenemedi: İrsaliye No alanına tıklandı ama odak alınamadı.",
            retryable=True,
        )
    if not irsaliye_noda_mi(o):
        # F6'ya burada basmak sessizce hiçbir şey yapmaz; tahminle devam etmek
        # yerine duruyoruz. Her iki koordinat da yazılıyor: hangi düzlemde
        # sapma olduğu bir dahaki teşhiste doğrudan görünsün.
        raise FormTemizlenemedi(
            f"Form yenilenemedi: F6 için odak İrsaliye No'da olmalı "
            f"(pencere {IRSALIYE_NO_PENCERE_KONUMU}), odak pencere "
            f"{o['pencere_ici']} / mdi {o['mdi_ici']} konumunda kaldı.",
            retryable=True,
        )

    # SONUCU DOĞRULA, MEKANİZMAYI DEĞİL.
    #
    # Sahada: imleç İrsaliye No'ya gidiyor, odak doğrulaması geçiyor, F6
    # gönderiliyor — ama form temizlenmiyor. Yani "F6'ya bastım" ile "form
    # yenilendi" aynı şey değil ve şimdiye kadar birincisini ikincisi sanıyorduk.
    #
    # Tek güvenilir ölçü alanın kendisi: temizlenmişse İrsaliye No BOŞALIR.
    # Gönderimden hemen sonra uygulama hâlâ meşgul olabildiği için birkaç kez,
    # aralarını açarak deneniyor.
    # "OKUYAMADIM" İLE "DOLU" AYNI ŞEY DEĞİL.
    #
    # Sahada BOŞ formda 'DC10095' okundu: odaktaki kontrol park edilmiş bir
    # Edit'ti ve en son düzenlediği değeri taşıyordu (ayrıntı
    # `ui60.canli_alan_mi`). Konum denetimi geçtiği için sürücü bunu "form
    # temizlenmedi" sandı, kuyruğu durdurdu ve temiz bir formu üç kez kirli ilan
    # etti. Bu yüzden yalnızca GÜVENİLİR okumalar karar verir.
    guvenilir_kalan: str | None = None
    for deneme in range(1, 4):
        # F6'NIN F6 OLARAK VARDIĞINI GARANTİ ET.
        #
        # Basılı kalmış bir CTRL, gönderdiğimiz F6'yı pencere menüsündeki
        # "İleri Ctrl+F6" komutuna — yani BELGE DEĞİŞTİRMEYE — çevirir. Bu,
        # sahada ölçülen "F6'dan sonra odak başka bir MDI belgesine düştü, form
        # temizlenmedi" tablosunun birebir açıklaması. Ayrıntı:
        # `ui60.degistiricileri_birak`.
        birakilan = ui60.degistiricileri_birak()
        if birakilan:
            log.append(
                f"F6 {deneme}. deneme: {'+'.join(birakilan)} BASILI KALMIŞTI, "
                "bırakıldı — bu tuşlar basılıyken F6 başka bir komuta dönüşür"
            )

        # Belgeyi F6'dan ÖNCE not al: F6 sonrası belge değiştiyse tuş
        # "temizle" değil "İleri" olarak işlenmiş demektir ve bu, hatanın
        # sebebini ekran görüntüsüne bakmadan söyleyen tek sinyal.
        onceki_belge = (o.get("mdi"), o.get("mdi_baslik"))

        ui60.tus("F6", bekle_ms=1200 * deneme)

        o = ui60.odak()
        if (o.get("mdi"), o.get("mdi_baslik")) != onceki_belge:
            log.append(
                f"F6 {deneme}. deneme: ETKİN MDI BELGESİ DEĞİŞTİ "
                f"({onceki_belge[1]!r} → {o.get('mdi_baslik')!r}). F6 'temizle' "
                "olarak değil belge değiştirme olarak işlenmiş olabilir."
            )

        if not irsaliye_noda_mi(o):
            # F6 odağı taşımış olabilir; okumak için geri dön.
            ui60.pencere_noktasina_tikla(ana_pencere, IRSALIYE_NO_PENCERE_KONUMU)
            o = ui60.odak()

        # TIKLAMADAN SONRA KONUMU YENİDEN DOĞRULA.
        #
        # Forms doğrulaması tamamlanmamış bir alandan çıkışa izin vermiyor;
        # tıklamak odağı taşımayabilir. O durumda elimizdeki CANLI Edit BAŞKA
        # BİR ALANA aittir ve onun değerini "İrsaliye No dolu" diye okumak,
        # park edilmiş Edit hatasının aynısıdır — sadece kılık değiştirmiş hâli.
        if not irsaliye_noda_mi(o):
            log.append(
                f"F6 {deneme}. deneme: okuma yapılmadı — odak İrsaliye No'ya "
                f"dönmedi, pencere {o['pencere_ici']} konumunda kaldı"
            )
            continue

        if not o["canli"]:
            l, t, r, b = o["rect"]
            log.append(
                f"F6 {deneme}. deneme: alan OKUNAMADI — odak {o['sinif']!r} "
                f"({r - l}×{b - t} px, "
                f"{'görünür' if o['gorunur'] else 'GİZLİ'}). "
                f"Park edilmiş Edit'in metni "
                f"({(o.get('deger') or '')!r}) alanın değeri DEĞİL, "
                "bu okuma yok sayılıyor."
            )
            continue

        guvenilir_kalan = (o.get("deger") or "").strip()
        if not guvenilir_kalan:
            log.append(
                f"F6 ile form yenilendi ({sebep}; {deneme}. denemede, "
                "İrsaliye No boşaldı)"
            )
            return

        log.append(
            f"F6 {deneme}. deneme: form temizlenmedi, "
            f"İrsaliye No hâlâ {guvenilir_kalan!r}"
        )

    if guvenilir_kalan is None:
        # HİÇBİR GÜVENİLİR ÖLÇÜM YAPILAMADI. Formun temiz olup olmadığını
        # bilmiyoruz — ve BİLMEMEK, KİRLİ OLMAK DEĞİL. İşi burada durdurmak,
        # sahada olan şeydi: temiz form, duran kuyruk, haksız yere `failed`
        # işler.
        #
        # Devam etmek güvenli, çünkü asıl emniyet ağı bu proxy değil: her alan
        # yazıldıktan sonra GERİ OKUNUYOR, alandan çıkılamazsa (`ilerle`) iş
        # duruyor ve işlenmiş bir kayıt üstüne yazmaya çalışmak tam olarak bu
        # şekilde yakalanıyor. F6 denetimi ek bir güvenceydi; ölçülemediğinde
        # tek başına işi düşürmemeli.
        log.append(
            "F6 sonucu ölçülemedi (üç denemede de alan okunamadı); işe devam "
            "ediliyor — her alan yazımdan sonra geri okunarak doğrulanacak."
        )
        return

    # F6 REDDEDİLDİ — ÖLÇÜLDÜ, TAHMİN DEĞİL. İKİNCİ YOLA GEÇ.
    #
    # Buraya yalnızca GÜVENİLİR bir okuma alanı dolu bulduğunda geliniyor.
    # Tuşun neden yutulduğu ekrandan okunamıyor (mesaj satırı tuvale çizili).
    # Menü ise okunabilir: maddenin yazısı da etkin olup olmadığı da API'den
    # geliyor.
    if menu_ile_yenile(ana_pencere, log, sebep):
        return

    raise FormTemizlenemedi(
        f"Form yenilenemedi ({sebep}): F6 formu temizlemedi (3 deneme) ve "
        f"menüden de boşaltılamadı; İrsaliye No alanında {guvenilir_kalan!r} "
        f"kaldı. Odak doğru alandaydı ve okuma güvenilirdi (görünür, boyutlu "
        f"Edit), yani alan gerçekten dolu. {menu_ozeti(ana_pencere)} "
        "F6'nın neden yutulduğu ekrandan okunamıyor; "
        "`python probe_f6.py` ile elle basılan F6 ile karşılaştırın.",
        retryable=True,
    )


def menu_ozeti(ana_pencere: int) -> str:
    """Menü çubuğunun teşhis özeti.

    F6 tıkandığında en çok ihtiyaç duyulan bilgi "bu formda formu boşaltan ne
    var" sorusunun cevabı ve o cevap şimdiye kadar yalnızca ekran
    görüntüsünden, gözle çıkarılabiliyordu. Hata mesajının içine konuyor:
    operatörün elindeki tek çıktı worker log'u.
    """
    try:
        maddeler = ui60.menu_agaci(ana_pencere)
    except Exception as exc:
        return f"Menü okunamadı: {exc}"
    if not maddeler:
        return "Pencerenin Windows menü çubuğu yok; ikinci yol mevcut değil."
    etkin = [m["yol"] for m in maddeler if m["etkin"]]
    return (
        f"Menüde {len(maddeler)} madde var, {len(etkin)} tanesi etkin: "
        + ", ".join(etkin[:25])
        + ("…" if len(etkin) > 25 else "")
    )


def menu_ile_yenile(ana_pencere: int, log: list[str], sebep: str) -> bool:
    """Formu menüden boşaltmayı dener. Başardıysa True.

    Sonuç yine ALANDAN doğrulanıyor: menü maddesini tetiklemiş olmak formun
    boşaldığı anlamına gelmez — F6'da tam olarak bu hataya düşmüştük.
    """
    madde = ui60.menu_komutu_bul(ana_pencere, FORM_YENILE_MENU_DESENI)
    if not madde:
        log.append("menü: formu boşaltan etkin bir madde bulunamadı")
        return False

    log.append(f"menü: {madde['yol']!r} maddesi tetikleniyor (F6 reddedildi)")
    ui60.menu_komutu_gonder(ana_pencere, madde["id"])
    time.sleep(1.5)

    # MENÜ BİR PENCERE AÇTIYSA DOKUNMA.
    #
    # "Değişiklikleri kaydetmek istiyor musunuz?" tipi bir soruya körlemesine
    # Tamam demek muhasebeye kayıt yazabilir. Onaylamak da iptal etmek de
    # operatörün kararı; sürücü yalnızca durumu bildirir.
    if ui60.lov_acik_mi(ana_pencere):
        log.append(
            "menü: madde tetiklendikten sonra bir pencere açıldı; içeriği "
            "okunamadığı için dokunulmadı — ekranda kalan pencere elle "
            "kapatılmalı"
        )
        return False

    ui60.pencere_noktasina_tikla(ana_pencere, IRSALIYE_NO_PENCERE_KONUMU)
    o = ui60.odak()
    if not o["canli"]:
        # Park edilmiş Edit okundu; "boşaldı" da "boşalmadı" da denemez.
        log.append("menü: sonuç ölçülemedi, alan okunamadı (canlı Edit değil)")
        return False
    kalan = (o.get("deger") or "").strip()
    if kalan:
        log.append(f"menü: form temizlenmedi, İrsaliye No hâlâ {kalan!r}")
        return False

    log.append(f"menü ile form yenilendi ({sebep}; {madde['yol']!r})")
    return True


def aciklama_kanidini_oku(ana_pencere: int, log: list[str]) -> str:
    """Açıklamanın 2-3. satırlarını okur — gönderimin uygulama tarafından
    yazılmış kanıtı.

    Operatör ölçüsü: bu satırlara irsaliye bilgileri geldiğinde irsaliye kesin
    kesilmiştir. Bizim yazdığımız bir değer değil, UYGULAMANIN yazdığı — bu
    yüzden ekrandan okunabilen en güçlü doğrulama.

    ASLA THROW ETMEZ. Gönderim geri alınamaz; kanıt okunamadı diye işi
    başarısız saymak, gerçekleşmiş bir gönderimi tekrar denemeye yol açardı.
    """
    satirlar: list[str] = []
    try:
        for aralik in ACIKLAMA_SATIR_ARALIK_ADAYLARI:
            for satir_no in (2, 3):
                nokta = (
                    ACIKLAMA_PENCERE_KONUMU[0],
                    ACIKLAMA_PENCERE_KONUMU[1] + aralik * (satir_no - 1),
                )
                try:
                    ui60.pencere_noktasina_tikla(ana_pencere, nokta, bekle_ms=200)
                except Exception:
                    continue
                o = ui60.odak()
                # PARK EDİLMİŞ EDIT BURADA EN TEHLİKELİ.
                #
                # Bu okuma "irsaliye kesin kesildi" kanıtı olarak kullanılıyor.
                # Park edilmiş bir Edit en son düzenlediği değeri taşıyor — yani
                # BİZİM az önce yazdığımız açıklamayı ya da stok kodunu. Onu
                # uygulamanın yazdığı kanıt sanmak, gönderilmemiş bir irsaliyeyi
                # "kanıtlanmış" ilan etmek olurdu. Sahte kanıt, kanıtsızlıktan
                # çok daha kötü.
                if not o["canli"]:
                    continue
                deger = (o.get("deger") or "").strip()
                if deger:
                    satirlar.append(f"aralık {aralik}px satır {satir_no}: {deger!r}")
            if satirlar:
                # Bu aralık okunabilir değer verdi; diğerlerini denemeye gerek yok.
                break
    except Exception as exc:
        log.append(f"gönderim kanıtı okunamadı: {exc}")
        return ""

    return " | ".join(satirlar)


def gonder_butonunu_dogrula(ana_pencere: int, log: list[str]) -> int:
    """E-İRSALİYE GÖNDER butonunu yazısından bulur; tıklamaz."""
    gonder = ui60.buton_bul(ana_pencere, "E-IRSALIYE GÖNDER")
    if not gonder:
        raise Durdu("E-İRSALİYE GÖNDER butonu bulunamadı.", retryable=True)
    if ui60.sinif_adi(gonder) != "Button":
        raise Durdu(
            "E-İRSALİYE GÖNDER eşleşmesi bir Button kontrolü değil; "
            "tıklanmayacak."
        )
    metin = ui60.pencere_metni(gonder)
    rect = ui60.dikdortgen(gonder)
    log.append(f"gonder: buton bulundu ve doğrulandı ({metin!r}, rect {rect})")
    return gonder


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controls", required=False,
                        help="Geriye dönük uyumluluk; konumlar artık kodda ölçülmüş.")
    parser.add_argument("--sevk-adresi-yok", action="store_true",
                        help="Sevk Adresi alanına hiç dokunma. Alan forma yazılan "
                             "en yeni alan; sahada sorun çıkarırsa bu bayrakla "
                             "kapatılır ve otomasyon geri kalanıyla sürer.")
    parser.add_argument("--f6-yenileme-yok", action="store_true",
                        help="Formu F6 ile yenileme. Varsayılan: işin başında ve "
                             "gönderim sonrası F6 basılır, böylece sıradaki iş "
                             "temiz forma yazar.")
    parser.add_argument("--gercek", action="store_true",
                        help="E-İRSALİYE GÖNDER'e bas. Verilmezse form doldurulur "
                             "ve doğrulanır ama GÖNDERİLMEZ.")
    parser.add_argument("--pencere", default="CEOMED")
    parser.add_argument("--tani", action="store_true",
                        help="Hiçbir şey yazmadan odağın konumunu bildir. "
                             "Konum tablosu formun bu kurulumunda kaymışsa "
                             "gerçek değerleri öğrenmek için.")
    parser.add_argument(
        "--miktar-uyarisini-onayla",
        action="store_true",
        help="Miktar alanından çıkışta açılan uyarıyı Tamam ile onayla. "
             "Yalnızca ekran görüntüsündeki uyarının kabul edilebilir olduğu "
             "operatör tarafından doğrulandıysa kullanılmalıdır.",
    )
    parser.add_argument("--goruntu-dizini", default=os.environ.get(
        "ORACLE_SCREENSHOT_DIR", os.path.join(os.path.dirname(__file__), "goruntuler")))
    args = parser.parse_args()

    if not sys.platform.startswith("win"):
        return fail("Bu betik yalnızca Windows'ta çalışır.", retryable=False)

    # Sınıf filtresi ZORUNLU. Yalnızca başlığa bakmak, adında "ceomed" geçen
    # her pencereyi (Dosya Gezgini klasörü, worker'ın konsolu, bir Not Defteri)
    # aday yapıyor ve otomasyon "2 Ceomed penceresi eşleşti" diyip duruyordu.
    # Gerçek Oracle Forms ana penceresinin sınıfı ui60MDIroot_W32'dir.
    pencereler = ui60.pencere_bul(args.pencere, sinif=ui60.MDI_KOK_SINIFI)
    if not pencereler:
        # Sınıf filtresi yüzünden mi eleniyor, yoksa uygulama kapalı mı?
        # İkisi çok farklı düzeltmeler gerektiriyor; ayırt edilebilir olmalı.
        filtresiz = ui60.pencere_bul(args.pencere)
        if filtresiz:
            return fail(
                f"'{args.pencere}' başlığıyla {len(filtresiz)} pencere var ama hiçbiri "
                f"Oracle Forms penceresi değil (beklenen sınıf {ui60.MDI_KOK_SINIFI}, "
                f"bulunanlar: {', '.join(repr(ui60.sinif_adi(h)) for h in filtresiz)}). "
                "Ceomed masaüstü uygulaması açık mı?",
                retryable=True,
            )
        return fail(
            f"'{args.pencere}' başlıklı Ceomed penceresi açık değil. "
            "Uygulamaya giriş yapıp Çıkış İrsaliyesi formunu açın.",
            retryable=True,
        )
    if len(pencereler) > 1:
        # Belirsizlik tahminle kapatılmaz: yanlış pencereye yazmak geri alınamaz.
        return fail(
            f"{len(pencereler)} Ceomed penceresi eşleşti "
            f"({', '.join(repr(ui60.baslik(h)[:60]) for h in pencereler)}). "
            "Fazla Ceomed penceresini kapatın.",
            retryable=True,
        )

    ana = pencereler[0]
    # Bundan sonra tuşlar YALNIZCA Ceomed sürecine gidebilir. Sahada odak
    # Chrome'a kaydı ve irsaliye numarası tarayıcıya yazıldı.
    ui60.hedef_pencere_ayarla(ana)
    if not ui60.one_getir(ana):
        # Küçültülmüş pencere artık one_getir içinde geri yükleniyor; geriye
        # kalan sebepler operatörün kontrol edebileceği şeyler.
        return fail(
            "Ceomed penceresi öne getirilemedi. Olası sebepler: oturum kilitli "
            "(kilitli oturumda tuş vuruşları hedefine ulaşmaz), ekranda kapatılmayı "
            "bekleyen bir kip pencere var, ya da makinede o anda başka bir uygulama "
            "kullanılıyor.",
            retryable=True,
        )

    if args.tani:
        o = ui60.odak()
        return emit({
            "ok": True,
            "tani": True,
            "sinif": o["sinif"],
            "deger": o["deger"],
            "mdi_ici": list(o["mdi_ici"]),
            "pencere_ici": list(o["pencere_ici"]),
            "mdi_baslik": o["mdi_baslik"],
            "taninan_alan": alan_adi(o["mdi_ici"]),
            "taninan_grid_alani": alan_adi(o["mdi_ici"], grid_modu=True),
            # `canli` false ise `deger` HAKKINDA HİÇBİR ŞEY SÖYLENEMEZ: odaktaki
            # kontrol park edilmiş bir Edit ve eski değerini taşıyor. Sahada boş
            # formda 'DC10095' okunmasının sebebi buydu.
            "canli": o["canli"],
            "rect": list(o["rect"]),
            # MENÜ: "formu ne boşaltıyor" sorusunun cevabı. F6 sahada reddedildi
            # ve tuşun neden yutulduğu ekrandan okunamıyor; menü maddeleri ise
            # yazısıyla ve etkin/pasif durumuyla okunabiliyor. Tanı modunda
            # basılıyor ki bu soru tek komutla, ekrana bakmadan cevaplanabilsin.
            "menu": ui60.menu_agaci(ana),
            "menu_form_yenile_adayi": ui60.menu_komutu_bul(
                ana, FORM_YENILE_MENU_DESENI),
            "not": "Hiçbir şey yazılmadı. 'mdi_ici' beklenen konumla "
                   "eşleşmiyorsa ALAN_KONUMLARI güncellenmeli.",
        })

    # Tanı modu salt-okunurdur ve stdin istemez. JSON'u bundan sonra okumak,
    # `python fill_irsaliye.py --tani` komutunun PowerShell'de girdiyi sonsuza
    # kadar beklemesini engeller.
    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        return fail(f"stdin JSON okunamadı: {exc}", retryable=True)

    job = payload.get("job") or {}
    job_id = str(payload.get("jobId") or "job")
    header = job.get("header") or {}
    rows = job.get("rows") or []

    if not rows:
        return fail("İşte yazılacak satır yok.", retryable=False)

    log: list[str] = []
    goruntu = None

    try:
        # Önceki iş formu kayıt bilgileriyle ekranda bırakmış olabilir; F6 temiz
        # sayfa getirir. Operatörün her seferinde elle boş form açması gerekmesin.
        if not args.f6_yenileme_yok:
            form_yenile(ana, log, "işe başlamadan önce temiz form")

        # Ceomed odağı ve önceki numarayı koruyabiliyor. Kullanıcıya elle
        # sildirmek yerine odağı kur; alan_yaz mevcut değeri temizleyecek.
        irsaliye_numarasina_git(log)

        degerler = {
            "irsaliyeNo": str(header.get("irsaliyeNo") or ""),
            "tarih": str(header.get("tarih") or ""),
            "cariKodu": str(header.get("cariKodu") or ""),
            # Boşsa baslik_doldur alana dokunmaz; ek hizmet binası olmayan
            # laboratuvarlarda bu alan boş kalmaya devam eder.
            "sevkAdresi": "" if args.sevk_adresi_yok else str(header.get("sevkAdresi") or ""),
            "islemTipi": str(header.get("islemTipi") or ""),
            "depo": str(header.get("depo") or ""),
        }
        baslik_doldur(degerler, ana, log)

        for i, satir in enumerate(rows, start=1):
            log.append(f"--- satır {i}/{len(rows)} ---")
            satir_doldur(satir, ana, log,
                         miktar_uyarisini_onayla=args.miktar_uyarisini_onayla)
            if i < len(rows):
                ilerle(f"satır {i} sonu")

        aciklama_doldur(
            str(job.get("aciklama") or ""),
            ana,
            log,
            miktar_uyarisini_onayla=args.miktar_uyarisini_onayla,
        )

        # Kuru prova da kapanış kontrolünü kapsamalı: butonun ancak gerçek
        # modda aranması, saha provası geçtiği halde ilk canlı işte tıkanabilir.
        gonder = gonder_butonunu_dogrula(ana, log)

        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-dolu")

        if not args.gercek:
            return emit({
                "ok": True,
                "kuru": True,
                "screenshotPath": goruntu,
                "log": log,
                "not": "Form dolduruldu ve doğrulandı; E-İRSALİYE GÖNDER'e "
                       "BASILMADI. Gerçek gönderim için --gercek gerekir.",
            })

        ui60.user32.SendMessageW(gonder, ui60.BM_CLICK, 0, 0)
        time.sleep(2.0)
        # Görüntü F6'DAN ÖNCE alınır: gönderim sonrası forma yazılan irsaliye
        # kayıt bilgileri gönderimin kanıtıdır, F6 onları siler.
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-gonderildi")

        # GÖNDERİM KANITI — okumaya çalış, ASLA işi düşürme.
        # E-irsaliye zaten gönderildi; buradaki bir hata gönderimi geri almaz.
        kanit = aciklama_kanidini_oku(ana, log)
        if kanit:
            log.append(f"gönderim kanıtı: {kanit}")

        # E-irsaliye GÖNDERİLDİ. Buradan sonraki hiçbir hata işi başarısız
        # saymamalı — gönderim geri alınamaz, tekrar denenirse mükerrer olur.
        yenileme_notu = None
        if not args.f6_yenileme_yok:
            try:
                form_yenile(ana, log, "gönderim sonrası, sıradaki iş için")
            except Exception as exc:
                yenileme_notu = (
                    f"Gönderim başarılı ama form F6 ile yenilenemedi: {exc}. "
                    "Sıradaki işten önce Ceomed'de yeni boş form açın."
                )
                log.append(yenileme_notu)

        sonuc = {
            "ok": True,
            "ceomedIrsaliyeNo": degerler["irsaliyeNo"],
            "screenshotPath": goruntu,
            "log": log,
        }
        if yenileme_notu:
            sonuc["uyari"] = yenileme_notu
            # BU İŞ BAŞARILI, EKRAN DEĞİL. Form dolu kaldı; sıradaki iş onun
            # üstüne yazmaya çalışıp başarısız olur ve suç ona yazılır. Bayrağı
            # burada taşımak, worker'ın kuyruğu durdurup formu boşaltılmayı
            # beklemesini sağlıyor.
            sonuc["formKirli"] = True
        return emit(sonuc)

    except ui60.YanlisPencere as exc:
        # YENİDEN DENENEBİLİR: makinede biri başka bir uygulamaya geçmiş, form
        # bozulmamış olabilir. Sürücü tuş göndermeden durduğu için Ceomed'e
        # yanlış bir şey yazılmadı. Bir sonraki turda Ceomed öne alınıp
        # baştan denenir.
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-yanlis-pencere")
        return fail(
            f"{exc} Ceomed makinesinde otomasyon çalışırken başka uygulama "
            "kullanılmamalı; tuş vuruşları ön plandaki pencereye gider.",
            retryable=True, screenshot=goruntu, log=log,
        )
    except ui60.TehlikeliOdak as exc:
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-tehlikeli")
        return fail(f"Güvenlik durdurması: {exc}", retryable=False, screenshot=goruntu, log=log)
    except (Durdu, ui60.AlanReddedildi) as exc:
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-hata")
        retryable = getattr(exc, "retryable", False)
        return fail(str(exc), retryable=retryable, screenshot=goruntu, log=log,
                    form_kirli=isinstance(exc, FormTemizlenemedi))
    except Exception as exc:  # beklenmedik: sonucu belirsiz, yeniden denenmez
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-beklenmedik")
        return fail(
            f"Beklenmedik hata: {exc}. Gönderilip gönderilmediği bilinmiyor, "
            "körlemesine tekrar denenmeyecek.",
            retryable=False,
            screenshot=goruntu,
            log=log,
        )


if __name__ == "__main__":
    raise SystemExit(main())
