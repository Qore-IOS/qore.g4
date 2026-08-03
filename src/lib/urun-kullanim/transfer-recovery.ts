export type SerialHistoryEvent = {
  type?: string;
  details?: Record<string, any>;
};

/**
 * Finds a still-consumable transfer in newest-first serial history.
 * A consumption from the same lab/pool after that transfer closes it; later
 * intake events do not, because duplicate physical units may share a serial.
 */
export function findRecoverableLabTransfer<T extends SerialHistoryEvent>(
  newestFirstEvents: T[],
  stokKodu: string,
  labIds: string[],
): T | null {
  let consumedAfterTransfer = false;
  for (const event of newestFirstEvents) {
    const details = event.details || {};
    const eventLabId = details.deductedFromLabId || details.usageLabId || details.targetHospitalId;
    if (event.type === 'consumption' && labIds.includes(eventLabId)) {
      consumedAfterTransfer = true;
      continue;
    }
    if (
      event.type === 'transfer' &&
      !consumedAfterTransfer &&
      details.stokKodu === stokKodu &&
      labIds.includes(details.targetHospitalId)
    ) {
      return event;
    }
  }
  return null;
}
