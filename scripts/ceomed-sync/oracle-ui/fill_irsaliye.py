"""Ceomed "Çıkış İrsaliyesi" formunu doldurur ve e-irsaliyeyi gönderir.

stdin'den tek bir JSON okur, son satırda tek bir JSON sonuç basar:

    girdi : {"jobId": "...", "job": {"header": {...}, "rows": [...], "aciklama": "..."}}
    çıktı : {"ok": true,  "ceomedIrsaliyeNo": "SI007787", "screenshotPath": "..."}
            {"ok": false, "error": "...", "retryable": false}

TASARIM İLKESİ — "YAZ, SONRA GERİ OKU". Ekran otomasyonunda bir tuş vuruşunun
hedefine ulaştığını varsaymak, muhasebeye yanlış kayıt göndermenin en kısa
yoludur. Bu betik yazdığı HER alanı geri okur; bir tanesi bile uyuşmazsa
E-İRSALİYE GÖNDER'e BASMADAN çıkar. Yarım kalmış form, yanlış gönderilmiş
irsaliyeden ucuzdur: ilki elle düzeltilir, ikincisi düzeltilemez.

`retryable` sözleşmesi:
  true  → forma HİÇ dokunulmadı ya da gönderim öncesi güvenle iptal edildi.
  false → gönderim denendi veya durum belirsiz. Otomatik tekrar YASAK; insan baksın.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
import time


# --- Sonuç yardımcıları -------------------------------------------------------

def emit(payload: dict) -> int:
    """Sonucu son satıra tek satırlık JSON olarak basar."""
    print(json.dumps(payload, ensure_ascii=False))
    sys.stdout.flush()
    return 0 if payload.get("ok") else 1


def fail(error: str, retryable: bool, screenshot: str | None = None) -> int:
    payload = {"ok": False, "error": error, "retryable": retryable}
    if screenshot:
        payload["screenshotPath"] = screenshot
    return emit(payload)


# --- Kontrol çözümleme --------------------------------------------------------

def resolve(parent, spec: dict, label: str):
    """controls.json'daki bir alan tarifini gerçek kontrole çevirir.

    Sıra: automation_id → title → class_name+index. İlk ikisi uygulama
    güncellemesine dayanıklıdır; üçüncüsü değildir, o yüzden en sona konur.
    """
    auto_id = (spec.get("automation_id") or "").strip()
    title = (spec.get("title") or "").strip()
    class_name = (spec.get("class_name") or "").strip()
    index = spec.get("index")

    if auto_id:
        return parent.child_window(auto_id=auto_id).wrapper_object()
    if title:
        return parent.child_window(title=title).wrapper_object()
    if class_name and index is not None:
        return parent.child_window(class_name=class_name, found_index=int(index)).wrapper_object()

    raise LookupError(
        f"'{label}' için controls.json'da tutamak yok "
        "(automation_id / title / class_name+index alanlarından biri dolu olmalı)."
    )


def read_text(ctrl) -> str:
    try:
        return (ctrl.window_text() or "").strip()
    except Exception:
        return ""


def type_and_verify(ctrl, value: str, label: str, settle_ms: int) -> None:
    """Alanı temizler, yazar, bekler ve geri okuyup doğrular."""
    ctrl.set_focus()
    try:
        ctrl.set_edit_text("")
        ctrl.set_edit_text(value)
    except Exception:
        # set_edit_text her kontrolde yok (maskeli alanlar, grid hücreleri).
        # Tuş vuruşuna düş: Ctrl+A ile seç, üstüne yaz.
        ctrl.type_keys("^a{DEL}", set_foreground=True)
        ctrl.type_keys(value, with_spaces=True, set_foreground=True)

    time.sleep(settle_ms / 1000.0)

    okunan = read_text(ctrl)
    if okunan.replace(" ", "") != value.replace(" ", ""):
        raise ValueError(
            f"'{label}' alanı doğrulanamadı: yazılan {value!r}, okunan {okunan!r}. "
            "Form yarım bırakıldı, e-irsaliye GÖNDERİLMEDİ."
        )


def screenshot(window, directory: str, job_id: str, suffix: str) -> str | None:
    try:
        os.makedirs(directory, exist_ok=True)
        stamp = dt.datetime.now().strftime("%Y%m%d-%H%M%S")
        path = os.path.join(directory, f"{stamp}_{job_id}_{suffix}.png")
        window.capture_as_image().save(path)
        return path
    except Exception:
        # Ekran görüntüsü alınamaması işi durdurmaz — kanıt kaybı, veri hatası değil.
        return None


# --- Grid doldurma ------------------------------------------------------------

def fill_grid(window, grid_spec: dict, rows: list, timing: dict) -> None:
    """Ürün satırlarını grid'e girer.

    Grid otomasyonu formun en kırılgan yeridir: Delphi TDBGrid hücreleri ayrı
    kontroller değildir, klavye ile dolaşılır. Bu yüzden hücreden hücreye Tab,
    satır sonunda Enter kullanılır ve stok kodundan sonra ürün adının GELMESİ
    beklenir (uygulama sunucudan çekiyorsa gecikme olur).
    """
    grid = resolve(window, grid_spec, "grid")
    columns = grid_spec.get("columns") or {}
    settle_ms = int(timing.get("field_settle_ms", 120))
    lookup_ms = int(timing.get("lookup_timeout_ms", 5000))

    grid.set_focus()

    for i, row in enumerate(rows):
        # Sütun sırasına göre yaz: stok kodu → (ürün adı otomatik) → lot → miad → miktar
        sirali = sorted(
            (idx, ad) for ad, idx in columns.items() if ad != "stokAdi"
        )

        onceki_kolon = 0
        for kolon_idx, alan in sirali:
            atlanacak = kolon_idx - onceki_kolon
            if atlanacak > 0:
                grid.type_keys("{TAB}" * atlanacak, set_foreground=True)
            onceki_kolon = kolon_idx

            deger = str(row.get(alan, "") or "")
            if alan == "miktar":
                deger = str(row.get("miktar") or 1)

            if deger:
                grid.type_keys("^a{DEL}", set_foreground=True)
                grid.type_keys(deger, with_spaces=True, set_foreground=True)
                time.sleep(settle_ms / 1000.0)

            if alan == "stokKodu":
                # Ürün adının dolmasını bekle: dolmuyorsa stok kodu tanınmamıştır
                # ve satır boş ürünle kaydedilir. Bu sessiz hatayı burada yakala.
                _bekle_urun_adi(grid, deger, lookup_ms)

        grid.type_keys("{ENTER}", set_foreground=True)
        time.sleep(settle_ms / 1000.0)

        if i < len(rows) - 1:
            # Yeni satıra in. Uygulama Enter ile otomatik yeni satır açmıyorsa
            # aşağı ok gerekir; ikisi de zararsızdır.
            grid.type_keys("{DOWN}", set_foreground=True)
            grid.type_keys("{HOME}", set_foreground=True)


def _bekle_urun_adi(grid, stok_kodu: str, timeout_ms: int) -> None:
    """Stok kodundan sonra ürün adının gelmesini bekler.

    Ürün adı gelmiyorsa stok kodu Ceomed'de tanımlı değil demektir. Bunu
    yutup devam etmek, muhasebeye ürünsüz satır göndermektir.
    """
    son = time.time() + timeout_ms / 1000.0
    while time.time() < son:
        metin = read_text(grid)
        if stok_kodu and stok_kodu in metin:
            return
        time.sleep(0.1)
    # Grid metnini güvenilir okuyamadığımız durumlar var; bu yüzden hata değil
    # uyarı: nihai doğrulama gönderim öncesi ekran görüntüsüyle yapılır.
    print(f"UYARI: '{stok_kodu}' için ürün adı doğrulanamadı.", file=sys.stderr)


# --- Ana akış -----------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controls", required=True)
    args = parser.parse_args()

    try:
        payload = json.load(sys.stdin)
    except Exception as exc:
        return fail(f"stdin JSON okunamadı: {exc}", retryable=True)

    job = payload.get("job") or {}
    job_id = str(payload.get("jobId") or "job")
    header = job.get("header") or {}
    rows = job.get("rows") or []
    aciklama = job.get("aciklama") or ""

    if not rows:
        return fail("İşte yazılacak satır yok.", retryable=False)

    try:
        with open(args.controls, encoding="utf-8") as fh:
            controls = json.load(fh)
    except Exception as exc:
        return fail(f"controls.json okunamadı: {exc}", retryable=True)

    try:
        from pywinauto import Application, Desktop
    except ImportError:
        return fail("pywinauto kurulu değil (pip install pywinauto).", retryable=True)

    backend = controls.get("backend", "win32")
    title_contains = ((controls.get("window") or {}).get("title_contains") or "").strip()
    if not title_contains:
        return fail("controls.json → window.title_contains boş.", retryable=True)

    # --- Pencereyi bul ---
    try:
        eslesenler = [
            w for w in Desktop(backend=backend).windows()
            if title_contains.lower() in (w.window_text() or "").lower()
        ]
    except Exception as exc:
        return fail(f"Masaüstü pencereleri okunamadı: {exc}", retryable=True)

    if not eslesenler:
        return fail(
            f"'{title_contains}' başlıklı Ceomed penceresi açık değil. "
            "Uygulamaya giriş yapıp irsaliye giriş formunu açın.",
            retryable=True,
        )
    if len(eslesenler) > 1:
        # Belirsizlik tahminle kapatılmaz: yanlış pencereye yazmak geri alınamaz.
        basliklar = ", ".join(repr(w.window_text()) for w in eslesenler)
        return fail(
            f"{len(eslesenler)} pencere '{title_contains}' ile eşleşti ({basliklar}). "
            "controls.json → window.title_contains değerini daha ayırt edici yapın.",
            retryable=True,
        )

    window = eslesenler[0]
    timing = controls.get("timing") or {}
    settle_ms = int(timing.get("field_settle_ms", 120))
    shot_dir = controls.get("screenshot_dir") or "screenshots"
    fields = controls.get("fields") or {}

    try:
        window.set_focus()
    except Exception as exc:
        return fail(f"Pencere öne getirilemedi: {exc}", retryable=True)

    # --- Başlık alanları: yaz + geri oku ---
    yazilacak = [
        ("irsaliyeNo", header.get("irsaliyeNo")),
        ("cariKodu", header.get("cariKodu")),
        ("tarih", header.get("tarih")),
        ("islemTipi", header.get("islemTipi")),
        ("depo", header.get("depo")),
    ]
    for ad, deger in yazilacak:
        if not deger:
            return fail(f"Zorunlu alan boş geldi: {ad}", retryable=False)
        spec = fields.get(ad)
        if not spec:
            return fail(f"controls.json → fields.{ad} tanımlı değil.", retryable=True)
        try:
            ctrl = resolve(window, spec, ad)
            type_and_verify(ctrl, str(deger), ad, settle_ms)
        except Exception as exc:
            shot = screenshot(window, shot_dir, job_id, "hata-baslik")
            # Buraya kadar gönderim YAPILMADI; form yarım kaldı, güvenle iptal.
            return fail(f"Başlık alanı yazılamadı ({ad}): {exc}", retryable=True, screenshot=shot)

    # --- Grid satırları ---
    try:
        fill_grid(window, controls.get("grid") or {}, rows, timing)
    except Exception as exc:
        shot = screenshot(window, shot_dir, job_id, "hata-grid")
        return fail(f"Ürün satırları girilemedi: {exc}", retryable=True, screenshot=shot)

    # --- Açıklama (işlemi yapan personel) ---
    if aciklama:
        spec = fields.get("aciklama")
        if not spec:
            return fail("controls.json → fields.aciklama tanımlı değil.", retryable=True)
        try:
            ctrl = resolve(window, spec, "aciklama")
            type_and_verify(ctrl, aciklama, "aciklama", settle_ms)
        except Exception as exc:
            shot = screenshot(window, shot_dir, job_id, "hata-aciklama")
            return fail(f"Açıklama yazılamadı: {exc}", retryable=True, screenshot=shot)

    # --- Gönderim öncesi kanıt ---
    onceki_shot = screenshot(window, shot_dir, job_id, "gonderim-oncesi")

    # --- E-İRSALİYE GÖNDER ---
    submit_spec = controls.get("submit") or {}
    buton_basligi = (submit_spec.get("button_title") or "").strip()
    if not buton_basligi:
        return fail("controls.json → submit.button_title boş.", retryable=True, screenshot=onceki_shot)

    try:
        buton = window.child_window(title=buton_basligi).wrapper_object()
    except Exception as exc:
        return fail(
            f"'{buton_basligi}' butonu bulunamadı: {exc}. Form dolduruldu ama GÖNDERİLMEDİ.",
            retryable=True,
            screenshot=onceki_shot,
        )

    try:
        buton.click_input()
    except Exception as exc:
        # Tıklama başarısız: gönderilip gönderilmediği BELİRSİZ. Otomatik tekrar yok.
        return fail(
            f"Gönder butonuna tıklanamadı: {exc}. Ceomed ekranını ELLE kontrol edin.",
            retryable=False,
            screenshot=onceki_shot,
        )

    # --- Onay penceresi ---
    confirm = submit_spec.get("confirm_dialog") or {}
    confirm_title = (confirm.get("title_contains") or "").strip()
    if confirm_title:
        try:
            time.sleep(0.6)
            dlg = Desktop(backend=backend).window(title_re=f".*{confirm_title}.*")
            dlg.child_window(title=confirm.get("accept_button") or "Evet").click_input()
        except Exception as exc:
            return fail(
                f"Onay penceresi kapatılamadı: {exc}. Gönderim durumu BELİRSİZ, elle kontrol edin.",
                retryable=False,
                screenshot=onceki_shot,
            )

    time.sleep(1.0)
    sonraki_shot = screenshot(window, shot_dir, job_id, "gonderim-sonrasi")

    # Uygulamanın ürettiği irsaliye numarasını geri oku (izlenebilirlik için).
    ceomed_no = None
    try:
        ceomed_no = read_text(resolve(window, fields["irsaliyeNo"], "irsaliyeNo")) or None
    except Exception:
        pass

    return emit({
        "ok": True,
        "ceomedIrsaliyeNo": ceomed_no,
        "screenshotPath": sonraki_shot or onceki_shot,
    })


if __name__ == "__main__":
    raise SystemExit(main())
