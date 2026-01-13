import { adminDb } from '@/lib/firebase-admin';
import { ToolResult, OrderPlan, pendingPlans, AgentToolName } from './tools';
import { nanoid } from 'nanoid';
import type { Timestamp } from 'firebase-admin/firestore';

// Helper: Timestamp to string
function timestampToString(ts: Timestamp | Date | undefined): string {
  if (!ts) return '';
  if (ts instanceof Date) return ts.toISOString().split('T')[0];
  return (ts as Timestamp).toDate().toISOString().split('T')[0];
}

// ============ READ ACTIONS ============

interface LabStockStatusParams {
  labId?: string;
  labName?: string;
  belowThreshold?: number;
}

export async function getLabStockStatus(params: LabStockStatusParams): Promise<ToolResult> {
  try {
    // Get hospitals
    const hospitalsSnap = await adminDb.collection('hospitals').get();
    const hospitals = hospitalsSnap.docs.map(d => ({
      id: d.id,
      name: d.data().name || d.data().ad || 'Bilinmiyor',
    }));

    // Filter by labId or labName if provided
    let filteredHospitals = hospitals;
    if (params.labId) {
      filteredHospitals = hospitals.filter(h => h.id === params.labId);
    } else if (params.labName) {
      const searchName = params.labName.toLowerCase();
      filteredHospitals = hospitals.filter(h =>
        h.name.toLowerCase().includes(searchName)
      );
    }

    const results = [];

    for (const hospital of filteredHospitals.slice(0, 20)) {
      // Get min/max rules for this hospital
      const rulesSnap = await adminDb
        .collection('hospitals')
        .doc(hospital.id)
        .collection('minMaxRules')
        .get();

      if (rulesSnap.empty) continue;

      const rules = rulesSnap.docs.map(d => ({
        stokKodu: d.data().stokKodu,
        stokAdi: d.data().stokAdi || d.id,
        min: d.data().min || 0,
        max: d.data().max || 0,
      }));

      // Get current stock for this hospital
      const stockSnap = await adminDb
        .collection('depoStok')
        .where('hedefKurumId', '==', hospital.id)
        .where('isShipped', '==', true)
        .get();

      // Count stock by product
      const stockByProduct: Record<string, number> = {};
      for (const doc of stockSnap.docs) {
        const data = doc.data();
        const code = data.stokKodu;
        stockByProduct[code] = (stockByProduct[code] || 0) + 1;
      }

      // Calculate status for each rule
      const productStatuses = rules.map(rule => {
        const currentStock = stockByProduct[rule.stokKodu] || 0;
        const fillRate = rule.max > 0 ? (currentStock / rule.max) * 100 : 0;
        const need = Math.max(0, rule.max - currentStock);

        return {
          stokKodu: rule.stokKodu,
          stokAdi: rule.stokAdi,
          min: rule.min,
          max: rule.max,
          current: currentStock,
          fillRate: Math.round(fillRate),
          need,
          status: currentStock <= rule.min ? 'critical' : fillRate < 50 ? 'low' : 'ok',
        };
      });

      // Filter by threshold if provided
      let filteredProducts = productStatuses;
      if (params.belowThreshold) {
        filteredProducts = productStatuses.filter(p => p.fillRate < params.belowThreshold!);
      }

      if (filteredProducts.length > 0) {
        const avgFillRate = Math.round(
          filteredProducts.reduce((sum, p) => sum + p.fillRate, 0) / filteredProducts.length
        );

        results.push({
          labId: hospital.id,
          labName: hospital.name,
          averageFillRate: avgFillRate,
          totalProducts: filteredProducts.length,
          criticalCount: filteredProducts.filter(p => p.status === 'critical').length,
          lowCount: filteredProducts.filter(p => p.status === 'low').length,
          products: filteredProducts.slice(0, 10), // Limit to 10 products per lab
        });
      }
    }

    return {
      success: true,
      data: {
        totalLabs: results.length,
        labs: results,
      },
    };
  } catch (error) {
    console.error('[Actions] getLabStockStatus error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

interface MinMaxRulesParams {
  labId?: string;
  stokKodu?: string;
}

export async function getMinMaxRules(params: MinMaxRulesParams): Promise<ToolResult> {
  try {
    if (!params.labId) {
      return {
        success: false,
        error: 'labId parametresi gerekli',
      };
    }

    const rulesSnap = await adminDb
      .collection('hospitals')
      .doc(params.labId)
      .collection('minMaxRules')
      .get();

    let rules = rulesSnap.docs.map(d => ({
      stokKodu: d.data().stokKodu || d.id,
      stokAdi: d.data().stokAdi,
      min: d.data().min || 0,
      max: d.data().max || 0,
    }));

    if (params.stokKodu) {
      rules = rules.filter(r => r.stokKodu === params.stokKodu);
    }

    return {
      success: true,
      data: {
        labId: params.labId,
        rulesCount: rules.length,
        rules,
      },
    };
  } catch (error) {
    console.error('[Actions] getMinMaxRules error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

interface DepotStockParams {
  depotId?: string;
  stokKodu?: string;
}

export async function getDepotStock(params: DepotStockParams): Promise<ToolResult> {
  try {
    let query = adminDb.collection('depoStok').where('isShipped', '==', false);

    if (params.depotId) {
      query = query.where('depotId', '==', params.depotId);
    }

    const snapshot = await query.limit(1000).get();

    // Group by product
    const stockByProduct: Record<string, {
      stokKodu: string;
      stokAdi: string;
      count: number;
      lots: Array<{ lot: string; miad: string; count: number }>;
    }> = {};

    for (const doc of snapshot.docs) {
      const data = doc.data();
      const code = data.stokKodu;

      if (params.stokKodu && code !== params.stokKodu) continue;

      if (!stockByProduct[code]) {
        stockByProduct[code] = {
          stokKodu: code,
          stokAdi: data.stokAdi,
          count: 0,
          lots: [],
        };
      }

      stockByProduct[code].count += 1;

      // Track lots
      const lotKey = data.lotNumarasi || 'unknown';
      const existingLot = stockByProduct[code].lots.find(l => l.lot === lotKey);
      if (existingLot) {
        existingLot.count += 1;
      } else {
        stockByProduct[code].lots.push({
          lot: lotKey,
          miad: timestampToString(data.miad),
          count: 1,
        });
      }
    }

    const products = Object.values(stockByProduct);

    return {
      success: true,
      data: {
        totalProducts: products.length,
        totalItems: products.reduce((sum, p) => sum + p.count, 0),
        products: products.slice(0, 50),
      },
    };
  } catch (error) {
    console.error('[Actions] getDepotStock error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

interface LabsNeedingProductParams {
  stokKodu?: string;
  stokAdi?: string;
}

export async function getLabsNeedingProduct(params: LabsNeedingProductParams): Promise<ToolResult> {
  try {
    if (!params.stokKodu && !params.stokAdi) {
      return {
        success: false,
        error: 'stokKodu veya stokAdi parametresi gerekli',
      };
    }

    // Get all hospitals with minMaxRules
    const hospitalsSnap = await adminDb.collection('hospitals').get();
    const results = [];

    for (const hospitalDoc of hospitalsSnap.docs) {
      const hospitalData = hospitalDoc.data();
      const hospitalName = hospitalData.name || hospitalData.ad || 'Bilinmiyor';

      // Get minMaxRules for this hospital
      const rulesSnap = await adminDb
        .collection('hospitals')
        .doc(hospitalDoc.id)
        .collection('minMaxRules')
        .get();

      // Find the rule for this product
      let matchedRule = null;
      for (const ruleDoc of rulesSnap.docs) {
        const ruleData = ruleDoc.data();
        if (params.stokKodu && ruleData.stokKodu === params.stokKodu) {
          matchedRule = ruleData;
          break;
        }
        if (params.stokAdi && ruleData.stokAdi?.toLowerCase().includes(params.stokAdi.toLowerCase())) {
          matchedRule = ruleData;
          break;
        }
      }

      if (!matchedRule) continue; // Product not assigned to this lab

      // Get current stock
      const stockSnap = await adminDb
        .collection('depoStok')
        .where('hedefKurumId', '==', hospitalDoc.id)
        .where('stokKodu', '==', matchedRule.stokKodu)
        .where('isShipped', '==', true)
        .get();

      const currentStock = stockSnap.size;
      const need = Math.max(0, (matchedRule.max || 0) - currentStock);

      if (currentStock < (matchedRule.min || 0) || need > 0) {
        results.push({
          labId: hospitalDoc.id,
          labName: hospitalName,
          stokKodu: matchedRule.stokKodu,
          stokAdi: matchedRule.stokAdi,
          currentStock,
          min: matchedRule.min || 0,
          max: matchedRule.max || 0,
          need,
          status: currentStock === 0 ? 'empty' : currentStock < matchedRule.min ? 'critical' : 'low',
        });
      }
    }

    // Sort by need (descending)
    results.sort((a, b) => b.need - a.need);

    return {
      success: true,
      data: {
        totalLabsNeedingProduct: results.length,
        totalNeed: results.reduce((sum, r) => sum + r.need, 0),
        labs: results,
      },
    };
  } catch (error) {
    console.error('[Actions] getLabsNeedingProduct error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

// ============ ACTION TOOLS ============

interface CreateOrderPlanParams {
  orders: Array<{
    labId: string;
    labName: string;
    depotId?: string;
    depotName?: string;
    items: Array<{
      stokKodu: string;
      stokAdi: string;
      adet: number;
      reason?: string;
    }>;
  }>;
  reason: string;
}

export async function createOrderPlan(params: CreateOrderPlanParams): Promise<ToolResult> {
  try {
    if (!params.orders || params.orders.length === 0) {
      return {
        success: false,
        error: 'En az bir sipariş gerekli',
      };
    }

    const planId = nanoid(10);
    const totalItems = params.orders.reduce(
      (sum, order) => sum + order.items.reduce((s, item) => s + item.adet, 0),
      0
    );

    const plan: OrderPlan = {
      id: planId,
      createdAt: new Date(),
      orders: params.orders,
      reason: params.reason,
      status: 'pending_confirmation',
      totalItems,
      totalLabs: params.orders.length,
    };

    // Store in memory (in production, use Redis or DB)
    pendingPlans.set(planId, plan);

    // Auto-expire after 10 minutes
    setTimeout(() => {
      const p = pendingPlans.get(planId);
      if (p && p.status === 'pending_confirmation') {
        pendingPlans.delete(planId);
      }
    }, 10 * 60 * 1000);

    return {
      success: true,
      requiresConfirmation: true,
      planId,
      data: {
        planId,
        summary: {
          totalLabs: plan.totalLabs,
          totalItems: plan.totalItems,
          reason: plan.reason,
        },
        orders: plan.orders.map(o => ({
          labName: o.labName,
          itemCount: o.items.length,
          totalQuantity: o.items.reduce((s, i) => s + i.adet, 0),
          items: o.items,
        })),
        message: `${plan.totalLabs} laboratuvar için toplam ${plan.totalItems} adet ürün siparişi planlandı. Onaylamak için "Evet, siparişleri oluştur" veya "planı onayla" yazın.`,
      },
    };
  } catch (error) {
    console.error('[Actions] createOrderPlan error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

interface ExecuteOrderPlanParams {
  planId: string;
  confirmedBy?: string;
}

export async function executeOrderPlan(params: ExecuteOrderPlanParams): Promise<ToolResult> {
  try {
    const plan = pendingPlans.get(params.planId);

    if (!plan) {
      return {
        success: false,
        error: 'Plan bulunamadı veya süresi dolmuş. Lütfen yeni bir plan oluşturun.',
      };
    }

    if (plan.status !== 'pending_confirmation') {
      return {
        success: false,
        error: `Plan durumu geçersiz: ${plan.status}`,
      };
    }

    // Mark as confirmed first
    plan.status = 'confirmed';

    const createdOrders = [];
    const errors = [];

    for (const order of plan.orders) {
      try {
        // Create order in Firestore
        const orderRef = await adminDb.collection('orders').add({
          labId: order.labId,
          kurumAdi: order.labName,
          depotId: order.depotId || null,
          items: order.items.map(item => ({
            stokKodu: item.stokKodu,
            stokAdi: item.stokAdi,
            adet: item.adet,
          })),
          status: 'pending',
          createdAt: new Date(),
          createdBy: params.confirmedBy || 'AI Agent',
          createdById: 'ai-agent',
          source: 'ai-agent',
          planId: plan.id,
          reason: plan.reason,
        });

        createdOrders.push({
          orderId: orderRef.id,
          labName: order.labName,
          itemCount: order.items.length,
        });
      } catch (err) {
        errors.push({
          labName: order.labName,
          error: err instanceof Error ? err.message : 'Bilinmeyen hata',
        });
      }
    }

    plan.status = 'executed';
    pendingPlans.delete(params.planId);

    return {
      success: true,
      data: {
        message: `${createdOrders.length} sipariş başarıyla oluşturuldu.`,
        createdOrders,
        errors: errors.length > 0 ? errors : undefined,
      },
    };
  } catch (error) {
    console.error('[Actions] executeOrderPlan error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bilinmeyen hata',
    };
  }
}

// ============ TOOL EXECUTOR ============

export async function executeTool(
  toolName: AgentToolName,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  console.log(`[Agent] Executing tool: ${toolName}`, toolInput);

  switch (toolName) {
    case 'get_lab_stock_status':
      return getLabStockStatus(toolInput as LabStockStatusParams);
    case 'get_min_max_rules':
      return getMinMaxRules(toolInput as MinMaxRulesParams);
    case 'get_depot_stock':
      return getDepotStock(toolInput as DepotStockParams);
    case 'get_labs_needing_product':
      return getLabsNeedingProduct(toolInput as LabsNeedingProductParams);
    case 'create_order_plan':
      return createOrderPlan(toolInput as unknown as CreateOrderPlanParams);
    case 'execute_order_plan':
      return executeOrderPlan(toolInput as unknown as ExecuteOrderPlanParams);
    default:
      return {
        success: false,
        error: `Bilinmeyen tool: ${toolName}`,
      };
  }
}
