
'use client';

/**
 * Returns today's date in dd.MM.yy format.
 */
export function todayYmd(): string {
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = String(d.getFullYear()).slice(-2);
  return `${day}.${month}.${year}`;
}

/**
 * Converts a zero-based index to an A1-style grid position.
 * @param index The zero-based index of the cell.
 * @param cols The number of columns in the grid.
 * @returns The A1-style position string (e.g., "A1", "C10").
 */
export function idxToPos(index: number, cols = 10): string {
  if (index < 0) return '';
  const row = String.fromCharCode(65 + Math.floor(index / cols)); // 65 is ASCII for 'A'
  const col = (index % cols) + 1;
  return `${row}${col}`;
}
