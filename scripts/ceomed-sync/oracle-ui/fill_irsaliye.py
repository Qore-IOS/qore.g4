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


# Ölçülmüş alan konumları — pencerenin sol üst köşesine GÖRE (ham ekran
# koordinatı değil: pencere taşınınca bozulmasın). Tutanak: ORACLE-IRSALIYE.md
ALAN_KONUMLARI: dict[str, tuple[int, int]] = {
    # Başlık
    "irsaliyeNo":      (123, 113),
    "tarih":           (246, 113),
    "fiiliSevkTarihi": (444, 110),
    "cariKodu":        (123, 132),
    "sevkAdresi":      (123, 174),
    "islemTipi":       (855, 149),
    "depo":            (855, 169),
    "teslimEden":      (855, 189),
    "teslimAlan":      (855, 209),
    "anlasmaNo":       (855, 229),
    # Grid ilk satır (y sabit; sonraki satırlarda y artar, eşleştirme x'e bakar)
    "stokKodu":        (14, 297),
    "lot":             (575, 297),
    "miat":            (649, 297),
    "kt":              (725, 297),
    "miktar":          (760, 297),
}

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


def fail(error: str, retryable: bool, screenshot: str | None = None) -> int:
    payload = {"ok": False, "error": error, "retryable": retryable}
    if screenshot:
        payload["screenshotPath"] = screenshot
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
        raise Durdu(
            f"{etiket} alanından çıkılamadı — uygulama değeri reddetti. "
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
    geri_donuldu = False

    if not konum_eslesiyor(o["pencere_ici"], hedef):
        # Forms ilerletmiş; okumak için geri dön.
        ui60.tus("SHIFTTAB", bekle_ms=450)
        o = ui60.odak()
        if not konum_eslesiyor(o["pencere_ici"], hedef):
            raise Durdu(
                f"{ad}: seçim sonrası alana geri dönülemedi "
                f"(odak {o['pencere_ici']}, beklenen {hedef}). "
                "Değer doğrulanamadığı için gönderim yapılmayacak."
            )
        geri_donuldu = True

    okunan = o["deger"]
    if okunan != deger:
        raise Durdu(
            f"{ad}: arama penceresinden {okunan!r} seçildi, beklenen {deger!r}. "
            "Liste okunamadığı için seçim körlemesine yapılıyor; uyuşmazlıkta "
            "gönderim yapılmaz."
        )
    log.append(f"{ad}: geri okundu, {okunan!r} doğrulandı")

    if geri_donuldu:
        # İleri dön. Alandan çıkış LOV'u yeniden açabilir; değer artık çözülmüş
        # olduğu için aynı satır seçilir.
        ui60.tus("ENTER", bekle_ms=600)
        if ui60.lov_acik_mi(ana_pencere) and not ui60.uyari_penceresi_mi(ana_pencere):
            ui60.lov_kabul_et(ana_pencere)
            time.sleep(0.4)


def baslik_doldur(degerler: dict[str, str], ana_pencere: int, log: list[str]) -> None:
    """Başlık alanlarını konumdan tanıyarak doldurur, grid'e varınca durur."""
    for _ in range(MAX_ADIM):
        o = ui60.odak()
        ad = alan_adi(o["pencere_ici"])

        if ad == "stokKodu":
            return  # grid'e ulaşıldı

        if ad and degerler.get(ad):
            if ad in LOV_ALANLARI:
                lov_ile_yaz(ad, degerler[ad], ana_pencere, log)
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


def satir_doldur(satir: dict, ana_pencere: int, log: list[str]) -> None:
    """Bir grid satırını doldurur: Stok Kodu → LOT → Miat → KT → Miktar."""
    hedefler = {
        "stokKodu": str(satir.get("stokKodu") or ""),
        "lot": str(satir.get("lot") or ""),
        "miat": str(satir.get("miad") or ""),
        "kt": "",  # dokunulmuyor
        "miktar": str(satir.get("miktar") or ""),
    }

    for beklenen_sutun in GRID_SIRASI:
        o = ui60.odak()
        ad = alan_adi(o["pencere_ici"], grid_modu=True)
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

        if beklenen_sutun != GRID_SIRASI[-1]:
            ilerle(beklenen_sutun)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controls", required=False,
                        help="Geriye dönük uyumluluk; konumlar artık kodda ölçülmüş.")
    parser.add_argument("--gercek", action="store_true",
                        help="E-İRSALİYE GÖNDER'e bas. Verilmezse form doldurulur "
                             "ve doğrulanır ama GÖNDERİLMEZ.")
    parser.add_argument("--pencere", default="CEOMED")
    parser.add_argument("--goruntu-dizini", default=os.environ.get(
        "ORACLE_SCREENSHOT_DIR", os.path.join(os.path.dirname(__file__), "goruntuler")))
    args = parser.parse_args()

    if not sys.platform.startswith("win"):
        return fail("Bu betik yalnızca Windows'ta çalışır.", retryable=False)

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

    log: list[str] = []
    goruntu = None

    try:
        # Formun YENİ ve BOŞ olduğunu doğrula: odak İrsaliye No'da olmalı.
        o = ui60.odak()
        if alan_adi(o["pencere_ici"]) != "irsaliyeNo":
            raise Durdu(
                f"Form yeni/boş görünmüyor — odak {o['pencere_ici']} konumunda, "
                "İrsaliye No bekleniyordu. Yarım kalmış bir forma yazmamak için "
                "durduruldu.",
                retryable=True,
            )

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
        return fail(f"Güvenlik durdurması: {exc}", retryable=False, screenshot=goruntu)
    except (Durdu, ui60.AlanReddedildi) as exc:
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-hata")
        retryable = getattr(exc, "retryable", False)
        return fail(str(exc), retryable=retryable, screenshot=goruntu)
    except Exception as exc:  # beklenmedik: sonucu belirsiz, yeniden denenmez
        goruntu = ui60.ekran_goruntusu(ana, args.goruntu_dizini, f"{job_id}-beklenmedik")
        return fail(
            f"Beklenmedik hata: {exc}. Gönderilip gönderilmediği bilinmiyor, "
            "körlemesine tekrar denenmeyecek.",
            retryable=False,
            screenshot=goruntu,
        )


if __name__ == "__main__":
    raise SystemExit(main())
