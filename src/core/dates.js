// Toda data circula internamente em ISO (YYYY-MM-DD). A conversão para o
// formato brasileiro acontece só na camada de UI.

export function isValidISO(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [a, m, d] = s.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(a, m, 0).getDate();
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function formatDateBR(iso) {
  if (!isValidISO(iso)) return '';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

export function parseDateBR(str) {
  const m = String(str || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isValidISO(iso) ? iso : null;
}

export function addMonthsClamped(iso, n) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvoAno = a + Math.floor((m - 1 + n) / 12);
  const alvoMes = ((m - 1 + n) % 12 + 12) % 12;
  const ultimoDia = new Date(alvoAno, alvoMes + 1, 0).getDate();
  const dia = Math.min(d, ultimoDia);
  return `${alvoAno}-${String(alvoMes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

export function diffDays(isoA, isoB) {
  const ms = Date.parse(isoA + 'T00:00:00Z') - Date.parse(isoB + 'T00:00:00Z');
  return Math.abs(Math.round(ms / 86400000));
}

export function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}
