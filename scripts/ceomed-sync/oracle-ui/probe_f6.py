"""F6 neden yutuluyor? Sentetik F6 ile ELLE basılan F6'yı yan yana ölçer.

NEDEN BU PROB VAR: sürücü "F6 formu temizlemedi" diyor, operatör ise aynı formda
elle F6'ya basınca formun temizlendiğini söylüyor. İkisi de doğruysa fark
tuşun KENDİSİNDE değil, tuşun NASIL GÖNDERİLDİĞİNDE. İkisi de aynı formda
başarısız oluyorsa fark FORMUN DURUMUNDA. Bu iki ihtimal birbirini dışlıyor ve
şimdiye kadar hiçbir log ikisini ayırt edemedi — hata mesajları formun alt
mesaj satırına ÇİZİLDİĞİ için okunamıyor, teşhis ekran görüntüsüne kalıyordu.

Bu prob o ayrımı yapar ve cevabı düz metin olarak yazar.

ÖLÇÜLEN ŞEYLER (her F6'dan önce ve sonra):
  * İrsaliye No alanının değeri — formun temizlenip temizlenmediğinin tek
    güvenilir ölçüsü.
  * Odaktaki kontrolün sınıfı, boyutu ve GÖRÜNÜRLÜĞÜ — park edilmiş bir Edit
    eski değerini taşımaya devam ettiği için okumanın geçerli olup olmadığı.
  * Etkin MDI belgesi — pencere menüsünde "İleri Ctrl+F6" maddesi var; belge
    değiştiyse tuş "temizle" olarak değil "sonraki belge" olarak işlenmiştir.
  * Basılı değiştirici tuşlar — basılı kalmış bir CTRL/SHIFT, F6'yı sessizce
    başka bir komuta çevirir.
  * Yeni açılan pencere — Forms "kaydedilmemiş değişiklikler" uyarısı açıp
    temizlemeyi reddediyor olabilir.

BU PROB TEK BİR ŞEY YAZAR: F6. Alanlara hiçbir şey yazmaz, hiçbir menü maddesi
tetiklemez, hiçbir pencereyi kapatmaz. F6 zaten operatörün her irsaliyeden
sonra elle bastığı tuş.

Kullanım (Ceomed açık, TAKILI form ekranda — yani boşalmayan form):

    python probe_f6.py
    python probe_f6.py --json f6.json
"""
from __future__ import annotations

import argparse
import json
import sys

import ui60

# `fill_irsaliye.py` ile AYNI ölçüm. İkisi ayrışırsa prob sürücünün yaptığını
# değil başka bir şeyi ölçmüş olur ve karşılaştırma anlamını yitirir.
IRSALIYE_NO_PENCERE_KONUMU = (123, 113)
KONUM_TOLERANS = 18


def konum_eslesiyor(olculen: tuple[int, int], beklenen: tuple[int, int]) -> bool:
    return (abs(olculen[0] - beklenen[0]) <= KONUM_TOLERANS
            and abs(olculen[1] - beklenen[1]) <= KONUM_TOLERANS)


def durum(ana: int) -> dict:
    """Ölçülebilen her şeyin o andaki fotoğrafı."""
    o = ui60.odak()
    l, t, r, b = o["rect"]
    return {
        "odak_sinifi": o["sinif"],
        "odak_boyutu": f"{r - l}×{b - t}",
        "gorunur": o["gorunur"],
        "canli": o["canli"],
        "pencere_ici": o["pencere_ici"],
        "irsaliye_nodda_mi": konum_eslesiyor(o["pencere_ici"],
                                             IRSALIYE_NO_PENCERE_KONUMU),
        "deger": o["deger"],
        "mdi": o["mdi"],
        "mdi_baslik": o["mdi_baslik"],
        "basili_degistiriciler": ui60.basili_degistiriciler(),
        "acik_pencere_var": ui60.lov_acik_mi(ana),
    }


