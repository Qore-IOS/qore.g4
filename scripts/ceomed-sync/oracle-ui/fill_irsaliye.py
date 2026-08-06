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
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ui60  # noqa: E402


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
# Prova loglarında ilk Stok Kodu Edit'i ana pencereye göre tutarlı olarak
# (14, 297) konumunda ölçüldü. Başlık ile grid de farklı iç MDI köklerine
# bağlanabildiği için bölgeler arası geçişte bu karşılık kullanılır.
STOK_KODU_PENCERE_KONUMU = (14, 297)

KONUM_TOLERANS = 18

# Bu alanlardan çıkışta Forms bir LOV (arama) penceresi açar. Filtre alanı
# yazdığımız değer + '%' olarak kendiliğinden dolar; ENTER seçili satırı kabul
# eder. Liste çizilmiş olduğu için OKUNAMAZ — pencere kapandıktan sonra alanı
# geri okumak tek güvencedir.
LOV_ALANLARI = {"cariKodu", "depo", "stokKodu"}

# Grid satırındaki sütunlar, ENTER ile gezilen sırada.
GRID_SIRASI = ["stokKodu", "lot", "miat", "kt", "miktar"]

MAX_ADIM = 60  # sonsuz döngü koruması


def emit(payload: dict) -> int:
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    return 0 if payload.get("ok") else 1


def fail(error: str, retryable: bool, screenshot: str | None = None,
         log: list[str] | None = None) -> int:
    """Hata sonucu. `log` HER ZAMAN eklenir: bir kuru çalışma tıkandığında
    'nerede durdu' sorusunun cevabı adım geçmişindedir, ekran görüntüsü tek
    başına yetmez."""
    payload = {"ok": False, "error": error, "retryable": retryable}
    if screenshot:
        payload["screenshotPath"] = screenshot
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

        if ad and degerler.get(ad):
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


def satir_doldur(satir: dict, ana_pencere: int, log: list[str]) -> None:
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
    hedef = ALAN_KONUMLARI["aciklama"]
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

    ui60.alan_yaz(deger.strip(), "aciklama")
    log.append(f"aciklama: {deger.strip()!r} yazıldı ve geri okundu")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controls", required=False,
                        help="Geriye dönük uyumluluk; konumlar artık kodda ölçülmüş.")
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

    pencereler = ui60.pencere_bul(args.pencere)
    if not pencereler:
        return fail(
            f"'{args.pencere}' başlıklı Ceomed penceresi açık değil. "
            "Uygulamaya giriş yapıp Çıkış İrsaliyesi formunu açın.",
            retryable=True,
        )
    if len(pencereler) > 1:
        # Belirsizlik tahminle kapatılmaz: yanlış pencereye yazmak geri alınamaz.
        return fail(
            f"{len(pencereler)} pencere '{args.pencere}' ile eşleşti. "
            "Fazla Ceomed penceresini kapatın.",
            retryable=True,
        )

    ana = pencereler[0]
    if not ui60.one_getir(ana):
        return fail("Ceomed penceresi öne getirilemedi (oturum kilitli olabilir).",
                    retryable=True)

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
        # Ceomed odağı ve önceki numarayı koruyabiliyor. Kullanıcıya elle
        # sildirmek yerine odağı kur; alan_yaz mevcut değeri temizleyecek.
        irsaliye_numarasina_git(log)

        degerler = {
            "irsaliyeNo": str(header.get("irsaliyeNo") or ""),
            "tarih": str(header.get("tarih") or ""),
            "cariKodu": str(header.get("cariKodu") or ""),
            "islemTipi": str(header.get("islemTipi") or ""),
            "depo": str(header.get("depo") or ""),
        }
        baslik_doldur(degerler, ana, log)

        for i, satir in enumerate(rows, start=1):
            log.append(f"--- satır {i}/{len(rows)} ---")
            satir_doldur(satir, ana, log)
            if i < len(rows):
                ilerle(f"satır {i} sonu")

        aciklama_doldur(
            str(job.get("aciklama") or ""),
            ana,
            log,
            miktar_uyarisini_onayla=args.miktar_uyarisini_onayla,
        )

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

        gonder = ui60.buton_bul(ana, "E-IRSALIYE GÖNDER")
        if not gonder:
            raise Durdu("E-İRSALİYE GÖNDER butonu bulunamadı.", retryable=True)

        ui60.user32.SendMessageW(gonder, ui60.BM_CLICK, 0, 0)
        time.sleep(2.0)
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-gonderildi")

        return emit({
            "ok": True,
            "ceomedIrsaliyeNo": degerler["irsaliyeNo"],
            "screenshotPath": goruntu,
            "log": log,
        })

    except ui60.TehlikeliOdak as exc:
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-tehlikeli")
        return fail(f"Güvenlik durdurması: {exc}", retryable=False, screenshot=goruntu, log=log)
    except (Durdu, ui60.AlanReddedildi) as exc:
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-hata")
        retryable = getattr(exc, "retryable", False)
        return fail(str(exc), retryable=retryable, screenshot=goruntu, log=log)
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
