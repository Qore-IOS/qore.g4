"""Oracle Forms 6i (`ifrun60`) formlarıyla konuşmak için ortak katman.

Ölçümlerle KESİNLEŞMİŞ davranışları tek yerde toplar; `fill_irsaliye.py` ve
problar bunun üstüne kurulur. Ölçüm tutanağı: ORACLE-IRSALIYE.md.

`ifrun60.exe` = Interactive Forms Runtime 6.0; pencere sınıfları `ui60MDIroot_W32`,
`ui60Viewcore_W32`, `ui60Drawn_W32` ve hata mesajları (`WHEN-VALIDATE-ITEM`,
`ORA-01403`) bunu doğruluyor.

Neden pywinauto değil de saf ctypes: Forms'un görünen alanları Windows kontrolü
değil, tuvale çizilmiş. `child_window()` ile bulunamazlar, dolayısıyla
pywinauto'nun asıl faydası burada yok. Buna karşılık kurulum sorunu ölçümü
engelleyebiliyor (Ceomed makinesinde pip başarısız oldu). ctypes her Python'da
hazır.

DAVRANIŞ MODELİ (ölçülmüş):

  * Odaktaki alan için Forms gerçek bir `Edit` kontrolü açıp alanın üstüne taşır.
    Odak gidince sıfır boyuta park eder. → Alan alan GERİ OKUMA mümkün.
  * Alan temizlenmeden yazılırsa değer birleşir ('m51016' + '12' = 'm5101612').
    → Her yazımdan önce TEMIZLE şart.
  * Geçersiz değerde TAB odağı ilerletmez (Forms `WHEN-VALIDATE-ITEM` tetikçisi
    hata verince navigasyonu durdurur). → Odak kıpırdamadıysa değer reddedildi.
    Bu, hatanın modal pencere AÇMADIĞI durumlarda da çalışan tek güvenilir
    sinyaldir: Forms hataları çoğu zaman formun alt mesaj satırında görünür
    (ör. "WHEN-VALIDATE-ITEM … ORA-01403"), pencere açılmaz.
  * Arama alanları (Cari Kodu, Depo, Stok Kodu) TAB'da bir LOV penceresi açar.
    Filtre `yazdığımız%` olarak kendiliğinden dolar; ENTER seçili satırı kabul
    eder. Liste çizilmiş olduğu için OKUNAMAZ → pencere kapandıktan sonra alanı
    geri okuyup doğrulamak tek güvence.
  * Doğrulama hatası modal uyarı penceresi açar; mesajı da çizilmiş olduğu için
    okunamaz → teşhis ekran görüntüsüne kalır.
"""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wintypes
import os
import re
import time

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

WM_GETTEXT = 0x000D
WM_GETTEXTLENGTH = 0x000E
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
INPUT_KEYBOARD = 1
BM_CLICK = 0x00F5
GA_ROOT = 2
SRCCOPY = 0x00CC0020

VK = {
    "TAB": 0x09, "ENTER": 0x0D, "ESC": 0x1B, "END": 0x23, "HOME": 0x24,
    "LEFT": 0x25, "UP": 0x26, "RIGHT": 0x27, "DOWN": 0x28,
    "DELETE": 0x2E, "BACKSPACE": 0x08,
}

# Odak bu metinlerden birini taşıyan bir butondayken tuş göndermek geri alınamaz
# bir işlem tetikleyebilir. 'Tamam' ve 'Bul' bilerek DIŞARIDA: LOV penceresini
# kullanmak için gerekliler ve geri alınabilirler.
TEHLIKELI_BUTON = re.compile(
    r"GONDER|SIL|TAMAMLANDI|GUNCELLE|YAZDIR|KOPYALA|ONAYLA|KAYDET",
    re.IGNORECASE,
)

_TR = str.maketrans("ğĞıİöÖüÜşŞçÇ", "gGiIoOuUsScC")


def normalize(s: str) -> str:
    """Türkçe karakterleri ASCII'ye indirger — desen eşleştirmesi için."""
    return (s or "").translate(_TR)


# --- Win32 yapıları -----------------------------------------------------------

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


ENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)


# --- Okuma --------------------------------------------------------------------

