"""Ceomed formunda odağı takip eder: hangi alanda ne var, sırayla yazar.

NEDEN GEREKLİ: `inspect_form.py`, formun görünen alanlarının Windows kontrolü
OLMADIĞINI gösterdi — Informix 4GL çalışma zamanı (`ui60Drawn_W32`) hepsini
tuvale çiziyor. Ama sıfır boyuta park edilmiş `Edit` kontrollerinden birinin
ekrandaki İrsaliye No değerini (`SI007787`) taşıdığı görüldü.

Bu, 4GL'in bilinen davranışına işaret eder: odaktaki alan için gerçek bir Edit
kontrolü oluşturulur, alanın üstüne taşınır, odak gidince geri park edilir.

DOĞRUYSA otomasyon için kritik bir kazanç: her alana yazdıktan sonra değeri
GERİ OKUYABİLİRİZ. Muhasebeye e-irsaliye gönderimi geri alınamadığı için
"yazdım, herhalde doğru gitmiştir" kabul edilebilir değil.

BU BETİK HİÇBİR ŞEY YAZMAZ — yalnızca odağı okur.

Kullanım (Ceomed açık, irsaliye formu ekranda):

    python probe_focus.py                 # 90 sn dinler
    python probe_focus.py --saniye 180
    python probe_focus.py --json odak.json

Çalıştırdıktan sonra Ceomed penceresine geç ve:
  1. İrsaliye No alanına TIKLA
  2. TAB'a yavaşça 15-20 kez bas (her basıştan sonra yarım saniye bekle)
  3. Bu pencereye dön, Ctrl+C ile bitir

Çıktı, alanların TAB SIRASINI ve her birinin geri okunabilirliğini verir.
Sürücü bu sıraya göre yazacaktır.
"""
from __future__ import annotations

import argparse
import ctypes
import ctypes.wintypes as wintypes
import json
import sys
import time

WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", wintypes.LONG),
        ("top", wintypes.LONG),
        ("right", wintypes.LONG),
        ("bottom", wintypes.LONG),
    ]


class GUITHREADINFO(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("hwndActive", wintypes.HWND),
        ("hwndFocus", wintypes.HWND),
        ("hwndCapture", wintypes.HWND),
        ("hwndMenuOwner", wintypes.HWND),
        ("hwndMoveSize", wintypes.HWND),
        ("hwndCaret", wintypes.HWND),
        ("rcCaret", RECT),
    ]


user32 = ctypes.windll.user32


def focused_hwnd() -> int:
    """Ön plandaki pencerenin GERÇEK odak kontrolünü verir.

    GetFocus() yalnızca kendi thread'imiz için çalışır; başka bir sürecin
    odağını öğrenmek için GetGUIThreadInfo gerekir.
    """
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
    """WM_GETTEXT ile okur — GetWindowText başka sürecin Edit'inde boş dönebilir."""
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Ceomed form odak izleyici (salt okuma)")
    parser.add_argument("--saniye", type=int, default=90, help="Kaç saniye dinlensin")
    parser.add_argument("--aralik-ms", type=int, default=150, help="Yoklama aralığı")
    parser.add_argument("--json", dest="json_path", help="Kayıtları bu dosyaya JSON yaz")
    args = parser.parse_args()

    if not sys.platform.startswith("win"):
        print("Bu betik yalnızca Windows'ta çalışır.", file=sys.stderr)
        return 2

    print("Dinleniyor. Şimdi Ceomed penceresine geç:")
    print("  1. İrsaliye No alanına TIKLA")
    print("  2. TAB'a yavaşça 15-20 kez bas")
    print("  3. Buraya dönüp Ctrl+C ile bitir")
    print(f"(otomatik bitiş: {args.saniye} sn)\n")
    print(f"{'#':>3}  {'SINIF':<22} {'KONUM (L,T,R,B)':<30} DEĞER")
    print("-" * 100)

    kayitlar: list[dict] = []
    son_imza = None
    sira = 0
    bitis = time.time() + args.saniye

    try:
        while time.time() < bitis:
            hwnd = focused_hwnd()
            if hwnd:
                cls = class_name(hwnd)
                r = rect_of(hwnd)
                txt = window_text(hwnd)
                # Aynı alanda beklerken tekrar tekrar basmayalım; değer değişimi
                # de bir olaydır (kullanıcı yazıyor olabilir), o yüzden imzaya dahil.
                imza = (hwnd, r, txt)
                if imza != son_imza:
                    son_imza = imza
                    sira += 1
                    konum = f"({r[0]},{r[1]},{r[2]},{r[3]})"
                    genislik = r[2] - r[0]
                    yukseklik = r[3] - r[1]
                    isaret = "" if (genislik > 0 and yukseklik > 0) else "  [SIFIR BOYUT]"
                    print(f"{sira:>3}  {cls:<22} {konum:<30} {txt!r}{isaret}")
                    kayitlar.append({
                        "sira": sira,
                        "hwnd": hwnd,
                        "class_name": cls,
                        "rect": {"left": r[0], "top": r[1], "right": r[2], "bottom": r[3]},
                        "genislik": genislik,
                        "yukseklik": yukseklik,
                        "deger": txt,
                    })
            time.sleep(args.aralik_ms / 1000.0)
    except KeyboardInterrupt:
        print("\n(Ctrl+C — durduruldu)")

    print(f"\nToplam {len(kayitlar)} odak olayı kaydedildi.")

    if kayitlar:
        boyutlu = [k for k in kayitlar if k["genislik"] > 0 and k["yukseklik"] > 0]
        print(f"Bunların {len(boyutlu)} tanesi görünür boyutta bir kontroldü.")
        if boyutlu:
            print("\nSONUÇ: 4GL çalışma zamanı odaktaki alan için GERÇEK kontrol açıyor.")
            print("       Alan alan yaz-sonra-geri-oku doğrulaması MÜMKÜN.")
        else:
            print("\nSONUÇ: Odak hiç görünür bir kontrole düşmedi.")
            print("       Geri okuma mümkün değil; doğrulama ekran görüntüsüne kalır.")

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(kayitlar, fh, ensure_ascii=False, indent=2)
        print(f"\nJSON yazıldı: {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
