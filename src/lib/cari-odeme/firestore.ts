/**
 * Cari Ödeme data-access layer.
 *
 * Ported from the standalone `cariodeme` app's `src/lib/firestore.ts` and
 * adapted to INV-zen:
 *   - Uses the shared Firestore instance from `@/lib/firebase`.
 *   - All collections are namespaced with a `cari` prefix to avoid clashing
 *     with existing tenant collections (notably `companies`).
 *   - Reads go through `scopedQuery` and writes through `withCompanyScope`
 *     so every document is isolated per tenant (`companyId`).
 *   - The vendor foreign key is `cariFirmaId` (renamed from the source's
 *     `companyId`, which now exclusively means the tenant tag).
 *   - User-management and expense-report helpers from the source were dropped:
 *     auth comes from `@/contexts/auth-context` and expenses already live in
 *     the existing "masraf-yonetimi" panel.
 */
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  orderBy,
  limit,
  Timestamp,
  where,
  writeBatch,
  type QueryConstraint,
  type FirestoreDataConverter,
} from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { db } from "@/lib/firebase";
import { scopedQuery } from "@/lib/firestore-helpers";
import { withCompanyScope } from "@/lib/company-scope";
import type {
  Payment,
  CariFirma,
  Iban,
  PaymentStatus,
  BankAccount,
  PaymentTemplate,
  Department,
  BudgetHistory,
} from "./types";

/** Tenant scope passed from the calling component (via `useAuth`). */
export type Scope = { companyId: string | null | undefined; isSuperAdmin?: boolean };

// Collection names — all namespaced under `cari*`.
const CARI_PAYMENTS = "cariPayments";
const CARI_FIRMALAR = "cariFirmalar";
const CARI_TEMPLATES = "cariPaymentTemplates";
const CARI_BANK_ACCOUNTS = "cariBankAccounts";
const CARI_DEPARTMENTS = "cariDepartments";

// Generic converter that turns Firestore Timestamps into JS Dates on read.
function createConverter<T>(): FirestoreDataConverter<T> {
  return {
    toFirestore: (data: any) => data,
    fromFirestore: (snapshot, options): T => {
      const data = snapshot.data(options) as Record<string, any>;
      const converted: Record<string, any> = { ...data };
      for (const key in converted) {
        if (converted[key] instanceof Timestamp) {
          converted[key] = converted[key].toDate();
        }
      }
      return { ...converted, id: snapshot.id } as T;
    },
  };
}

const cariFirmaConverter = createConverter<CariFirma>();
const ibanConverter = createConverter<Iban>();
const paymentConverter = createConverter<Payment>();
const bankAccountConverter = createConverter<BankAccount>();
const paymentTemplateConverter = createConverter<PaymentTemplate>();
const departmentConverter = createConverter<Department>();
const budgetHistoryConverter = createConverter<BudgetHistory>();

function currentUid(): string {
  return getAuth().currentUser?.uid ?? "unknown";
}

/* ------------------------------------------------------------------ */
/* Payments                                                           */
/* ------------------------------------------------------------------ */

