/** Portable document values used by the PostgreSQL document store. */
export type DocumentData = Record<string, any>;
export class Timestamp {
  constructor(public seconds: number, public nanoseconds: number = 0) {}
  static now() { return Timestamp.fromMillis(Date.now()); }
  static fromDate(value: Date) { return Timestamp.fromMillis(value.getTime()); }
  static fromMillis(ms: number) { const s = Math.floor(ms / 1000); return new Timestamp(s, (ms - s * 1000) * 1e6); }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6; }
  toDate() { return new Date(this.toMillis()); }
  isEqual(other: Timestamp) { return this.toMillis() === other.toMillis(); }
  valueOf() { return this.toMillis(); }
  toJSON() { return { $timestamp: this.toMillis() }; }
}
export function encode(value: any): any {
  if (value instanceof Timestamp) return value.toJSON();
  if (value instanceof Date) return Timestamp.fromDate(value).toJSON();
  if (Array.isArray(value)) return value.map(v => encode(v) ?? null);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([,v]) => v !== undefined).map(([k,v]) => [k, encode(v)]));
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite document number');
  return value;
}
export function decode(value: any): any {
  if (value && typeof value === 'object' && Object.keys(value).length === 1 && typeof value.$timestamp === 'number') return Timestamp.fromMillis(value.$timestamp);
  if (Array.isArray(value)) return value.map(decode);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, decode(v)]));
  return value;
}
export type Transform = { $operation: string; values?: any[]; amount?: number };
export const serverTimestamp = (): any => ({ $operation: 'timestamp' });
export const deleteField = (): any => ({ $operation: 'delete' });
export const increment = (amount: number): any => ({ $operation: 'increment', amount });
export const arrayUnion = (...values: any[]): any => ({ $operation: 'union', values });
export const arrayRemove = (...values: any[]): any => ({ $operation: 'remove', values });
export const FieldValue = { serverTimestamp, delete: deleteField, increment, arrayUnion, arrayRemove };
function comparable(value:any):string {
  if(Array.isArray(value))return '['+value.map(comparable).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+comparable(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function applyPatch(previous: any, patch: any, dotted = false, now = Date.now()): any {
  const result = structuredClone(previous || {});
  for (const [key, value] of Object.entries(patch || {})) {
    const parts = dotted ? key.split('.') : [key];
    let target = result;
    for (const part of parts.slice(0,-1)) target = target[part] = { ...(target[part] || {}) };
    const name = parts.at(-1)!;
    const op = value as Transform;
    if (op?.$operation) {
      const old = target[name];
      if (op.$operation === 'delete') delete target[name];
      else if (op.$operation === 'timestamp') target[name] = { $timestamp: now };
      else if (op.$operation === 'increment') target[name] = (typeof old === 'number' ? old : 0) + op.amount!;
      else if (op.$operation === 'union') {
        const merged=Array.isArray(old)?[...old]:[];
        for(const value of op.values!)if(!merged.some(x=>comparable(x)===comparable(value)))merged.push(value);
        target[name]=merged;
      }
      else if (op.$operation === 'remove') target[name] = (Array.isArray(old) ? old : []).filter((x: any) => !op.values!.some(v => comparable(x) === comparable(v)));
      else throw new Error('Unsupported document transform');
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !('$timestamp' in value)) {
      target[name] = applyPatch(dotted ? {} : target[name], value, false, now);
    } else target[name] = value;
  }
  return result;
}
export type Constraint = { kind: string; field?: string; op?: string; value?: any; direction?: string; count?: number };
export type Ref = { path: string; kind: string; constraints?: Constraint[]; id?: string; };
export type Operation = { kind: 'set' | 'update' | 'delete'; path: string; data?: any; merge?: boolean };
export type ReadVersion = { path: string; version: string | null };
export function validPath(path: unknown, document = true): asserts path is string {
  if (typeof path !== 'string' || path.length > 1500 || path.split('/').some(x => !x || x === '.' || x === '..') || (path.split('/').length % 2 === 0) !== document) throw new Error('Invalid document path');
}
