"""Ceomed formunda gezinme tuşlarını gönderip odağın nereye gittiğini kaydeder.

NEDEN GEREKLİ: `probe_focus.py` odağı izledi ama tuşları KULLANICI bastığı için
hangi hareketin hangi tuştan geldiği kesin değil. Ayrıca elle Tab'lanan turda
açılan arama pencereleri sırayı bozdu. Bu betik tuşları kendisi gönderir, böylece
"TAB grid'den çıkarıyor, sağ ok sütun değiştiriyor" gibi sorular tahminle değil
ölçümle cevaplanır.

GÜVENLİK — bu betik forma VERİ YAZMAZ:
  * Yalnızca izin listesindeki GEZİNME tuşlarını gönderir (TAB, oklar, ENTER,
    ESC, HOME, END). Harf/rakam gönderemez; `--tuslar` içine metin yazılamaz.
  * Buton tıklaması yapmaz. E-İRSALİYE GÖNDER'e asla dokunmaz.
  * Yine de BOŞ / YENİ bir irsaliye formunda çalıştırın. ENTER bazı formlarda
    kaydet anlamına gelir; dolu bir belgede denemeyin.

Kullanım (Ceomed açık, YENİ ve BOŞ irsaliye formu ekranda):

    # 1) Temiz tab sırası — arama pencereleri araya girmeden
    python probe_keys.py --tuslar "TAB*25" --json tabsirasi.json

    # 2) Grid içinde sütun geçişi hangi tuşla oluyor?
    python probe_keys.py --tuslar "RIGHT*4"
    python probe_keys.py --tuslar "ENTER*4"

Her çalıştırmada 6 saniyelik geri sayım olur; o sırada Ceomed penceresine geçip
BAŞLANGIÇ ALANINA TIKLAYIN. Betik ondan sonra tuşları gönderir.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import re
import sys
import time

# Yalnızca gezinme. Metin girişi bilinçli olarak DESTEKLENMİYOR: bu betik ölçüm
# aracıdır, veri girme aracı değil.
IZINLI_TUSLAR = {
    "TAB": 0x09,
    "ENTER": 0x0D,
    "ESC": 0x1B,
    "LEFT": 0x25,
    "UP": 0x26,
    "RIGHT": 0x27,
    "DOWN": 0x28,
    "HOME": 0x24,
    "END": 0x23,
    "PGUP": 0x21,
    "PGDN": 0x22,
    "SHIFTTAB": None,  # özel: Shift basılıyken TAB
}

VK_SHIFT = 0x10
WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
KEYEVENTF_KEYUP = 0x0002

user32 = ctypes.windll.user32


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG), ("top", wintypes.LONG),
        ("right", wintypes.LONG), ("bottom", wintypes.LONG),
    ]


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD), ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND), ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND), ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND), ("hwndCaret", wintypes.HWND),
        ("rcCaret", RECT),
    ]


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
    length = user32.SendMessageW(hwnd, WM_GETTEXTLENGTH, 0, 0)
    if length <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.SendMessageW(hwnd, WM_GETTEXT, length + 1, buf)
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


def tus_gonder(ad: str) -> None:
    """Tek bir gezinme tuşu gönderir (ön plandaki pencereye)."""
    if ad == "SHIFTTAB":
        user32.keybd_event(VK_SHIFT, 0, 0, 0)
        user32.keybd_event(0x09, 0, 0, 0)
        user32.keybd_event(0x09, 0, KEYEVENTF_KEYUP, 0)
        user32.keybd_event(VK_SHIFT, 0, KEYEVENTF_KEYUP, 0)
        return
    vk = IZINLI_TUSLAR[ad]
    user32.keybd_event(vk, 0, 0, 0)
    user32.keybd_event(vk, 0, KEYEVENTF_KEYUP, 0)


def tus_listesi_coz(ifade: str) -> list[str]:
    """'TAB*25,RIGHT*3' → ['TAB', ...25 kez..., 'RIGHT', 'RIGHT', 'RIGHT']"""
    sonuc: list[str] = []
    for parca in re.split(r"[,\s]+", ifade.strip()):
        if not parca:
            continue
        m = re.fullmatch(r"([A-Za-z]+)(?:\*(\d+))?", parca)
        if not m:
            raise ValueError(f"Anlaşılmayan tuş ifadesi: {parca!r}")
        ad = m.group(1).upper()
        if ad not in IZINLI_TUSLAR:
            # Metin girişi bilerek engellenir: bu bir ölçüm aracı.
            raise ValueError(
                f"'{ad}' izinli değil. Yalnızca gezinme tuşları: "
                + ", ".join(sorted(IZINLI_TUSLAR))
            )
        adet = int(m.group(2) or 1)
        if adet > 100:
            raise ValueError("Tek seferde en fazla 100 tuş.")
        sonuc.extend([ad] * adet)
    return sonuc


def odak_bilgisi() -> dict:
    hwnd = focused_hwnd()
    if not hwnd:
        return {"hwnd": 0, "class_name": "(odak yok)", "rect": None, "deger": ""}
    r = rect_of(hwnd)
    return {
        "hwnd": hwnd,
        "class_name": class_name(hwnd),
        "rect": {"left": r[0], "top": r[1], "right": r[2], "bottom": r[3]},
        "genislik": r[2] - r[0],
        "yukseklik": r[3] - r[1],
        "deger": window_text(hwnd),
    }


def yazdir(sira: int, tus: str, bilgi: dict) -> None:
    r = bilgi["rect"]
    konum = f"({r['left']},{r['top']},{r['right']},{r['bottom']})" if r else "-"
    print(f"{sira:>3}  {tus:<9} {bilgi['class_name']:<22} {konum:<30} {bilgi['deger']!r}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Ceomed form gezinme ölçümü")
    parser.add_argument("--tuslar", required=True,
                        help='Gezinme tuşları, ör. "TAB*25" veya "RIGHT*3,DOWN"')
    parser.add_argument("--bekleme-ms", type=int, default=400,
                        help="Her tuştan sonra beklenecek süre")
    parser.add_argument("--geri-sayim", type=int, default=6,
                        help="Başlamadan önce kaç saniye beklensin")
    parser.add_argument("--pencere", default="rsaliyesi",
                        help="Ön plandaki pencerenin başlığında geçmesi gereken metin")
    parser.add_argument("--json", dest="json_path")
    args = parser.parse_args()

    if not sys.platform.startswith("win"):
        print("Bu betik yalnızca Windows'ta çalışır.", file=sys.stderr)
        return 2

    try:
        tuslar = tus_listesi_coz(args.tuslar)
    except ValueError as exc:
        print(f"HATA: {exc}", file=sys.stderr)
        return 2

    print("UYARI: Bu betiği YENİ ve BOŞ bir irsaliye formunda çalıştırın.")
    print("       Yalnızca gezinme tuşları gönderilir; veri yazılmaz, butona basılmaz.\n")
    print(f"Gönderilecek: {len(tuslar)} tuş ({args.tuslar})\n")

    for kalan in range(args.geri_sayim, 0, -1):
        print(f"  {kalan}… Ceomed penceresine geçip BAŞLANGIÇ ALANINA tıklayın", end="\r")
        time.sleep(1)
    print(" " * 70, end="\r")

    # Yanlış pencereye tuş göndermek, ölçüm sırasında başka bir uygulamada
    # istenmeyen bir işlem tetikleyebilir. Belirsizliği burada kapatıyoruz.
    baslik = foreground_title()
    if args.pencere.lower() not in baslik.lower():
        print(f"HATA: Ön plandaki pencere '{baslik}'.", file=sys.stderr)
        print(f"      Başlığında '{args.pencere}' geçen pencere bekleniyordu; "
              "hiçbir tuş gönderilmedi.", file=sys.stderr)
        return 1

    print(f"Pencere: {baslik[:80]}\n")
    print(f"{'#':>3}  {'TUŞ':<9} {'SINIF':<22} {'KONUM (L,T,R,B)':<30} DEĞER")
    print("-" * 110)

    kayitlar = []
    basla = odak_bilgisi()
    basla["tus"] = "(başlangıç)"
    basla["sira"] = 0
    kayitlar.append(basla)
    yazdir(0, "(başlangıç)", basla)

    for i, tus in enumerate(tuslar, start=1):
        tus_gonder(tus)
        time.sleep(args.bekleme_ms / 1000.0)
        bilgi = odak_bilgisi()
        bilgi["tus"] = tus
        bilgi["sira"] = i
        kayitlar.append(bilgi)
        yazdir(i, tus, bilgi)

    print("\nBitti. Hiçbir veri yazılmadı, hiçbir butona basılmadı.")

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(kayitlar, fh, ensure_ascii=False, indent=2)
        print(f"JSON yazıldı: {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