export async function createPayment(
  scope: Scope,
  p: Omit<Payment, "id" | "createdAt" | "updatedAt" | "companyId">
): Promise<string> {
  const ref = collection(db, CARI_PAYMENTS);
  const docRef = await addDoc(
    ref,
    withCompanyScope(
      { ...p, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      scope.companyId
    )
  );
  return docRef.id;
}

export async function getPayment(id: string): Promise<Payment | null> {
  const docRef = doc(db, CARI_PAYMENTS, id).withConverter(paymentConverter);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

export async function updatePayment(id: string, data: Partial<Omit<Payment, "id">>) {
  const docRef = doc(db, CARI_PAYMENTS, id);
  await updateDoc(docRef, { ...data, updatedAt: Timestamp.now() });
}

/**
 * Lists payments scoped to the tenant. To keep composite-index requirements
 * minimal we fetch the tenant's payments ordered by `createdAt` and apply the
 * status/bank/firm/requester/text filters plus pagination client-side. This
 * matches the demo-scale dataset of the source app.
 */
export async function listPayments(
  scope: Scope,
  opts: {
    size?: number;
    cursor?: string | null;
    q?: string;
    status?: PaymentStatus;
    bank?: string;
    cariFirmaId?: string;
    requesterName?: string;
    department?: string;
    max?: number;
  } = {}
): Promise<{ items: Payment[]; nextCursor: string | null }> {
  const size = Math.min(Math.max(opts.size ?? 20, 1), 10000);
  const max = Math.min(Math.max(opts.max ?? 2000, size), 10000);

  const q = scopedQuery(
    CARI_PAYMENTS,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("createdAt", "desc"),
    limit(max)
  ).withConverter(paymentConverter);

  const snap = await getDocs(q);
  let all = snap.docs.map((d) => d.data());

  if (opts.status) all = all.filter((p) => p.status === opts.status);
  if (opts.bank) all = all.filter((p) => p.bankName === opts.bank);
  if (opts.cariFirmaId) all = all.filter((p) => p.cariFirmaId === opts.cariFirmaId);
  if (opts.requesterName) all = all.filter((p) => p.requesterName === opts.requesterName);
  if (opts.department) all = all.filter((p) => p.department === opts.department);
  if (opts.q) {
    const needle = opts.q.toLowerCase();
    all = all.filter(
      (p) =>
        (p.companyName ?? "").toLowerCase().includes(needle) ||
        (p.description ?? "").toLowerCase().includes(needle) ||
        (p.invoiceNo ?? "").toLowerCase().includes(needle)
    );
  }

  const offset = Math.max(0, Number(opts.cursor) || 0);
  const items = all.slice(offset, offset + size);
  const nextOffset = offset + size;
  const nextCursor = nextOffset < all.length ? String(nextOffset) : null;
  return { items, nextCursor };
}

/* ------------------------------------------------------------------ */
/* Cari firmalar (vendors)                                            */
/* ------------------------------------------------------------------ */

export async function createCariFirma(
  scope: Scope,
  c: Omit<CariFirma, "id" | "createdAt" | "updatedAt" | "companyId">
): Promise<string> {
  const ref = collection(db, CARI_FIRMALAR);
  const docRef = await addDoc(
    ref,
    withCompanyScope(
      { ...c, createdAt: Timestamp.now(), updatedAt: Timestamp.now() },
      scope.companyId
    )
  );
  return docRef.id;
}

export async function getCariFirma(id: string): Promise<CariFirma | null> {
  const docRef = doc(db, CARI_FIRMALAR, id).withConverter(cariFirmaConverter);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

export async function updateCariFirma(
  scope: Scope,
  id: string,
  data: Partial<Omit<CariFirma, "id">>
) {
  const docRef = doc(db, CARI_FIRMALAR, id);
  const currentSnap = await getDoc(docRef);
  if (!currentSnap.exists()) throw new Error("Cari firma bulunamadı.");
  const oldBudget = (currentSnap.data() as any).budget ?? 0;

  const batch = writeBatch(db);
  batch.update(docRef, { ...data, updatedAt: Timestamp.now() });

  const newBudget = data.budget ?? 0;
  if (data.budget !== undefined && newBudget !== oldBudget) {
    const historyRef = doc(collection(db, CARI_FIRMALAR, id, "history"));
    batch.set(
      historyRef,
      withCompanyScope(
        {
          changedAt: Timestamp.now(),
          oldBudget,
          newBudget,
          changedBy: currentUid(),
        },
        scope.companyId
      )
    );
  }
  await batch.commit();
}

export async function listCariFirmalar(
  scope: Scope,
  opts: { size?: number } = {}
): Promise<{ items: CariFirma[] }> {
  const size = Math.min(Math.max(opts.size ?? 1000, 1), 10000);
  const q = scopedQuery(
    CARI_FIRMALAR,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("name", "asc"),
    limit(size)
  ).withConverter(cariFirmaConverter);
  const snap = await getDocs(q);
  return { items: snap.docs.map((d) => d.data()) };
}

export async function deleteCariFirma(id: string) {
  await deleteDoc(doc(db, CARI_FIRMALAR, id));
}

export async function listCariFirmaBudgetHistory(cariFirmaId: string): Promise<BudgetHistory[]> {
  const historyRef = collection(db, CARI_FIRMALAR, cariFirmaId, "history");
  const q = query(historyRef, orderBy("changedAt", "desc")).withConverter(budgetHistoryConverter);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

/* IBANs (subcollection of a cari firm) */

export async function createCariFirmaIban(
  scope: Scope,
  cariFirmaId: string,
  ibanData: Omit<Iban, "id" | "createdAt" | "cariFirmaId" | "companyId">
) {
  const ref = collection(db, CARI_FIRMALAR, cariFirmaId, "ibans");
  await addDoc(
    ref,
    withCompanyScope({ ...ibanData, cariFirmaId, createdAt: Timestamp.now() }, scope.companyId)
  );
}

export async function listCariFirmaIbans(cariFirmaId: string): Promise<Iban[]> {
  const ref = collection(db, CARI_FIRMALAR, cariFirmaId, "ibans");
  const q = query(ref, orderBy("createdAt", "desc")).withConverter(ibanConverter);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function deleteCariFirmaIban(cariFirmaId: string, ibanId: string) {
  await deleteDoc(doc(db, CARI_FIRMALAR, cariFirmaId, "ibans", ibanId));
}

/* ------------------------------------------------------------------ */
/* Bank accounts (tenant-wide)                                        */
/* ------------------------------------------------------------------ */

export async function createBankAccount(
  scope: Scope,
  data: Omit<BankAccount, "id" | "createdAt" | "companyId">
): Promise<string> {
  const ref = collection(db, CARI_BANK_ACCOUNTS);
  const docRef = await addDoc(
    ref,
    withCompanyScope({ ...data, createdAt: Timestamp.now() }, scope.companyId)
  );
  return docRef.id;
}

export async function listBankAccounts(scope: Scope): Promise<BankAccount[]> {
  const q = scopedQuery(
    CARI_BANK_ACCOUNTS,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("bankName", "asc")
  ).withConverter(bankAccountConverter);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function deleteBankAccount(id: string) {
  await deleteDoc(doc(db, CARI_BANK_ACCOUNTS, id));
}

/* ------------------------------------------------------------------ */
/* Payment templates                                                  */
/* ------------------------------------------------------------------ */

export async function createPaymentTemplate(
  scope: Scope,
  template: Omit<PaymentTemplate, "id" | "createdAt" | "companyId">
): Promise<string> {
  const ref = collection(db, CARI_TEMPLATES);
  const docRef = await addDoc(
    ref,
    withCompanyScope({ ...template, createdAt: Timestamp.now() }, scope.companyId)
  );
  return docRef.id;
}

export async function getPaymentTemplate(id: string): Promise<PaymentTemplate | null> {
  const docRef = doc(db, CARI_TEMPLATES, id).withConverter(paymentTemplateConverter);
  const snap = await getDoc(docRef);
  return snap.exists() ? snap.data() : null;
}

export async function updatePaymentTemplate(id: string, data: Partial<Omit<PaymentTemplate, "id">>) {
  await updateDoc(doc(db, CARI_TEMPLATES, id), data);
}

export async function deletePaymentTemplate(id: string) {
  await deleteDoc(doc(db, CARI_TEMPLATES, id));
}

export async function listPaymentTemplates(scope: Scope): Promise<PaymentTemplate[]> {
  const q = scopedQuery(
    CARI_TEMPLATES,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("templateName", "asc")
  ).withConverter(paymentTemplateConverter);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function createPaymentFromTemplate(
  scope: Scope,
  template: PaymentTemplate,
  requesterId: string,
  requesterName: string
): Promise<string> {
  return createPayment(scope, {
    requesterId,
    requesterName,
    department: template.department,
    cariFirmaId: template.cariFirmaId,
    companyName: template.companyName,
    description: template.description,
    amount: template.amount,
    currency: template.currency,
    dueDate: new Date(),
    invoiceNo: template.invoiceNo,
    status: "pending",
    bankName: null,
  });
}

/* ------------------------------------------------------------------ */
/* Departments                                                        */
/* ------------------------------------------------------------------ */

export async function createDepartment(
  scope: Scope,
  data: Omit<Department, "id" | "createdAt" | "companyId">
): Promise<string> {
  const ref = collection(db, CARI_DEPARTMENTS);
  const docRef = await addDoc(
    ref,
    withCompanyScope({ ...data, createdAt: Timestamp.now() }, scope.companyId)
  );
  return docRef.id;
}

export async function listDepartments(scope: Scope): Promise<Department[]> {
  const q = scopedQuery(
    CARI_DEPARTMENTS,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("name", "asc")
  ).withConverter(departmentConverter);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

export async function updateDepartment(
  scope: Scope,
  id: string,
  data: Partial<Omit<Department, "id" | "createdAt">>
) {
  const docRef = doc(db, CARI_DEPARTMENTS, id);
  const currentSnap = await getDoc(docRef);
  if (!currentSnap.exists()) throw new Error("Departman bulunamadı.");
  const oldBudget = (currentSnap.data() as any).budget;

  const batch = writeBatch(db);
  batch.update(docRef, data);

  if (data.budget !== undefined && data.budget !== oldBudget) {
    const historyRef = doc(collection(db, CARI_DEPARTMENTS, id, "history"));
    batch.set(
      historyRef,
      withCompanyScope(
        {
          changedAt: Timestamp.now(),
          oldBudget,
          newBudget: data.budget,
          changedBy: currentUid(),
        },
        scope.companyId
      )
    );
  }
  await batch.commit();
}

export async function deleteDepartment(id: string) {
  await deleteDoc(doc(db, CARI_DEPARTMENTS, id));
}

export async function listBudgetHistory(departmentId: string): Promise<BudgetHistory[]> {
  const ref = collection(db, CARI_DEPARTMENTS, departmentId, "history");
  const q = query(ref, orderBy("changedAt", "desc")).withConverter(budgetHistoryConverter);
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data());
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                          */
/* ------------------------------------------------------------------ */

export async function getDashboardData(scope: Scope) {
  const paymentsQuery = scopedQuery(
    CARI_PAYMENTS,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("createdAt", "desc"),
    limit(500)
  ).withConverter(paymentConverter);
  const firmalarQuery = scopedQuery(
    CARI_FIRMALAR,
    scope.companyId,
    scope.isSuperAdmin,
    orderBy("createdAt", "desc"),
    limit(500)
  ).withConverter(cariFirmaConverter);

  const [paymentsSnap, firmalarSnap] = await Promise.all([
    getDocs(paymentsQuery),
    getDocs(firmalarQuery),
  ]);

  const allPayments = paymentsSnap.docs.map((d) => d.data());
  const firmalar = firmalarSnap.docs.map((d) => d.data());

  const kpi = allPayments.reduce(
    (acc, p) => {
      acc.total += p.amount;
      if (p.status === "approved") acc.approved += p.amount;
      if (p.status === "pending") acc.pending += p.amount;
      if (p.status === "paid") acc.paid += p.amount;
      return acc;
    },
    { total: 0, approved: 0, pending: 0, paid: 0 }
  );

  return { allPayments, kpi: { ...kpi, companies: firmalar.length } };
}