def yaz_durum(baslik: str, d: dict) -> None:
    print(f"\n  {baslik}")
    print(f"    odak            : {d['odak_sinifi']!r} {d['odak_boyutu']} px, "
          f"{'görünür' if d['gorunur'] else 'GİZLİ'}")
    print(f"    konum           : {d['pencere_ici']} "
          f"{'(İrsaliye No)' if d['irsaliye_nodda_mi'] else '← İRSALİYE NO DEĞİL'}")
    print(f"    okuma geçerli mi: {'EVET' if d['canli'] else 'HAYIR — değer yok sayılmalı'}")
    print(f"    alanın değeri   : {d['deger']!r}")
    print(f"    MDI belgesi     : {d['mdi_baslik']!r}")
    print(f"    basılı tuşlar   : {d['basili_degistiriciler'] or '(yok)'}")
    print(f"    açık pencere    : {'VAR' if d['acik_pencere_var'] else 'yok'}")


def temizlendi_mi(sonra: dict) -> bool | None:
    """True/False/None — None 'ölçemedim' demektir, 'temizlenmedi' DEĞİL."""
    if not sonra["canli"] or not sonra["irsaliye_nodda_mi"]:
        return None
    return not (sonra["deger"] or "").strip()


def sonuc_metni(temizlendi: bool | None) -> str:
    if temizlendi is None:
        return "ÖLÇÜLEMEDİ (okuma geçerli değildi)"
    return "FORM TEMİZLENDİ" if temizlendi else "form TEMİZLENMEDİ"


def irsaliye_noya_odaklan(ana: int) -> dict:
    d = durum(ana)
    if not d["irsaliye_nodda_mi"]:
        ui60.pencere_noktasina_tikla(ana, IRSALIYE_NO_PENCERE_KONUMU)
        d = durum(ana)
    return d


