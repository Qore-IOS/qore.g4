import { db } from "../data/client";
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  orderBy,
  addDoc,
  updateDoc
} from "../data/client";
import type { BudgetPlan } from "./budget-types";
import { getScopedDocs } from "../document-helpers";
import { withCompanyScope } from "../company-scope";

const BUDGET_PLANS_COLLECTION = "cariBudgetPlans";

export async function listBudgetPlans(
  scope: { companyId?: string; isSuperAdmin?: boolean }
): Promise<BudgetPlan[]> {
  const docs = await getScopedDocs(BUDGET_PLANS_COLLECTION, scope.companyId, scope.isSuperAdmin, orderBy("fiscalYear", "desc"));
  
  return docs.map(docSnap => {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
      revisionHistory: data.revisionHistory?.map((r: any) => ({
        ...r,
        date: r.date?.toDate?.() || new Date(r.date)
      }))
    } as BudgetPlan;
  });
}

export async function createBudgetPlan(
  scope: { companyId?: string; isSuperAdmin?: boolean },
  data: Omit<BudgetPlan, "id" | "createdAt" | "revisionHistory">
): Promise<string> {
  const ref = collection(db, BUDGET_PLANS_COLLECTION);
  const docRef = await addDoc(
    ref,
    withCompanyScope(
      { ...data, createdAt: serverTimestamp(), revisionHistory: [] },
      scope.companyId
    )
  );
  return docRef.id;
}

export async function updateBudgetPlan(
  id: string,
  data: Partial<Omit<BudgetPlan, "id" | "createdAt">>
): Promise<void> {
  const docRef = doc(db, BUDGET_PLANS_COLLECTION, id);
  await updateDoc(docRef, data);
}
