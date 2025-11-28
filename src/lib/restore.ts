'use server';
import { db } from '@/lib/firebase';
import { collection, query, where, getDocs, writeBatch, Timestamp } from 'firebase/firestore';

/**
 * Reverts Firestore document changes made on a specific date (July 29, 2025).
 * This function assumes an 'AuditLogs' collection exists where each document contains:
 * - docPath: The string path of the document that was changed (e.g., 'products/xyz123').
 * - timestamp: A Firestore Timestamp of when the change occurred.
 * - beforeData: An object containing the data of the document *before* the change.
 * @returns {Promise<{restoredCount: number}>} An object with the count of restored documents.
 */
export async function restoreChangesAfterNoon() {
  const batch = writeBatch(db);

  // Define the start and end of the target day
  const startDate = new Date('2025-07-29T00:00:00');
  const endDate = new Date('2025-07-29T23:59:59');
  
  const startTimestamp = Timestamp.fromDate(startDate);
  const endTimestamp = Timestamp.fromDate(endDate);

  // This query assumes you have an "AuditLogs" collection with the specified fields.
  const q = query(
    collection(db, 'AuditLogs'),
    where('timestamp', '>=', startTimestamp),
    where('timestamp', '<=', endTimestamp)
  );

  const auditSnap = await getDocs(q);

  if (auditSnap.empty) {
    console.log('No changes on the specified date to restore.');
    return { restoredCount: 0 };
  }

  const restoredPaths = new Set<string>();

  // To handle multiple changes to the same doc, sort by timestamp ascending
  // and only restore the *first* change, which is the state right before the first modification of that day.
  const sortedAudits = auditSnap.docs.sort((a, b) => a.data().timestamp.toMillis() - b.data().timestamp.toMillis());

  sortedAudits.forEach(auditDoc => {
    const audit = auditDoc.data();
    const docPath = audit.docPath;
    const priorData = audit.beforeData;

    // If we've already scheduled a restore for this path, skip,
    // as we want the earliest version before the first change of the day.
    if (!docPath || !priorData || restoredPaths.has(docPath)) {
      return;
    }

    const docRef = doc(db, docPath);
    batch.set(docRef, priorData); // Overwrite with the "before" data
    restoredPaths.add(docPath);
  });

  await batch.commit();
  console.log(`Restored ${restoredPaths.size} documents to their state before July 29, 2025.`);
  return { restoredCount: restoredPaths.size };
}
