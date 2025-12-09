export type MockDoc = { path: string };
export type MockQuery = { collPath: string; constraints: any[] };

export function createMockFirestoreModule(seed?: Record<string, any>) {
  const store = new Map<string, any>();
  Object.entries(seed ?? {}).forEach(([key, value]) => store.set(key, value));

  const collection = (_db: unknown, ...segments: string[]) => segments.join("/");

  const doc = (collOrDb: any, ...segments: string[]): MockDoc => {
    const base = typeof collOrDb === "string" ? collOrDb : "";
    const path = [base, ...segments].filter(Boolean).join("/");
    return { path };
  };

  const setDoc = async (ref: MockDoc, data: any) => {
    store.set(ref.path, data);
  };

  const getDoc = async (ref: MockDoc) => ({
    exists: () => store.has(ref.path),
    data: () => store.get(ref.path),
  });

  const where = (field: string, op: string, value: any) => ({ type: "where", field, op, value });
  const orderBy = (field: string, direction: "asc" | "desc" = "asc") => ({
    type: "orderBy",
    field,
    direction,
  });

  const query = (collPath: string, ...constraints: any[]): MockQuery => ({ collPath, constraints });

  const getDocs = async (q: MockQuery | string) => {
    const base = typeof q === "string" ? q : q.collPath;
    const constraints = typeof q === "string" ? [] : q.constraints;

    let docs = Array.from(store.entries())
      .filter(([path]) => path.startsWith(base + "/"))
      .map(([path, data]) => ({ id: path.split("/").pop()!, data: () => data }));

    const whereConstraints = constraints.filter((c: any) => c.type === "where");
    docs = docs.filter((docRef) =>
      whereConstraints.every((c: any) => {
        if (c.op === "==") return (docRef.data() as any)[c.field] === c.value;
        return true;
      })
    );

    const orderConstraint = constraints.find((c: any) => c.type === "orderBy");
    if (orderConstraint) {
      docs.sort((a, b) => {
        const av = (a.data() as any)[orderConstraint.field] ?? 0;
        const bv = (b.data() as any)[orderConstraint.field] ?? 0;
        return orderConstraint.direction === "desc" ? bv - av : av - bv;
      });
    }

    return { docs };
  };

  const Timestamp = {
    fromDate: (date: Date) => ({
      toDate: () => date,
    }),
  };

  return {
    collection,
    doc,
    setDoc,
    getDoc,
    getDocs,
    where,
    orderBy,
    query,
    Timestamp,
    _store: store,
  };
}
