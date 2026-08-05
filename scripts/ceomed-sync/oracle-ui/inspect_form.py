"""Ceomed "Çıkış İrsaliyesi" formunun kontrol ağacını çıkarır.

BU BETİK HİÇBİR ŞEY YAZMAZ — yalnızca okur. Amacı, `controls.json` dosyasını
tahminle değil ölçümle doldurmaktır.

Kullanım (Ceomed makinesinde, uygulama AÇIK ve irsaliye formu EKRANDA iken):

    pip install pywinauto
    python inspect_form.py                 # açık pencereleri listeler
    python inspect_form.py --title "Çıkış" # eşleşen pencerenin ağacını döker
    python inspect_form.py --title "Çıkış" --json agac.json

Çıktıdaki her satır bir kontroldür: sınıf adı, otomasyon kimliği, metni ve
kardeşleri arasındaki sırası. `controls.json` içindeki alanlar bu değerlerle
doldurulur.

NEDEN SIRA (index) SON ÇARE: Delphi/VCL formlarında kontrollerin çoğu
`automation_id` taşımaz; geriye sınıf + sıra kalır. Sıra, uygulama güncellemesinde
değişebilecek en kırılgan tanımlayıcıdır. Bir kontrolde `automation_id` veya
kararlı bir `title` varsa ONU kullanın; sırayı yalnızca başka tutamak yoksa yazın.
"""
from __future__ import annotations

import argparse
import json
import sys


def _require_pywinauto():
    try:
        from pywinauto import Desktop  # noqa: F401
    except ImportError:
        print(
            "pywinauto kurulu değil. Ceomed makinesinde:  pip install pywinauto",
            file=sys.stderr,
        )
        raise SystemExit(2)


def list_windows(backend: str) -> None:
    from pywinauto import Desktop

    print(f"--- Görünür pencereler (backend={backend}) ---")
    for w in Desktop(backend=backend).windows():
        try:
            title = w.window_text()
            if not title.strip():
                continue
            print(f"  [{w.class_name()}] {title!r}  handle={w.handle}")
        except Exception:  # pencere kapanmış olabilir
            continue


def dump(node, depth: int, out: list, max_depth: int) -> None:
    if depth > max_depth:
        return
    try:
        info = {
            "depth": depth,
            "class_name": node.class_name(),
            "control_type": getattr(node.element_info, "control_type", None),
            "automation_id": getattr(node.element_info, "automation_id", "") or "",
            "text": (node.window_text() or "")[:120],
            "rect": str(node.rectangle()),
            "is_enabled": node.is_enabled(),
            "is_visible": node.is_visible(),
        }
    except Exception as exc:
        out.append({"depth": depth, "error": str(exc)})
        return

    out.append(info)
    indent = "  " * depth
    print(
        f"{indent}[{info['class_name']}] "
        f"type={info['control_type']} id={info['automation_id']!r} "
        f"text={info['text']!r} {info['rect']}"
    )

    try:
        children = node.children()
    except Exception:
        children = []

    # Aynı sınıftan kardeşlerin kaçıncısı olduğunu yazdır: controls.json'daki
    # "index" alanı tam olarak budur.
    seen: dict[str, int] = {}
    for child in children:
        try:
            cls = child.class_name()
        except Exception:
            cls = "?"
        idx = seen.get(cls, 0)
        seen[cls] = idx + 1
        try:
            child._inspect_index = idx  # type: ignore[attr-defined]
        except Exception:
            pass
        print(f"{indent}  ↳ {cls} #{idx}")
        dump(child, depth + 1, out, max_depth)


def main() -> int:
    parser = argparse.ArgumentParser(description="Ceomed form kontrol ağacı çıkarıcı (salt okuma)")
    parser.add_argument("--title", help="Pencere başlığında geçen metin (regex değil, alt dize)")
    parser.add_argument("--backend", default="win32", choices=["win32", "uia"],
                        help="Delphi/VCL formlarında genelde win32 daha iyi sonuç verir")
    parser.add_argument("--max-depth", type=int, default=6)
    parser.add_argument("--json", dest="json_path", help="Ağacı bu dosyaya JSON olarak yaz")
    args = parser.parse_args()

    _require_pywinauto()
    from pywinauto import Desktop

    if not args.title:
        list_windows(args.backend)
        print("\nAğacı dökmek için:  python inspect_form.py --title \"<başlık parçası>\"")
        return 0

    matches = [
        w for w in Desktop(backend=args.backend).windows()
        if args.title.lower() in (w.window_text() or "").lower()
    ]
    if not matches:
        print(f"'{args.title}' içeren pencere bulunamadı.", file=sys.stderr)
        list_windows(args.backend)
        return 1
    if len(matches) > 1:
        # Yanlış pencereye yazmak, hiç yazmamaktan kötüdür — belirsizliği kapatma.
        print(f"UYARI: {len(matches)} pencere eşleşti, ilki dökülüyor:", file=sys.stderr)
        for w in matches:
            print(f"  - {w.window_text()!r}", file=sys.stderr)

    out: list = []
    dump(matches[0], 0, out, args.max_depth)

    if args.json_path:
        with open(args.json_path, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=2)
        print(f"\nJSON yazıldı: {args.json_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