def pencere_metni(hwnd: int) -> str:
    """WM_GETTEXT ile okur — GetWindowText başka sürecin Edit'inde boş döner."""
    if not hwnd:
        return ""
    n = user32.SendMessageW(hwnd, WM_GETTEXTLENGTH, 0, 0)
    if n <= 0:
        return ""
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.SendMessageW(hwnd, WM_GETTEXT, n + 1, buf)
    return buf.value


def sinif_adi(hwnd: int) -> str:
    buf = ctypes.create_unicode_buffer(256)
    user32.GetClassNameW(hwnd, buf, 256)
    return buf.value


def dikdortgen(hwnd: int) -> tuple[int, int, int, int]:
    r = RECT()
    user32.GetWindowRect(hwnd, ctypes.byref(r))
    return (r.left, r.top, r.right, r.bottom)


def baslik(hwnd: int) -> str:
    if not hwnd:
        return ""
    n = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    user32.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def odak_hwnd() -> int:
    """Ön plandaki pencerenin gerçek odak kontrolü.

    GetFocus() yalnızca kendi thread'imiz için çalışır; başka sürecin odağı
    GetGUIThreadInfo ile alınır.
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


MDI_BELGE_SINIFI = "ui60MDIdocument_W32"


def mdi_belge_kokü(hwnd: int) -> int:
    """Etkin kontrolün MDI belge penceresi (yoksa 0).

    Ceomed bir MDI uygulaması: form, ana pencerenin içinde ayrı bir alt
    pencerede duruyor. Konumları ANA pencereye göre ölçmek kırılgan — ana
    pencere yeniden boyutlanınca ya da form penceresi içeride kayınca tüm
    ölçümler bozulur. Provada tam bu oldu: İrsaliye No (123,113) yerine
    (9,100)'de göründü ve sürücü "form yarıda kalmış" sanıp durdu.
    """
    # Normal kontrollerde ebeveyn zinciri yeterlidir. Forms'un alan üzerine
    # taşıdığı geçici Edit ise her kurulumda MDI belgesinin çocuğu değil.
    h = hwnd
    while h:
        if sinif_adi(h) == MDI_BELGE_SINIFI:
            return h
        h = user32.GetParent(h)
    # Uçuşan Edit için belgeyi ana pencereden ara. Birden fazla belge varsa
    # odağı içeren en küçük görünür belge etkin belgedir.
    kok = user32.GetAncestor(hwnd, GA_ROOT)
    if not kok:
        return 0
    odak_rect = dikdortgen(hwnd)
    adaylar: list[tuple[int, int]] = []

    def geri_cagri(aday, _lparam):
        if sinif_adi(aday) == MDI_BELGE_SINIFI and user32.IsWindowVisible(aday):
            r = dikdortgen(aday)
            if (r[0] <= odak_rect[0] < r[2]
                    and r[1] <= odak_rect[1] < r[3]):
                alan = max(0, r[2] - r[0]) * max(0, r[3] - r[1])
                adaylar.append((alan, aday))
        return True

    user32.EnumChildWindows(kok, ENUMPROC(geri_cagri), 0)
    return min(adaylar)[1] if adaylar else 0


def odak() -> dict:
    """Odaktaki kontrolün tam tarifi."""
    hwnd = odak_hwnd()
    if not hwnd:
        return {"hwnd": 0, "sinif": "", "deger": "", "kok": 0,
                "kok_baslik": "", "pencere_ici": (0, 0), "rect": (0, 0, 0, 0)}
    r = dikdortgen(hwnd)
    kok = user32.GetAncestor(hwnd, GA_ROOT)
    kr = dikdortgen(kok) if kok else (0, 0, 0, 0)
    mdi = mdi_belge_kokü(hwnd)
    taban = mdi or kok
    tr = dikdortgen(taban) if taban else (0, 0, 0, 0)
    return {
        "hwnd": hwnd,
        "sinif": sinif_adi(hwnd),
        "deger": pencere_metni(hwnd),
        "kok": kok,
        "kok_baslik": baslik(kok),
        "mdi": mdi,
        "mdi_baslik": baslik(mdi) if mdi else "",
        # Alan eşleştirmesi BUNU kullanır: MDI belge penceresine göre konum,
        # ana pencere boyutundan bağımsızdır.
        "mdi_ici": (r[0] - tr[0], r[1] - tr[1]),
        "pencere_ici": (r[0] - kr[0], r[1] - kr[1]),
        "rect": r,
    }


def cocuk_metinleri(kok: int) -> list[str]:
    """Bir pencerenin okunabilir tüm alt metinleri.

    Uyarı pencerelerinde genelde yalnızca buton yazısı döner (mesaj çizilmiş);
    yine de toplanır, bazı pencerelerde işe yarayabilir.
    """
    bulunan: list[str] = []

    def geri_cagri(hwnd, _lparam):
        t = pencere_metni(hwnd)
        if t and t.strip():
            bulunan.append(t.strip())
        return True

    user32.EnumChildWindows(kok, ENUMPROC(geri_cagri), 0)
    return bulunan


def pencere_bul(baslik_icerir: str) -> list[int]:
    """Başlığında verilen metni geçen tüm üst düzey pencereler."""
    aranan = normalize(baslik_icerir).lower()
    bulunan: list[int] = []

    def geri_cagri(hwnd, _lparam):
        if user32.IsWindowVisible(hwnd):
            t = normalize(baslik(hwnd)).lower()
            if aranan in t:
                bulunan.append(hwnd)
        return True

    user32.EnumWindows(ENUMPROC(geri_cagri), 0)
    return bulunan


def buton_bul(kok: int, metin: str) -> int:
    """Bir penceredeki butonu YAZISINDAN bulur.

    Koordinat yerine yazı: pencere kaysa veya boyut değişse bile doğru butona
    basılır. Ölçümde butonların gerçek `Button` kontrolü olduğu ve yazılarının
    okunabildiği doğrulandı.
    """
    aranan = normalize(metin).lower().replace("&", "")
    bulunan: list[int] = []

    def geri_cagri(hwnd, _lparam):
        if sinif_adi(hwnd) == "Button":
            t = normalize(pencere_metni(hwnd)).lower().replace("&", "")
            if t == aranan:
                bulunan.append(hwnd)
        return True

    user32.EnumChildWindows(kok, ENUMPROC(geri_cagri), 0)
    return bulunan[0] if bulunan else 0


# --- Yazma --------------------------------------------------------------------

def _gonder(girdiler: list[INPUT]) -> None:
    n = len(girdiler)
    dizi = (INPUT * n)(*girdiler)
    user32.SendInput(n, ctypes.byref(dizi), ctypes.sizeof(INPUT))


def _tus_girdi(vk: int, birak: bool) -> INPUT:
    ki = KEYBDINPUT(wVk=vk, wScan=0,
                    dwFlags=KEYEVENTF_KEYUP if birak else 0,
                    time=0, dwExtraInfo=0)
    return INPUT(type=INPUT_KEYBOARD, u=INPUTUNION(ki=ki))


def _karakter_girdi(ch: str, birak: bool) -> INPUT:
    bayrak = KEYEVENTF_UNICODE | (KEYEVENTF_KEYUP if birak else 0)
    ki = KEYBDINPUT(wVk=0, wScan=ord(ch), dwFlags=bayrak, time=0, dwExtraInfo=0)
    return INPUT(type=INPUT_KEYBOARD, u=INPUTUNION(ki=ki))


class TehlikeliOdak(RuntimeError):
    """Odak, basılması geri alınamaz bir butondayken tuş gönderilmek istendi."""


def tehlikeli_odak_kontrol() -> None:
    """Tuş göndermeden ÖNCE çağrılır.

    ENTER odaktaki butona basar. Bu kontrol olmadan yanlış zamanlanmış tek bir
    ENTER e-irsaliye gönderebilir — geri alınamaz.
    """
    o = odak()
    if o["sinif"] != "Button":
        return
    if TEHLIKELI_BUTON.search(normalize(o["deger"])):
        raise TehlikeliOdak(
            f"Odak {o['deger']!r} butonunda; tuş gönderilmedi."
        )


VK_SHIFT = 0x10


def tus(ad: str, bekle_ms: int = 120) -> None:
    tehlikeli_odak_kontrol()
    if ad == "SHIFTTAB":
        # Forms'ta "önceki alan". Odakta olmayan alan okunamadığı için, bir
        # değeri seçim sonrası doğrulamanın tek yolu geri dönüp okumak.
        _gonder([
            _tus_girdi(VK_SHIFT, False), _tus_girdi(VK["TAB"], False),
            _tus_girdi(VK["TAB"], True), _tus_girdi(VK_SHIFT, True),
        ])
    else:
        vk = VK[ad]
        _gonder([_tus_girdi(vk, False), _tus_girdi(vk, True)])
    time.sleep(bekle_ms / 1000.0)


def yaz(metin: str, karakter_ms: int = 25) -> None:
    """Unicode olarak yazar — klavye düzeninden bağımsız, Türkçe karakter dahil."""
    tehlikeli_odak_kontrol()
    for ch in metin:
        _gonder([_karakter_girdi(ch, False), _karakter_girdi(ch, True)])
        time.sleep(karakter_ms / 1000.0)


def mdi_noktasina_tikla(mdi_ici: tuple[int, int], bekle_ms: int = 300) -> None:
    """Etkin MDI belge içindeki ölçülmüş noktaya sol tıklar.

    Oracle Forms alanlarını tuvale çizdiği için HWND ile odaklamak mümkün
    değil. Ham ekran koordinatı da pencere taşınınca bozulur. Bu nedenle
    saha ölçümünü MDI belge köküne göre ekrana çeviririz; çağıran taraf
    tıklama sonrası odağın beklenen alana geldiğini doğrulamak zorundadır.
    """
    o = odak()
    mdi = o.get("mdi") or 0
    if not mdi:
        raise AlanReddedildi("Etkin MDI belge penceresi bulunamadı; tıklanmadı.")
    l, t, r, b = dikdortgen(mdi)
    x, y = l + mdi_ici[0], t + mdi_ici[1]
    if not (l <= x < r and t <= y < b):
        raise AlanReddedildi(
            f"MDI tıklama noktası belge dışında: {mdi_ici!r}."
        )
    if not user32.SetCursorPos(x, y):
        raise AlanReddedildi(f"Fare {mdi_ici!r} konumuna taşınamadı.")
    user32.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0)
    user32.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0)
    time.sleep(bekle_ms / 1000.0)


def alan_temizle(uzunluk: int = 40) -> None:
    """END + BACKSPACE×N.

    Ctrl+A değil: ölçümde aynı alana aynı komutun bir turda hiç girmediği,
    başka turda değeri tamamen değiştirdiği görüldü — seçim davranışı
    öngörülemez. END+BACKSPACE her metin alanında aynı işi yapar.
    """
    tus("END", bekle_ms=40)
    for _ in range(uzunluk):
        tus("BACKSPACE", bekle_ms=8)


# --- Doğrulamalı yazma --------------------------------------------------------

class AlanReddedildi(RuntimeError):
    """Yazılan değer alana girmedi veya uygulama tarafından reddedildi."""


def alan_yaz(deger: str, etiket: str, bekle_ms: int = 250) -> str:
    """Alanı temizler, değeri yazar, GERİ OKUR ve doğrular.

    E-irsaliye gönderimi geri alınamadığı için "yazdım, herhalde doğru gitti"
    kabul edilebilir değil. Uyuşmazlıkta çağıran taraf gönderime geçmemelidir.
    """
    alan_temizle()
    yaz(deger)
    time.sleep(bekle_ms / 1000.0)
    okunan = odak()["deger"]
    if okunan != deger:
        raise AlanReddedildi(
            f"{etiket}: yazılan {deger!r}, alanda okunan {okunan!r}"
        )
    return okunan


def lov_acik_mi(ana_pencere: int) -> bool:
    """Odak ana formun dışındaki bir pencereye düştüyse LOV/uyarı açılmıştır."""
    o = odak()
    return bool(o["kok"]) and o["kok"] != ana_pencere


def uyari_penceresi_mi(ana_pencere: int) -> bool:
    """LOV mu uyarı mı? LOV'da filtre alanı (Edit) ve 'Bul' butonu vardır.

    Uyarı penceresinde yalnızca bir onay butonu bulunur; mesajın kendisi tuvale
    çizildiği için okunamaz.
    """
    o = odak()
    if not o["kok"] or o["kok"] == ana_pencere:
        return False
    return buton_bul(o["kok"], "Bul") == 0


def lov_kabul_et(ana_pencere: int, timeout_ms: int = 5000) -> None:
    """Açık LOV penceresinde seçili satırı kabul eder ve kapanmasını bekler.

    Liste `ui60Drawn_W32` olduğu için hangi satırın seçili olduğu OKUNAMAZ.
    Bu yüzden kabul tek başına yeterli değildir: çağıran taraf pencere
    kapandıktan sonra alanı geri okuyup beklediği değerle karşılaştırmalıdır.
    """
    o = odak()
    tamam = buton_bul(o["kok"], "Tamam")
    if tamam:
        user32.SendMessageW(tamam, BM_CLICK, 0, 0)
    else:
        tus("ENTER")

    bitis = time.time() + timeout_ms / 1000.0
    while time.time() < bitis:
        if not lov_acik_mi(ana_pencere):
            return
        time.sleep(0.1)
    raise AlanReddedildi("LOV penceresi kapanmadı.")


def odak_kimligi() -> tuple[int, tuple[int, int, int, int]]:
    """Odağın kimliği: (hwnd, konum).

    Yalnızca `hwnd` YETMEZ. Forms, ardışık alanlar için çoğu zaman AYNI `Edit`
    kontrolünü taşıyıp yeniden kullanıyor: grid'de 4. sütundan 5. sütuna
    geçildiğinde `hwnd` sabit kaldı, yalnızca dikdörtgen değişti. `hwnd`
    karşılaştıran bir kontrol bu geçişi "ilerlemedi" sanır ve geçerli bir değeri
    reddedilmiş gibi raporlar.
    """
    o = odak()
    return (o["hwnd"], o["rect"])


def odak_ilerledi_mi(onceki_kimlik: tuple[int, tuple[int, int, int, int]]) -> bool:
    """Odak gerçekten başka bir alana geçti mi?

    Forms alandan çıkışta WHEN-VALIDATE-ITEM çalıştırır; tetikçi hata verirse
    navigasyonu durdurur. Odak yerinde kaldıysa değer reddedilmiştir.

    Bu, hatanın modal pencere AÇMADIĞI durumlarda da çalışan tek güvenilir
    sinyaldir — Forms hataları çoğu zaman formun alt mesaj satırında görünür
    (ör. "WHEN-VALIDATE-ITEM … ORA-01403"), yakalanacak bir pencere olmaz.
    """
    return odak_kimligi() != onceki_kimlik


# --- Ekran görüntüsü ----------------------------------------------------------

def ekran_goruntusu(hwnd: int, dizin: str, ad: str) -> str | None:
    """Pencereyi BMP olarak kaydeder; yolu döner.

    Pillow'a bağlı değil: Ceomed makinesinde pip kurulumu başarısız olabiliyor ve
    teşhis görüntüsü tam da işler ters gittiğinde gerekiyor. BMP başlığı elle
    yazılır.
    """
    try:
        os.makedirs(dizin, exist_ok=True)
        l, t, r, b = dikdortgen(hwnd)
        w, h = r - l, b - t
        if w <= 0 or h <= 0:
            return None

        src = user32.GetWindowDC(hwnd)
        dst = gdi32.CreateCompatibleDC(src)
        bmp = gdi32.CreateCompatibleBitmap(src, w, h)
        gdi32.SelectObject(dst, bmp)
        gdi32.BitBlt(dst, 0, 0, w, h, src, 0, 0, SRCCOPY)

        satir = (w * 3 + 3) & ~3          # BMP satırları 4 bayta hizalı
        veri = ctypes.create_string_buffer(satir * h)

        class BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [
                ("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
                ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD),
                ("biXPelsPerMeter", wintypes.LONG),
                ("biYPelsPerMeter", wintypes.LONG),
                ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD),
            ]

        bi = BITMAPINFOHEADER()
        bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bi.biWidth = w
        bi.biHeight = h
        bi.biPlanes = 1
        bi.biBitCount = 24
        bi.biCompression = 0
        gdi32.GetDIBits(dst, bmp, 0, h, veri, ctypes.byref(bi), 0)

        yol = os.path.join(dizin, f"{ad}.bmp")
        dosya_boyu = 14 + bi.biSize + len(veri)
        with open(yol, "wb") as fh:
            fh.write(b"BM")
            fh.write(dosya_boyu.to_bytes(4, "little"))
            fh.write((0).to_bytes(4, "little"))
            fh.write((14 + bi.biSize).to_bytes(4, "little"))
            fh.write(bytes(bi))
            fh.write(veri.raw)

        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(dst)
        user32.ReleaseDC(hwnd, src)
        return yol
    except Exception:
        # Teşhis görüntüsü alınamaması, asıl hatayı gölgelememeli.
        return None


def one_getir(hwnd: int) -> bool:
    user32.SetForegroundWindow(hwnd)
    time.sleep(0.3)
    return user32.GetForegroundWindow() == hwnd
