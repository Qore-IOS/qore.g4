"""Ceomed formuna metin yazıp ne olduğunu ölçer — sürücünün provası.

NEDEN AYRI BİR ARAÇ: `probe_keys.py` metin girişini bilerek reddeder, çünkü
gezinme ölçümü için yazmaya gerek yoktu. Ama iki soru yazmadan cevaplanamıyor:

  1. Cari Kodu'na değer YAZILINCA arama penceresi yine açılıyor mu, yoksa
     doğrudan çözülüyor mu? (Boş alandan Tab'la çıkınca açıldığı ölçüldü.)
  2. Grid'e stok kodu yazıldıktan sonra sütunlar arası geçiş hangi tuşla?

BU BETİK CANLI BİR MUHASEBE UYGULAMASINA YAZAR. Sınırlar:

  * `--onayla` bayrağı olmadan hiçbir şey göndermez.
  * Her adımdan ÖNCE odaktaki kontrol okunur. Odak "tehlikeli" bir butondaysa
    (GÖNDER, SIL, TAMAMLANDI, GÜNCELLE, YAZDIR, KOPYALA) betik o anda durur ve
    tuş göndermez. ENTER odaktaki butona basar; bu koruma olmadan yanlış bir
    adım e-irsaliye gönderebilirdi.
  * Ön plandaki pencerenin başlığı doğrulanır; yanlışsa hiçbir şey gönderilmez.
  * Buton tıklaması yapılmaz, fare kullanılmaz.

YİNE DE: yeni ve boş bir irsaliye formunda çalıştırın, sonra formu KAYDETMEDEN
kapatın. Bu bir ölçüm aracıdır; irsaliye oluşturmak için değildir.

Kullanım:

    # Cari kodu yazınca arama penceresi açılıyor mu?
    python probe_type.py --adimlar "YAZ:120.01.001,TAB" --onayla

    # Grid'de sütun geçişi (önce grid'in ilk hücresine tıklayın)
    python probe_type.py --adimlar "YAZ:TESTKOD,TAB" --onayla
    python probe_type.py --adimlar "YAZ:TESTKOD,ENTER" --onayla
    python probe_type.py --adimlar "YAZ:TESTKOD,RIGHT" --onayla
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import re
import sys
import time

user32 = ctypes.windll.user32

WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
INPUT_KEYBOARD = 1
VK_SHIFT = 0x10

GEZINME_TUSLARI = {
    "TAB": 0x09, "ENTER": 0x0D, "ESC": 0x1B,
    "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
    "HOME": 0x24, "END": 0x23, "PGUP": 0x21, "PGDN": 0x22,
    "DELETE": 0x2E, "BACKSPACE": 0x08,
}

GA_ROOT = 2

# Pencereye GÖRE alan konumları (sol üst köşeden). Ham ekran koordinatları
# pencere konumuna bağlı olduğu için kullanılamaz; bunlar sabittir.
#
# Ölçümden: pencere kökü (-1929, -62), İrsaliye No (-1806, 51)
#   → pencereye göre (123, 113)
BASLANGIC_BOLGELERI = {
    "irsaliyeno": (123, 113),
    "tarih":      (246, 113),
    "carikodu":   (123, 132),
    "islemtipi":  (855, 149),
    "depo":       (855, 169),
    "grid":       (14, 297),
}
BOLGE_TOLERANS = 30

# Odak bu metinlerden birini taşıyan bir butondayken tuş göndermek, belge
# göndermek/silmek/kaydetmek anlamına gelebilir. 'Tamam' bilerek listede DEĞİL:
# arama penceresini onaylamak için gerekli ve geri alınabilir bir işlem.
TEHLIKELI_BUTON = re.compile(
    r"GONDER|SIL|TAMAMLANDI|GUNCELLE|YAZDIR|KOPYALA|ONAYLA|KAYDET|IPTAL",
    re.IGNORECASE,
)

_TR = str.maketrans("ğĞıİöÖüÜşŞçÇ", "gGiIoOuUsScC")


def normalize(s: str) -> str:
    return s.translate(_TR)


class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG),
                ("right", wintypes.LONG), ("bottom", wintypes.LONG)]


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND), ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND),
        ("rcCaret", RECT),
    ]


ULONG_PTR = ctypes.c_size_t


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
                ("dwExtraInfo", ULONG_PTR)]


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG),
                ("mouseData", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ULONG_PTR)]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD),
                ("wParamH", wintypes.WORD)]


class INPUTUNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", INPUTUNION)]


def _send(inputs: list[INPUT]) -> None:
    n = len(inputs)
    arr = (INPUT * n)(*inputs)
    user32.SendInput(n, ctypes.byref(arr), ctypes.sizeof(INPUT))


def _key_input(vk: int, up: bool) -> INPUT:
    ki = KEYBDINPUT(wVk=vk, wScan=0, dwFlags=KEYEVENTF_KEYUP if up else 0,
                    time=0, dwExtraInfo=0)
    return INPUT(type=INPUT_KEYBOARD, u=INPUTUNION(ki=ki))


def _char_input(ch: str, up: bool) -> INPUT:
    flags = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if up else 0)
    ki = KEYBDINPUT(wVk=0, wScan=ord(ch), dwFlags=flags, time=0, dwExtraInfo=0)
    return INPUT(type=INPUT_KEYBOARD, u=INPUTUNION(ki=ki))


def tus_gonder(ad: str) -> None:
    vk = GEZINME_TUSLARI[ad]
    _send([_key_input(vk, False), _key_input(vk, True)])


def metin_yaz(metin: str, karakter_ms: int = 30) -> None:
    """Unicode olarak yazar — Türkçe karakterler klavye düzeninden bağımsız gider."""
    for ch in metin:
        _send([_char_input(ch, False), _char_input(ch, True)])
        time.sleep(karakter_ms / 1000.0)


def focused_hwnd() -> int:
    fg = user32.GetForegroundWindow()
    if not fg:
        return 0
    tid = user32.GetWindowThreadProcessId(fg, None)
    gti = GUITHREADINFO()
    gti.cbSize = ctypes.sizeof(GUITHREADINFO)
    if not user32.GetGUIThreadInfo(tid, ctypes.byref(gti)):
        return 0
    return gti.hwndFocus or 0


def class_name(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def window_text(hwnd: int) -> str:
    n = user32.SendMessageW(hwnd, WM_GETTEXTLENGTH, 0, 0)
    if n <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.SendMessageW(hwnd, WM_GETTEXT, n + 1, buf)
    return buf.value


def rect_of(hwnd: int) -> tuple[int, int, int, int]:
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def foreground_title() -> str:
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return ""
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


ENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


def pencere_metinleri(kok: int) -> list[str]:
    """Bir pencerenin içindeki tüm okunabilir metinleri toplar.

    Uyarı pencerelerinin mesajını almak için: sürücü bir doğrulama hatasında
    işi neden başarısız damgaladığını loglayabilmeli. 'Bir uyarı çıktı' yetmez.
    """
    bulunan: list[str] = []

    def geri_cagri(hwnd, _lparam):
        t = window_text(hwnd)
        if t and t.strip():
            bulunan.append(t.strip())
        return True

    user32.EnumChildWindows(kok, ENUMPROC(geri_cagri), 0)
    return bulunan


def odak_bilgisi(mesaj_topla: bool = False) -> dict:
    hwnd = focused_hwnd()
    if not hwnd:
        return {"hwnd": 0, "class_name": "(odak yok)", "rect": None, "deger": "",
                "pencere_ici": (0, 0)}
    r = rect_of(hwnd)
    kok = user32.GetAncestor(hwnd, GA_ROOT)
    kr = rect_of(kok) if kok else (0, 0, 0, 0)
    bilgi = {
        "hwnd": hwnd,
        "class_name": class_name(hwnd),
        "rect": {"left": r[0], "top": r[1], "right": r[2], "bottom": r[3]},
        "pencere_ici": (r[0] - kr[0], r[1] - kr[1]),
        "deger": window_text(hwnd),
    }
    # Odak bir butondaysa büyük ihtimalle bir uyarı/onay penceresindeyiz;
    # mesajı da kaydet.
    if mesaj_topla and bilgi["class_name"] == "Button" and kok:
        bilgi["pencere_basligi"] = window_text(kok)
        bilgi["pencere_metinleri"] = pencere_metinleri(kok)
    return bilgi


def tehlikeli_mi(bilgi: dict) -> str | None:
    """Odak, basılması geri alınamaz bir butondaysa sebebini döner."""
    if bilgi["class_name"] != "Button":
        return None
    metin = normalize(bilgi["deger"])
    if TEHLIKELI_BUTON.search(metin):
        return bilgi["deger"]
    return None


def adimlari_coz(ifade: str) -> list[tuple[str, str]]:
    """'YAZ:120.01,TAB' → [('YAZ','120.01'), ('TUS','TAB')]

    Virgül metin içinde geçebileceği için YAZ: sonrası bir sonraki virgüle kadar
    alınır; virgüllü metin gerekiyorsa adımı ikiye bölün.
    """
    adimlar: list[tuple[str, str]] = []
    for parca in ifade.split(","):
        parca = parca.strip()
        if not parca:
            continue
        if parca.upper().startswith("YAZ:"):
            metin = parca[4:]
            if not metin:
                raise ValueError("YAZ: adımı boş olamaz")
            adimlar.append(("YAZ", metin))
        elif parca.upper().startswith("BEKLE:"):
            adimlar.append(("BEKLE", parca[6:]))
        elif parca.upper() == "TEMIZLE":
            adimlar.append(("TEMIZLE", ""))
        else:
            ad = parca.upper()
            if ad not in GEZINME_TUSLARI:
                raise ValueError(
                    f"'{parca}' anlaşılmadı. Tuşlar: {', '.join(sorted(GEZINME_TUSLARI))}, "
                    "TEMIZLE; metin için 'YAZ:...' kullanın."
                )
            adimlar.append(("TUS", ad))
    if not adimlar:
        raise ValueError("Hiç adım verilmedi")
    return adimlar


def alan_temizle(uzunluk: int = 40) -> None:
    """END + BACKSPACE×N. Ctrl+A yerine bu: Forms alanlarında seçim davranışı
    öngörülemez, ama END+BACKSPACE her metin alanında aynı işi yapar."""
    tus_gonder("END")
    time.sleep(0.05)
    for _ in range(uzunluk):
        tus_gonder("BACKSPACE")
        time.sleep(0.01)


def yazdir(sira: int, adim: str, bilgi: dict) -> None:
    r = bilgi["rect"]
    konum = f"({r['left']},{r['top']},{r['right']},{r['bottom']})" if r else "-"
    px, py = bilgi.get("pencere_ici", (0, 0))
    print(f"{sira:>3}  {adim:<22} {bilgi['class_name']:<16} {konum:<28} "
          f"pen({px},{py}){'':<3} {bilgi['deger']!r}")
    if bilgi.get("pencere_basligi"):
        print(f"       ↳ pencere başlığı: {bilgi['pencere_basligi']!r}")
    for metin in bilgi.get("pencere_metinleri", []) or []:
        print(f"       ↳ pencere metni: {metin!r}")
    if bilgi["class_name"] == "Edit":
        print(f"       ↳ uzunluk: {len(bilgi['deger'])} karakter")


def main() -> int:
    p = argparse.ArgumentParser(description="Ceomed form yazma ölçümü")
    p.add_argument("--adimlar", required=True,
                   help='Ör: "YAZ:120.01.001,TAB" — tuşlar ve YAZ:<metin>')
    p.add_argument("--onayla", action="store_true",
                   help="Bu bayrak olmadan hiçbir şey gönderilmez")
    p.add_argument("--bekleme-ms", type=int, default=500)
    p.add_argument("--pencere", default="CEOMED")
    p.add_argument("--baslangic", choices=sorted(BASLANGIC_BOLGELERI),
                   help="Beklenen başlangıç alanı; odak orada değilse hiçbir şey "
                        "gönderilmez. Yanlış alandan başlayan ölçüm boşa gider.")
    p.add_argument("--json", dest="json_path")
    args = p.parse_args()

    if not sys.platform.startswith("win"):
        print("Bu betik yalnızca Windows'ta çalışır.", file=sys.stderr)
        return 2

    try:
        adimlar = adimlari_coz(args.adimlar)
    except ValueError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 2

    print("Planlanan adımlar:")
    for i, (tur, deger) in enumerate(adimlar, 1):
        print(f"  {i}. {tur} {deger!r}")

    if not args.onayla:
        print("\n--onayla verilmedi; hiçbir şey gönderilmedi.")
        print("Bu betik canlı uygulamaya YAZAR. Yeni ve boş bir irsaliye formunda,")
        print("sonrasında formu kaydetmeden kapatmak üzere çalıştırın.")
        return 0

    print("\nYENİ ve BOŞ bir irsaliye formunda olduğunuzdan emin olun.")
    for kalan in range(6, 0, -1):
        print(f"  {kalan}… Ceomed'e geçip BAŞLANGIÇ ALANINA tıklayın", end="\r")
        time.sleep(1)
    print(" " * 70, end="\r")

    baslik = foreground_title()
    if args.pencere.lower() not in normalize(baslik).lower():
        print(f"HATA: Ön plandaki pencere '{baslik}'.", file=sys.stderr)
        print("      Beklenen pencere önde değil; hiçbir şey gönderilmedi.", file=sys.stderr)
        return 1

    print(f"Pencere: {baslik[:80]}\n")

    bilgi = odak_bilgisi(mesaj_topla=True)

    if args.baslangic:
        bx, by = BASLANGIC_BOLGELERI[args.baslangic]
        px, py = bilgi["pencere_ici"]
        if abs(px - bx) > BOLGE_TOLERANS or abs(py - by) > BOLGE_TOLERANS:
            print(f"HATA: '{args.baslangic}' alanından başlanması bekleniyordu "
                  f"(pencere içi ~{bx},{by}).", file=sys.stderr)
            print(f"      Odak şu an ({px},{py}) konumunda — yanlış alan.",
                  file=sys.stderr)
            print("      Hiçbir şey gönderilmedi. Doğru alana tıklayıp tekrar deneyin.",
                  file=sys.stderr)
            return 1
        print(f"Başlangıç doğrulandı: {args.baslangic}\n")

    print(f"{'#':>3}  {'ADIM':<22} {'SINIF':<16} {'KONUM':<28} {'PENCERE İÇİ':<14} DEĞER")
    print("-" * 120)

    kayitlar = []
    bilgi["adim"] = "(başlangıç)"
    kayitlar.append(bilgi)
    yazdir(0, "(başlangıç)", bilgi)

    for i, (tur, deger) in enumerate(adimlar, start=1):
        # Her adımdan ÖNCE kontrol: ENTER odaktaki butona basar.
        onceki = odak_bilgisi()
        sebep = tehlikeli_mi(onceki)
        if sebep:
            print(f"\nDURDURULDU: odak '{sebep}' butonunda.", file=sys.stderr)
            print("Bu butona tuş göndermek geri alınamaz bir işlem tetikleyebilir.",
                  file=sys.stderr)
            print("Kalan adımlar iptal edildi.", file=sys.stderr)
            break

        if tur == "YAZ":
            metin_yaz(deger)
            etiket = f"YAZ {deger!r}"
        elif tur == "BEKLE":
            time.sleep(int(deger) / 1000.0)
            etiket = f"BEKLE {deger}ms"
        elif tur == "TEMIZLE":
            alan_temizle()
            etiket = "TEMIZLE"
        else:
            tus_gonder(deger)
            etiket = deger

        time.sleep(args.bekleme_ms / 1000.0)
        bilgi = odak_bilgisi(mesaj_topla=True)
        bilgi["adim"] = etiket

        # Odak kıpırdamadıysa uygulama değeri reddetmiştir: Forms alandan çıkışta
        # doğrulama yapıyor ve geçersiz değerde odağı bırakmıyor. Sürücü için
        # bedava hata sinyali; ölçümde de görünsün.
        # Kimlik hwnd DEĞİL (hwnd, konum): Forms ardışık alanlar için aynı Edit'i
        # taşıyıp yeniden kullanabiliyor — grid 4.→5. sütunda hwnd sabit kaldı.
        ilerledi = (bilgi["hwnd"], bilgi["rect"] and tuple(bilgi["rect"].values())) != (
            onceki["hwnd"], onceki["rect"] and tuple(onceki["rect"].values()))
        if tur == "TUS" and deger in ("TAB", "ENTER") and not ilerledi:
            bilgi["uyari"] = "odak ilerlemedi — değer reddedilmiş olabilir"
        kayitlar.append(bilgi)
        yazdir(i, etiket, bilgi)
        if bilgi.get("uyari"):
            print(f"       ↳ {bilgi['uyari']}")

    print("\nBitti. Hiçbir butona tıklanmadı.")
    print("Test formunu KAYDETMEDEN kapatın.")

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(kayitlar, fh, ensure_ascii=False, indent=2)
        print(f"JSON yazıldı: {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
