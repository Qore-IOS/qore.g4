// Tool definitions for Gemini Agent
export interface AgentToolSchema {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const AGENT_TOOLS: AgentToolSchema[] = [
  {
    name: 'get_lab_stock_status',
    description: 'Belirli bir laboratuvarın stok durumunu getirir. Stok doluluk oranını, eksik ürünleri ve min/max kurallarını içerir.',
    parameters: {
      type: 'object',
      properties: {
        labId: { type: 'string', description: 'Laboratuvar ID (opsiyonel - boş bırakılırsa tüm lablar)' },
        labName: { type: 'string', description: 'Laboratuvar adı (kısmi eşleşme desteklenir)' },
        belowThreshold: { type: 'number', description: 'Sadece bu yüzdenin altındaki stokları getir (örn: 50 = %50 altı)' },
      },
      required: [],
    },
  },
  {
    name: 'get_min_max_rules',
    description: 'Laboratuvarların min/max stok kurallarını getirir.',
    parameters: {
      type: 'object',
      properties: {
        labId: { type: 'string', description: 'Laboratuvar ID' },
        stokKodu: { type: 'string', description: 'Belirli bir ürün kodu için kuralları getir' },
      },
      required: [],
    },
  },
  {
    name: 'get_depot_stock',
    description: 'Depo stok durumunu getirir.',
    parameters: {
      type: 'object',
      properties: {
        depotId: { type: 'string', description: 'Depo ID' },
        stokKodu: { type: 'string', description: 'Belirli bir ürün kodu' },
      },
      required: [],
    },
  },
  {
    name: 'get_labs_needing_product',
    description: 'Belirli bir ürüne ihtiyacı olan (stok < min veya stok = 0) laboratuvarları listeler.',
    parameters: {
      type: 'object',
      properties: {
        stokKodu: { type: 'string', description: 'Ürün kodu' },
        stokAdi: { type: 'string', description: 'Ürün adı (kısmi eşleşme)' },
      },
      required: [],
    },
  },
  {
    name: 'create_order_plan',
    description: 'Sipariş planı oluşturur. Bu plan kullanıcı onayı gerektirir. Onay alındıktan sonra execute_order_plan ile uygulanır.',
    parameters: {
      type: 'object',
      properties: {
        orders: {
          type: 'array',
          description: 'Oluşturulacak sipariş listesi',
          items: {
            type: 'object',
            properties: {
              labId: { type: 'string', description: 'Hedef laboratuvar ID' },
              labName: { type: 'string', description: 'Laboratuvar adı' },
              depotId: { type: 'string', description: 'Kaynak depo ID' },
              depotName: { type: 'string', description: 'Depo adı' },
              items: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    stokKodu: { type: 'string' },
                    stokAdi: { type: 'string' },
                    adet: { type: 'number' },
                    reason: { type: 'string', description: 'Sipariş sebebi (düşük stok, min altı vb.)' },
                  },
                  required: ['stokKodu', 'stokAdi', 'adet'],
                },
              },
            },
            required: ['labId', 'labName', 'items'],
          },
        },
        reason: { type: 'string', description: 'Toplu sipariş sebebi açıklaması' },
      },
      required: ['orders', 'reason'],
    },
  },
  {
    name: 'execute_order_plan',
    description: 'Onaylanmış sipariş planını uygular ve Firestore\'a kaydeder. SADECE kullanıcı onayı aldıktan sonra çağrılmalıdır.',
    parameters: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: 'Onaylanan plan ID' },
        confirmedBy: { type: 'string', description: 'Onaylayan kullanıcı adı' },
      },
      required: ['planId'],
    },
  },
];

export type AgentToolName =
  | 'get_lab_stock_status'
  | 'get_min_max_rules'
  | 'get_depot_stock'
  | 'get_labs_needing_product'
  | 'create_order_plan'
  | 'execute_order_plan';

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  requiresConfirmation?: boolean;
  planId?: string;
}

export interface OrderPlan {
  id: string;
  createdAt: Date;
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
  status: 'pending_confirmation' | 'confirmed' | 'executed' | 'cancelled';
  totalItems: number;
  totalLabs: number;
}

export const pendingPlans = new Map<string, OrderPlan>();
