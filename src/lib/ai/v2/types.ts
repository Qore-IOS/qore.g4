/**
 * Qore AI Engine v2 — shared types.
 */

export type UserRole =
  | 'super_admin'
  | 'admin'
  | 'admin_developer'
  | 'user'
  | 'teknik_servis'
  | 'aplikasyon'
  | 'teknisyen'
  | 'teknik_lojistik'
  | 'satin_alma'
  | string;

export interface PermissionContext {
  uid: string;
  email?: string | null;
  name?: string | null;
  role: UserRole;
  companyId?: string;
  isSuperAdmin: boolean;
  isAdmin: boolean;
  assignedLaboratories: string[];
  primaryLaboratories: string[];
  assignedDepots: string[];
  assignedBrands: string[];
  assignedLabGroups: string[];
  /** When true the user can see data for ALL labs/depots in their company. */
  unrestrictedScope: boolean;
}

export interface ResolvedHospital {
  id: string;
  name: string;
  kod?: string;
  confidence: number;
  reason: string;
}

export interface ResolvedProduct {
  stokKodu: string;
  stokAdi: string;
  marka?: string;
  urunGrubu?: string;
  testAdi?: string;
  cihazGrubu?: string;
  ambalajDegeri?: number;
  confidence: number;
  reason: string;
}

export interface ResolvedDevice {
  id: string;
  brand?: string;
  model: string;
  serial?: string;
  hospitalId?: string;
  hospitalName?: string;
  confidence: number;
  reason: string;
}

export interface ToolCallRequest {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolCallResult {
  ok: boolean;
  /** Short, human-friendly label for the chat trace. */
  label: string;
  /** Compact summary the model will read. */
  data: unknown;
  /** Optional warning/notice for the model (e.g. "veri bulunamadı"). */
  notice?: string;
  /** Documents/rows actually scanned, for cost transparency. */
  scanned?: number;
}

export interface EngineMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface EngineRunOptions {
  message: string;
  history: EngineMessage[];
  permission: PermissionContext;
  /** Optional override for max reasoning rounds (default 6). */
  maxRounds?: number;
  /** Optional onTrace callback to stream tool-call traces to the client. */
  onTrace?: (trace: EngineTrace) => void;
}

export interface EngineTrace {
  type: 'plan' | 'tool_call' | 'tool_result' | 'final';
  tool?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  text?: string;
}

export interface EngineResult {
  message: string;
  toolsUsed: string[];
  rounds: number;
  scannedDocs: number;
}
