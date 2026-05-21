/**
 * Tool schemas exposed to Gemini's function-calling API.
 *
 * Each tool description is written for the model. It must explain WHEN to use
 * the tool and HOW to combine it with other tools. We keep them short but
 * concrete — the model reads these as the only documentation of the system.
 */
import type { GeminiFunctionDeclaration } from '@/lib/ai/geminiClient';

export const TOOL_SCHEMAS: GeminiFunctionDeclaration[] = [
  {
    name: 'resolve_entities',
    description:
      'Sorgudaki belirsiz isimleri sistem verilerine çözümler. Hastane/laboratuvar, ürün/test/kit veya cihaz arıyorsan ÖNCE bunu çağır. Kısaltma, eksik yazım ve takma adlar desteklenir (örn. "zkm" → Zeynep Kamil, "tsh" → TSH ELECSYS, "501" → Cobas 501). Geri dönen liste güven puanına göre sıralıdır — en yüksek skorlu adayı kullan, gerekirse kullanıcıya doğrula.',
    parameters: {
      type: 'object',
      properties: {
        hospitals_query: { type: 'string', description: 'Hastane/lab adı veya kısaltması (ör. "zkm", "feriha öz").' },
        products_query: { type: 'string', description: 'Ürün/test/kit adı veya kodu (ör. "crp", "tsh", "07298881190").' },
        devices_query: { type: 'string', description: 'Cihaz modeli/markası/seri (ör. "cobas 501", "e801", "sysmex").' },
        limit: { type: 'number', description: 'Her kategori için maksimum sonuç (varsayılan 5).' },
      },
      required: [],
    },
  },
  {
    name: 'list_hospitals',
    description:
      'Kullanıcının erişebildiği tüm hastane/laboratuvarları listeler. Kullanıcı genel envanter sorduğunda veya kapsam öğrenmek istediğinde kullan.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_product_definition',
    description:
      'Bir ürünün tanım kartını döner: stokKodu, stokAdı, marka, testAdı, cihazGrubu, ambalajDegeri (kutu başına test sayısı), urunGrubu (kit/sarf). "CRP testi ne?" gibi sorularda ürünün hangi kite bağlandığını anlamak için kullan.',
    parameters: {
      type: 'object',
      properties: {
        stokKodu: { type: 'string', description: 'Tam ürün kodu.' },
        searchText: { type: 'string', description: 'Bilinmiyorsa serbest metin (test adı/alias).' },
      },
      required: [],
    },
  },
  {
    name: 'get_lab_stock',
    description:
      'Belirli bir laboratuvarın güncel stokunu döner. Lot, miad ve birim sayısı içerir. ÜRÜN ile filtrelemek HER ZAMAN tercih edilir — boş bırakırsan tüm stok döner ve büyük olur. Soruda "X labında Y ürünü" geçiyorsa hospitalId VE stokKodu birlikte ver.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string', description: 'Hastane/lab ID. resolve_entities ile çözülmüş olmalı.' },
        stokKodu: { type: 'string', description: 'Belirli bir ürün kodu (opsiyonel).' },
        urunGrubu: { type: 'string', description: 'Sadece "kit" veya "sarf" filtrelemek için.' },
        limit: { type: 'number', description: 'Maks. lot kaydı (varsayılan 200).' },
      },
      required: ['hospitalId'],
    },
  },
  {
    name: 'get_depot_stock',
    description:
      'Depo stoğunu döner (henüz lab\'a sevk edilmemiş). Sipariş/sevk önerisi yaparken kullan.',
    parameters: {
      type: 'object',
      properties: {
        depotId: { type: 'string', description: 'Depo ID (opsiyonel).' },
        stokKodu: { type: 'string', description: 'Ürün kodu (opsiyonel — yoksa tüm ürünler).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_min_max_rules',
    description:
      'Bir laboratuvarın min/max stok kurallarını döner. "Düşük stok" veya "ihtiyacı olan lablar" sorgularında kritik.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string', description: 'Sadece bu ürün için.' },
      },
      required: ['hospitalId'],
    },
  },
  {
    name: 'get_consumption',
    description:
      'Tüketim kayıtlarını döner. Bir hastane veya ürün için son N gündeki tüketim sıklığını ve toplamını verir. "Tüketim sıklığı", "kaç adet kullanılıyor" sorularında kullan.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number', description: 'Geriye dönük gün (varsayılan 30).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_expiring_stock',
    description:
      'Önümüzdeki N gün içinde miadı dolacak stoğu döner (en yakın miad önce). Bir lab veya tüm sistem için.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string', description: 'Boş bırakılırsa erişimi olan tüm lablar.' },
        days: { type: 'number', description: 'Eşik gün (varsayılan 90).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_efficiency',
    description:
      'Total verimlilik kümülatif verisi. hospitalId zorunlu. year/month verilmezse son ayı döner. "En son kaç testlik girilmiş" sorularında kullan. verimlilikSonuclari (ürün bazlı verimlilik analizi) ve hesaplananTestBazliTuketim (test başı tüketim) içerir.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        year: { type: 'number' },
        month: { type: 'number', description: '1-12' },
        months: { type: 'number', description: 'Son N ayı al (year/month yerine).' },
      },
      required: ['hospitalId'],
    },
  },
  {
    name: 'get_devices',
    description:
      'Bir laboratuvardaki tanımlı cihazları, varsa test dağılımını döner. Bir testin hangi cihazda çalıştığını bulmak için kullan.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        model: { type: 'string', description: 'Model filtresi (kısmi).' },
        brand: { type: 'string', description: 'Marka filtresi.' },
      },
      required: [],
    },
  },
  {
    name: 'get_device_faults',
    description:
      'Cihaz arıza kayıtları. status değerleri otomatik normalize edilir: "closed" → cozuldu, "open" → atama_bekliyor|mudahale_bekliyor|mudahale_ediliyor. "En son çözülen arıza" gibi sorularda latest=true ver. Strict filtre boş dönerse motor otomatik client-side fallback uygular.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        status: {
          type: 'string',
          description: 'closed | cozuldu | open | acik | atama_bekliyor | mudahale_bekliyor | mudahale_ediliyor | all. closed ve cozuldu eşdeğer; open hepsini kapsar.',
        },
        faultType: { type: 'string', description: 'teknik_servis | aplikasyon' },
        days: { type: 'number', description: 'Son N gün (opsiyonel).' },
        latest: {
          type: 'boolean',
          description: 'true: en son N kayıt (orderBy descending). "en son arıza", "son kapanan arıza" sorularında kullan.',
        },
        orderBy: { type: 'string', description: 'openedAt | closedAt | assignedAt (varsayılan: latest=true ise closedAt, değilse openedAt).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_recent_stock_entries',
    description:
      'Bir lab veya tüm sistem için son depo stok girişlerini (depoya yeni gelen ürünler) döner. "En son kaç adet stok girişi olmuş" sorularında kullan.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number', description: 'Son N gün (varsayılan 30).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_orders',
    description:
      'Sipariş kayıtları. status: pending|toplaniyor|completed|all. Açık siparişleri ve son tamamlanan siparişleri görmek için.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        status: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'find_labs_low_on_product',
    description:
      'Belirli bir ürünün stoğu min sınır altında olan veya hiç bulunmayan tüm lab\'ları listeler. Sipariş/transfer önerisi yaparken kullan.',
    parameters: {
      type: 'object',
      properties: {
        stokKodu: { type: 'string' },
        belowPercent: { type: 'number', description: 'Min\'ın yüzde kaçının altı? (varsayılan 100 = min altı)' },
      },
      required: ['stokKodu'],
    },
  },

  /* ===== ARIZA DERİN ANALİZ ============================================== */
  {
    name: 'get_fault_detail',
    description:
      'Bir arıza kaydının TÜM zaman çizelgesini döner: açılış → atama → müdahale başlangıcı → kapanış. Süreler (atamaBekmeSuresi, mudahaleBekmeSuresi, cozumSuresi, toplamCozumSuresi) ve ilgili kişiler (openedByName, assignedToName, closedByName, supportPersonnelName) dahil. Sadece bir arızanın detayını öğrenmek için kullan.',
    parameters: {
      type: 'object',
      properties: {
        faultId: { type: 'string', description: 'deviceFaultReports doc id.' },
      },
      required: ['faultId'],
    },
  },
  {
    name: 'get_device_fault_history',
    description:
      'Bir cihazın geçmiş tüm arıza kayıtlarını döner (en yeniden eskiye). Cihazın güvenilirliği, tekrarlayan arıza paterni, çözüm sürelerinin trendi için kullan.',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        serial: { type: 'string', description: 'Alternatif: cihaz seri numarası.' },
        days: { type: 'number', description: 'Son N gün (opsiyonel).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_fault_sla_violations',
    description:
      'SLA ihlali olan açık/kapalı arızaları döner. Eşik milisaniye veya saat olarak verilebilir. "Müdahale 8 saati geçti", "atama gecikti" gibi sorularda kullan.',
    parameters: {
      type: 'object',
      properties: {
        thresholdHours: { type: 'number', description: 'Eşik saat (varsayılan 8).' },
        scope: { type: 'string', description: 'toplam | mudahale | atama (hangi süre kontrol edilsin)' },
        status: { type: 'string', description: 'open | closed | all' },
        days: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_fault_action_forms',
    description:
      'Arıza için doldurulmuş müdahale formlarını döner. Form içeriği (ön sorular, yapılan işlemler, ürün değişimi, imzalar) görmek için. faultType=aplikasyon ise aplikasyonActionForms, teknik_servis ise teknikServisActionForms.',
    parameters: {
      type: 'object',
      properties: {
        faultId: { type: 'string' },
        deviceId: { type: 'string' },
        faultType: { type: 'string', description: 'aplikasyon | teknik_servis' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_lab_devices_status',
    description:
      'Bir lab\'daki tüm cihazların güncel durumunu döner: arıza durumu (devices.arizaDurumu), aktif/açık arıza, testDagilimi. Bir lab için "çalışıyor/durduruldu" panoraması.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
      },
      required: ['hospitalId'],
    },
  },

  /* ===== KULLANICI / PERSONEL ============================================ */
  {
    name: 'get_user_profile',
    description:
      'Bir kullanıcının profili: rol, atanmış laboratuvarlar/depo/marka, e-posta, oluşturulma. UID, e-posta veya isimle aranabilir.',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string', description: 'Tam veya kısmi ad.' },
      },
      required: [],
    },
  },
  {
    name: 'list_users',
    description:
      'Şirket içi kullanıcıları listeler. Rol veya atanmış lab\'a göre filtre uygulanabilir.',
    parameters: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'super_admin | admin | user | teknik_servis | aplikasyon | teknisyen | satin_alma' },
        labId: { type: 'string', description: 'assignedLaboratories içinde bu lab geçenler.' },
        depotId: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_user_activity',
    description:
      'Bir kullanıcının son aktivitelerini birleştirir: oluşturduğu siparişler, açtığı/atandığı/kapattığı arızalar, transferleri, masraf talepleri, tüketim kayıtları. Performans / iş yükü analizi için kullan.',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string' },
        days: { type: 'number', description: 'Geriye dönük gün (varsayılan 30).' },
      },
      required: ['uid'],
    },
  },
  {
    name: 'get_personnel_record',
    description:
      'Personel HR kaydı: pozisyon, assignedLabIds, primaryLabId, aylik brüt maaş, yan haklar, currency, başlama tarihi, aktif/pasif. **Maaş bilgisi yalnızca admin yetkili kullanıcılara döner.**',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'Bağlı kullanıcı uid.' },
        name: { type: 'string', description: 'Personel adı (kısmi).' },
        labId: { type: 'string', description: 'Belirli bir lab\'a atanmış personeller.' },
        includeSalary: { type: 'boolean', description: 'Maaş alanları döndürülsün mü (admin only).' },
      },
      required: [],
    },
  },
  {
    name: 'get_personnel_availability',
    description:
      'Personelin izin / eğitim / dışarıda olma kayıtları. Tarih aralığında kim müsait değil sorularında kullan.',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string' },
        from: { type: 'string', description: 'ISO date (YYYY-MM-DD).' },
        to: { type: 'string' },
        type: { type: 'string', description: 'office | training | leave' },
      },
      required: [],
    },
  },
  {
    name: 'get_expense_periods',
    description:
      'Masraf talep dönemleri (expensePeriods). pending → approved/rejected akışı. Toplam tutar, kategori dağılımı içerir.',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'ownerUid.' },
        status: { type: 'string', description: 'pending | approved | rejected | all' },
        year: { type: 'number' },
        month: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_overtime_requests',
    description: 'Ek mesai talepleri (overtimeRequests). status filtresi destekler.',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string' },
        status: { type: 'string' },
        days: { type: 'number' },
      },
      required: [],
    },
  },

  /* ===== SİPARİŞ / SEVK / TRANSFER / İADE / KABUL ======================= */
  {
    name: 'get_shipments',
    description:
      'Depodan lab\'a yapılan sevkiyat kayıtları. orderId üzerinden siparişe bağlanır. items[] içinde lot/seri/miktar bulunur.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string', description: 'Hedef lab id (recipientHospital eşleştirilir).' },
        orderId: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_transfers',
    description:
      'Depo↔depo veya depo↔lab transferleri (transfers koleksiyonu). itemCount alanı var; detaylı kalemler subcollection\'da (items). Direkt transferler için sourceDepotId=DIREKT.',
    parameters: {
      type: 'object',
      properties: {
        sourceDepotId: { type: 'string' },
        targetName: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_verification_reports',
    description:
      'Mal kabul / sevkiyat / sayım / imha doğrulama raporları. durum (KABUL EDİLDİ, KABUL EDİLMEDİ, SAYIMDA EKSİK, ...) ve raporTipi filtreleri.',
    parameters: {
      type: 'object',
      properties: {
        ilgiliBelgeId: { type: 'string', description: 'Sipariş/sevk/sayım belge id\'si.' },
        raporTipi: { type: 'string', description: 'mal_kabul | sevkiyat | sayim | imha' },
        durum: { type: 'string' },
        hedefKurum: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_product_returns',
    description: 'Ürün iade kayıtları (productReturns). Lab → depo geri dönüş hareketleri.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },

  /* ===== EJECTED / DESTROYED / TRASH ===================================== */
  {
    name: 'get_ejected_kits',
    description:
      'Cihazdan hatayla çıkarılan kit kayıtları (ejectedKitRecords). deviceId / faultReportId ile arıza\'ya bağlanır. testCount kalan test sayısını verir.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        deviceId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_destroyed_kits',
    description:
      'İmha edilmiş kit kayıtları (destroyedKitsReports). sourceType: barcode|excel|fault. resolvedAt zamanı, kalan test sayısı.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        depotId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_trash_bin',
    description: 'Çöp kutusu kayıtları (trashBinRecords). Kalan testleri ile ele alınması/imhası bekleyen kitler.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        deviceId: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },

  /* ===== TALEP / BİLDİRİM / SAYIM ======================================== */
  {
    name: 'get_user_requests',
    description:
      'Kullanıcı talepleri (userRequests): bug, improvement, feature, design. status: open|reviewing|done. priority: low|normal|urgent.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        priority: { type: 'string' },
        status: { type: 'string' },
        assignedTo: { type: 'string' },
        createdBy: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_notifications',
    description: 'Sistemde oluşturulan bildirimler (notifications). Tür ve hedef bazlı filtre.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: 'order_created | fault_opened | fault_closed | weekly_plan_approval_requested ...' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_count_sessions',
    description:
      'Sayım oturumları: depotStockCountSessions, depotBrandCountSessions veya maliyetSayimSessions. status (active|completed). location filtresi.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'depot_stock | depot_brand | maliyet (varsayılan depot_stock)' },
        locationId: { type: 'string', description: 'depotId veya labId.' },
        status: { type: 'string' },
        days: { type: 'number' },
      },
      required: [],
    },
  },

  /* ===== BAKIM / PERIYODIK PARÇA ========================================= */
  {
    name: 'get_maintenance',
    description:
      'Bakım planları (maintenancePlans) ve bakım kayıtları (maintenanceLogs). Cihaza göre yaklaşan bakımlar veya tamamlanmış bakımları döner.',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        hospitalId: { type: 'string' },
        kind: { type: 'string', description: 'plans | logs (varsayılan plans)' },
        upcomingDays: { type: 'number', description: 'plans için: önümüzdeki N gün.' },
      },
      required: [],
    },
  },

  /* ===== MAL KABUL / VERİMLİLİK / TÜKETİM EK ============================= */
  {
    name: 'get_mal_kabul_history',
    description:
      'Mal kabul (malKabulTransactions) geçmişi. Depo bazında, tarih aralığında, irsaliye no veya tedarikçi ile filtrelenebilir. lines alt-koleksiyonu kalem detaylarını içerir.',
    parameters: {
      type: 'object',
      properties: {
        depotId: { type: 'string' },
        days: { type: 'number' },
        irsaliyeNo: { type: 'string' },
        supplierName: { type: 'string' },
        includeLines: { type: 'boolean', description: 'İlk N kayıt için kalem detaylarını da getir.' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_central_orders',
    description:
      'Merkez sipariş kayıtları (centralOrders). Şirket merkezinden ana tedarikçiye yapılan ana sipariş akışı.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_consumable_requests',
    description: 'Lab kaynaklı sarf talep akışı (consumableRequests). Onay-bekleyen ve karşılanan talepler.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        status: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_total_efficiency_records',
    description:
      'Total verimlilik ana kayıtları (totalEfficiencyRecords). Lab × ay bazlı satır seti — başlangıç stoğu, cihaz üstü, sevkiyat, tüketim, hesaplanan verimlilik.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        labId: { type: 'string', description: 'hospitalId ile eş anlamlı.' },
        stokKodu: { type: 'string' },
        year: { type: 'number' },
        month: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_cihaz_ustu_history',
    description: 'Verimlilik ara kaydı: cihaz üstü stok geçmişi (cihazUstuGecmisi). period (YYYY-MM) bazlı ürün/cihaz stoğu.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        period: { type: 'string', description: 'YYYY-MM formatında ay.' },
        stokKodu: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_kumulatif_raporlar',
    description: 'Kümülatif test raporları (kumulatifRaporlar). Manuel girilen kümülatif analiz çıktıları.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_cost_checkpoints',
    description:
      'Maliyet checkpoint kayıtları (costCheckpoints). Aylık maliyet kontrol noktaları — test başı maliyet, lab başı maliyet trendleri.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        year: { type: 'number' },
        month: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_daily_consumption_stats',
    description: 'Günlük tüketim istatistikleri (dailyConsumptionStats). Lab × ürün × gün özet sayıları.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        stokKodu: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_nfc_disposal_events',
    description: 'NFC ile imha doğrulama olayları (nfcDisposalEvents). Saha imha doğrulama akışı.',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },

  /* ===== CİHAZ YÖNETİMİ EK ================================================ */
  {
    name: 'get_device_model_definitions',
    description: 'Cihaz model tanımları (deviceModelDefinitions). Sistemde tanımlı tüm cihaz modelleri + özellikleri.',
    parameters: { type: 'object', properties: { brand: { type: 'string' }, model: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_device_brand_models',
    description: 'Marka-model eşleştirmesi kataloğu (deviceBrandModels).',
    parameters: { type: 'object', properties: { brand: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_fault_definitions',
    description: 'Sistemde tanımlı arıza tipi tanımları (faultDefinitions). type alanı ile filtrelenebilir (teknik_servis|aplikasyon).',
    parameters: {
      type: 'object',
      properties: { type: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_periodic_part_changes',
    description:
      'Periyodik parça değişim planları (periodicPartChanges) ve değişim logları (periodicPartChangeLogs). Cihaza bağlı planlı parça değişimleri.',
    parameters: {
      type: 'object',
      properties: {
        deviceId: { type: 'string' },
        hospitalId: { type: 'string' },
        kind: { type: 'string', description: 'plans | logs (varsayılan plans)' },
      },
      required: [],
    },
  },
  {
    name: 'get_hospital_device_assignments',
    description: 'Hastane-cihaz atamaları (hospitalDeviceAssignments). Hangi cihaz hangi laba atanmış.',
    parameters: {
      type: 'object',
      properties: { hospitalId: { type: 'string' }, deviceId: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_other_company_faults',
    description: 'Diğer firma cihazlarına ait arıza kayıtları (digerFirmaArizalar).',
    parameters: {
      type: 'object',
      properties: {
        hospitalId: { type: 'string' },
        status: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },

  /* ===== YEDEK PARÇA SİSTEMİ ============================================= */
  {
    name: 'get_spare_part_stock',
    description: 'Yedek parça depo stoku (yedekParcaDepoStok). Depo bazında parça stoğu, lot, miad.',
    parameters: {
      type: 'object',
      properties: {
        depotId: { type: 'string' },
        partCode: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_spare_part_min_max',
    description: 'Yedek parça min/max kuralları (yedekParcaDepoMinMax).',
    parameters: {
      type: 'object',
      properties: { depotId: { type: 'string' }, partCode: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_spare_part_log',
    description: 'Yedek parça depo log\'u (yedekParcaDepoLog). Tüm parça giriş/çıkış/transfer hareketleri.',
    parameters: {
      type: 'object',
      properties: {
        depotId: { type: 'string' },
        partCode: { type: 'string' },
        days: { type: 'number' },
        action: { type: 'string', description: 'Hareket tipi (giris|cikis|transfer|iade|imha).' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_spare_part_orders',
    description: 'Yedek parça siparişleri (yedekParcaSiparisler).',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_spare_part_transfers',
    description: 'Yedek parça transfer log\'ları (sparePartTransferLogs). action: kullanim|iade|transfer|imha.',
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Aktör kullanıcı uid.' },
        action: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_personal_spare_stock',
    description: 'Kişisel zimmetli yedek parça stoğu (personalStock). userId ile filtrelenebilir.',
    parameters: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        partCode: { type: 'string' },
        status: { type: 'string', description: 'in_stock | used | pending_return' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_pool_warehouse_stock',
    description: 'Havuz depo yedek parça stoğu (poolWarehouseStock).',
    parameters: {
      type: 'object',
      properties: { poolId: { type: 'string' }, partCode: { type: 'string' }, status: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_pending_returns',
    description: 'Bekleyen yedek parça iadeleri (pendingReturns). İade akışında onay bekleyen kayıtlar.',
    parameters: {
      type: 'object',
      properties: { userId: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_borrowed_spare_parts',
    description: 'Ödünç verilmiş yedek parçalar (borrowedSpareParts).',
    parameters: {
      type: 'object',
      properties: { fromDepotId: { type: 'string' }, toCompany: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'get_post_closure_part_changes',
    description: 'Arıza kapanış sonrası periyodik parça değişimi logları (postClosurePartChangeLogs).',
    parameters: {
      type: 'object',
      properties: { deviceId: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },

  /* ===== YÖNETİM TANIMLARI / KATALOG ===================================== */
  {
    name: 'get_definitions',
    description:
      'Sistem tanımları kataloğu. kind: marka | cihaz_grubu | lab_grubu | birim | urun_grubu | test_grubu | test (sırasıyla def_brands, def_deviceGroups, def_labGroups, def_mainUnits, def_productGroups, def_testGroups, testDefinitions).',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string' },
        searchText: { type: 'string', description: 'İsim/kod kısmi eşleştirme.' },
        limit: { type: 'number' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'get_companies',
    description: 'Şirketler (companies). Multi-tenancy sahibi firmalar.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_depots',
    description: 'Depo kayıtları (depots). Mevcut tüm depolar + adres + map tanımı.',
    parameters: { type: 'object', properties: { companyId: { type: 'string' }, limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_address_definitions',
    description: 'Sistemde tanımlı adres kartları (addressDefinitions).',
    parameters: { type: 'object', properties: { searchText: { type: 'string' }, limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_barcode_formats',
    description: 'Barkod formatı tanımları (barcodeFormats). Marka × format eşleştirmesi, position tanımları.',
    parameters: {
      type: 'object',
      properties: { brand: { type: 'string' }, searchText: { type: 'string' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_assets',
    description: 'Envanter zimmetlenebilir demirbaşlar (assets). Bilgisayar, barkod okuyucu, dolap, klima vb.',
    parameters: {
      type: 'object',
      properties: {
        category: { type: 'string' },
        konum: { type: 'string', description: 'Konum (lab/depo).' },
        zimmetliKisi: { type: 'string' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_asset_categories',
    description: 'Envanter kategorileri (assetCategories).',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_vehicles',
    description: 'Araç envanteri (vehicles). Plaka, marka, model, atanmış sürücü.',
    parameters: { type: 'object', properties: { searchText: { type: 'string' } }, required: [] },
  },
  {
    name: 'get_borc_depots',
    description: 'Borç depoları (borcDepots). Şirketler arası ödünç stok deposu.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_borc_transfers',
    description: 'Borç transfer kayıtları (borcTransfers). Borçlu/alacaklı transferler.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },

  /* ===== RAPORLAMA / DOSYA / SATIN ALMA / LOJİSTİK ====================== */
  {
    name: 'get_irsaliye_files',
    description: 'İrsaliye dosyaları (irsaliyeDosyalari, irsaliyeFiles). OCR tarama, yükleme metadata.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', description: 'dosyalari | files (varsayılan dosyalari)' },
        depotId: { type: 'string' },
        days: { type: 'number' },
        limit: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'get_analysis_results',
    description: 'AI / OCR analiz sonuçları (analysis_results).',
    parameters: { type: 'object', properties: { days: { type: 'number' }, limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_archive_racks',
    description: 'Numune arşiv rafları (archiveRacks). Test örneği saklama rafları + içerik.',
    parameters: {
      type: 'object',
      properties: { hospitalId: { type: 'string' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_routes',
    description: 'Lojistik rotaları (routes). Sevkiyat rotası ve sürücü atamaları.',
    parameters: {
      type: 'object',
      properties: { days: { type: 'number' }, status: { type: 'string' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_purchasing_tasks',
    description: 'Satın alma görevleri (purchasingTasks). Tarihli görev akışı.',
    parameters: {
      type: 'object',
      properties: { status: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_purchasing_workflows',
    description: 'Satın alma iş akışları (purchasingWorkflows). Onay/karar zinciri.',
    parameters: { type: 'object', properties: { limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'get_pending_ceomed_irsaliye',
    description: 'CEOMED entegrasyonundan bekleyen irsaliye kayıtları (pendingCeomedIrsaliye).',
    parameters: { type: 'object', properties: { limit: { type: 'number' }, days: { type: 'number' } }, required: [] },
  },

  /* ===== NÖBET / VARDİYA ================================================ */
  {
    name: 'get_duty_shifts',
    description: 'Nöbet vardiyaları (dutyShifts). Aktif/yaklaşan nöbet listesi.',
    parameters: {
      type: 'object',
      properties: { uid: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_shift_schedules',
    description: 'Vardiya programları (shiftSchedules). Personel × tarih çalışma planı.',
    parameters: {
      type: 'object',
      properties: { uid: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'get_personnel_history',
    description: 'Personel hareket logları (personnelHistoryLogs). Atama/değişim/çıkış olayları.',
    parameters: {
      type: 'object',
      properties: { uid: { type: 'string' }, days: { type: 'number' }, limit: { type: 'number' } },
      required: [],
    },
  },

  /* ===== TEKNİK SERVİS BİLGİ TABANI ===================================== */
  {
    name: 'search_knowledge_base',
    description:
      'Roche Cobas teknik servis dökümanından (teknik_doc.txt) arama yap. Cihaz hata kodları, parça değişim prosedürü, sarf saklama, alarm açıklaması, periyodik bakım gibi konularda KISA alıntı döner. AI-üretimli içerik DEĞİL — orijinal döküman kayıtlı bilgi tabanı.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Aranacak terim/cümle (Türkçe veya İngilizce).' },
        limit: { type: 'number', description: 'Maks. alıntı sayısı (varsayılan 4).' },
      },
      required: ['query'],
    },
  },
];
