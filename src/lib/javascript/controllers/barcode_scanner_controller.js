// app/javascript/controllers/barcode_scanner_controller.js
import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    formatsUrl: String,      // e.g. "/api/barcode_formats"
    productApiUrl: String    // e.g. "/api/products/by_reference"
  }

  connect() {
    this.loadFormats()
    this.element.addEventListener("keydown", async e => {
      if (e.key === "Enter") {
        e.preventDefault()
        await this.handleScan(this.element.value.trim())
      }
    })
  }

  async loadFormats() {
    try {
      const res = await fetch(this.formatsUrlValue)
      this.formats = await res.json()
    } catch (err) {
      console.error("Format yüklenemedi:", err)
      this.formats = []
    }
  }

  async handleScan(raw) {
    if (!raw) return
    for (let fmt of this.formats || []) {
      try {
        const re = new RegExp(fmt.regex)
        const m = raw.match(re)
        if (m) {
          const refIndex = fmt.fields.reference
          const reference = m[refIndex]
          try {
            const pr = await fetch(
              `${this.productApiUrlValue}?reference=${encodeURIComponent(reference)}`
            )
            if (pr.ok) {
              const product = await pr.json()
              this.dispatch("scanned", {
                detail: { format: fmt.name, product, parsedFields: m.slice(1) }
              })
              return; // EXIT HERE on first success
            } else {
               // If product not found for this format, continue to the next format
               continue;
            }
          } catch (err) {
            this.dispatch("error", {
              detail: { message: "Ürün sorgulama hatası." }
            })
            return; // Exit on network/server error
          }
        }
      } catch (e) {
         console.error(`Regex error for format ${fmt.name}:`, e);
         continue; // Skip faulty regex and try next format
      }
    }
    // If loop completes without any format matching and returning
    this.dispatch("error", { detail: { message: "Hiçbir formata uymadı." } })
  }
}