def main() -> int:
    p = argparse.ArgumentParser(description="F6 teşhis probu (yalnızca F6 gönderir)")
    p.add_argument("--json", dest="json_path", help="Ölçümleri bu dosyaya yaz")
    args = p.parse_args()

    if not sys.platform.startswith("win"):
        print("Bu betik yalnızca Windows'ta çalışır.", file=sys.stderr)
        return 2

    pencereler = ui60.pencere_bul("ceomed", sinif=ui60.MDI_KOK_SINIFI)
    if len(pencereler) != 1:
        print(f"Ceomed penceresi tek olarak bulunamadı ({len(pencereler)} eşleşme).",
              file=sys.stderr)
        return 2
    ana = pencereler[0]
    ui60.hedef_pencere_ayarla(ana)

    print("=" * 78)
    print("F6 TEŞHİS PROBU")
    print("=" * 78)
    print("Ceomed'de TAKILI form (boşalmayan, üstünde eski irsaliye duran form)")
    print("ekranda olmalı. Bu prob yalnızca F6 gönderir; hiçbir alana yazmaz.")

    maddeler = ui60.menu_agaci(ana)
    print(f"\nMenü: {len(maddeler)} madde, "
          f"{len([m for m in maddeler if m['etkin']])} etkin")
    for m in maddeler:
        print(f"    {'●' if m['etkin'] else '○'} {m['yol']}  (id={m['id']})")

    if input("\nDevam edilsin mi? (e/H) ").strip().lower() not in {"e", "evet"}:
        print("Vazgeçildi.")
        return 1

    kayit: dict = {}

    # --- 1. SENTETİK F6 -------------------------------------------------------
    print("\n" + "-" * 78)
    print("1) SÜRÜCÜNÜN GÖNDERDİĞİ F6 (SendInput)")
    print("-" * 78)

    once = irsaliye_noya_odaklan(ana)
    yaz_durum("F6 ÖNCESİ", once)

    birakilan = ui60.degistiricileri_birak()
    if birakilan:
        print(f"\n    ! {'+'.join(birakilan)} BASILI KALMIŞTI — bırakıldı.")
        print("      Basılı bir CTRL, F6'yı 'İleri Ctrl+F6'ya çevirir.")

    ui60.tus("F6", bekle_ms=1500)
    sonra = durum(ana)
    if not sonra["irsaliye_nodda_mi"]:
        ui60.pencere_noktasina_tikla(ana, IRSALIYE_NO_PENCERE_KONUMU)
        sonra = durum(ana)
    yaz_durum("F6 SONRASI", sonra)

    sentetik = temizlendi_mi(sonra)
    kayit["sentetik"] = {"once": once, "sonra": sonra, "temizlendi": sentetik,
                         "birakilan_degistiriciler": birakilan}

    if sonra["mdi_baslik"] != once["mdi_baslik"]:
        print(f"\n    ! MDI BELGESİ DEĞİŞTİ: {once['mdi_baslik']!r} → "
              f"{sonra['mdi_baslik']!r}")
        print("      F6, 'temizle' değil 'sonraki belge' olarak işlenmiş.")
    if sonra["acik_pencere_var"] and not once["acik_pencere_var"]:
        print("\n    ! F6 BİR PENCERE AÇTI — büyük olasılıkla temizlemeyi")
        print("      reddeden bir uyarı. İçeriği çizili olduğu için okunamıyor;")
        print("      EKRANA BAKIN ve yazısını not edin. Prob dokunmuyor.")

    print(f"\n    SONUÇ: sentetik F6 → {sonuc_metni(sentetik)}")

    # --- 2. ELLE F6 -----------------------------------------------------------
    print("\n" + "-" * 78)
    print("2) ELLE BASILAN F6")
    print("-" * 78)
    print("Şimdi CEOMED penceresine geçin, İrsaliye No alanına tıklayın ve")
    print("F6'ya KENDİ ELİNİZLE basın. Sonra buraya dönüp ENTER'a basın.")
    input("    (hazır olunca ENTER) ")

    elle = irsaliye_noya_odaklan(ana)
    yaz_durum("ELLE F6 SONRASI", elle)
    elle_sonuc = temizlendi_mi(elle)
    kayit["elle"] = {"sonra": elle, "temizlendi": elle_sonuc}
    print(f"\n    SONUÇ: elle F6 → {sonuc_metni(elle_sonuc)}")

    # --- 3. HÜKÜM -------------------------------------------------------------
    print("\n" + "=" * 78)
    print("HÜKÜM")
    print("=" * 78)

    if sentetik is None or elle_sonuc is None:
        print("Ölçüm tamamlanamadı: okumalardan biri geçerli değildi (odak")
        print("İrsaliye No'da değildi ya da park edilmiş bir kontroldü).")
        print("Yukarıdaki 'okuma geçerli mi' satırlarına bakın ve tekrar deneyin.")
    elif sentetik and elle_sonuc:
        print("İKİSİ DE TEMİZLEDİ. Form bu anda takılı değildi — sorun forma")
        print("özgü bir DURUMDA ortaya çıkıyor. Probu form GERÇEKTEN takılıyken")
        print("(sürücü hata verdiği anda) tekrar çalıştırın.")
    elif not sentetik and elle_sonuc:
        print("SENTETİK F6 ÇALIŞMIYOR, ELLE F6 ÇALIŞIYOR.")
        print("Sorun formda değil, tuşun GÖNDERİLİŞİNDE. Sürücü F6'yı Forms'un")
        print("kabul edeceği şekilde göndermiyor; menü/tarama kodu yolu")
        print("denenmeli. Bu, kodla çözülebilir bir sorundur.")
    elif sentetik and not elle_sonuc:
        print("SENTETİK ÇALIŞTI, ELLE ÇALIŞMADI — beklenmedik. Elle basarken")
        print("odak İrsaliye No'da mıydı? Ölçümü tekrarlayın.")
    else:
        print("İKİSİ DE TEMİZLEMEDİ. Sorun tuşta DEĞİL: form bu durumdayken F6'yı")
        print("kimin bastığından bağımsız olarak reddediyor. Sebep formun")
        print("kendisinde (kaydedilmemiş değişiklik, tamamlanmamış alan")
        print("doğrulaması, açık bir uyarı). EKRANDAKİ MESAJ SATIRINI OKUYUN —")
        print("cevap orada ve API'den görünmüyor.")
        print("Bu durumda sürücünün formu boşaltması beklenemez; formun bu")
        print("duruma NASIL girdiği araştırılmalı.")

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(kayit, fh, ensure_ascii=False, indent=2, default=str)
        print(f"\nJSON yazıldı: {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
