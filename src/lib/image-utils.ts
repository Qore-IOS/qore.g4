export function resolveImageSrc(input?: string | null, fallback = '/lab_diorama.png'): string {
  if (!input || !input.trim()) return fallback;

  let value = input.trim();

  // absolute/remote/data/blob paths
  if (/^(https?:\/\/|data:|blob:)/i.test(value)) return value;

  value = value.replace(/\\/g, '/');
  value = value.replace(/^\.\//, '');
  value = value.replace(/^public\//i, '');

  if (!value.startsWith('/')) value = `/${value}`;

  // normalize duplicate slashes
  value = value.replace(/\/+/g, '/');

  // encode spaces and special chars for static file serving
  return encodeURI(value);
}
