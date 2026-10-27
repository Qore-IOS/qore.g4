import { db } from "../data/client";
import {
  collection,
  doc,
  addDoc,
  serverTimestamp,
  orderBy,
  where,
  type QueryConstraint,
} from "../data/client";
import type { OperationalCostLink } from "./operational-cost-types";
import { getScopedDocs } from "../document-helpers";
import { withCompanyScope } from "../company-scope";
import type { Scope } from "./firestore";

const OP_COST_COLLECTION = "cariOperationalCostLinks";

export async function listOperationalCosts(
  scope: Scope,
  filters?: {
    hospitalId?: string;
    period?: string;
  }
): Promise<OperationalCostLink[]> {
  const constraints: QueryConstraint[] = [orderBy("createdAt", "desc")];
  
  if (filters?.hospitalId) {
    constraints.push(where("hospitalId", "==", filters.hospitalId));
  }
  if (filters?.period) {
    constraints.push(where("period", "==", filters.period));
  }

  const docs = await getScopedDocs(OP_COST_COLLECTION, scope.companyId, scope.isSuperAdmin, ...constraints);
  
  return docs.map((docSnap) => {
    const data = docSnap.data();
    return {
      ...data,
      id: docSnap.id,
      createdAt: data.createdAt?.toDate?.() || new Date(data.createdAt),
    } as OperationalCostLink;
  });
}

export async function createOperationalCostLink(
  scope: Scope,
  data: Omit<OperationalCostLink, "id" | "createdAt">
): Promise<string> {
  const ref = collection(db, OP_COST_COLLECTION);
  const docRef = await addDoc(
    ref,
    withCompanyScope(
      { ...data, createdAt: serverTimestamp() },
      scope.companyId
    )
  );
  return docRef.id;
}
