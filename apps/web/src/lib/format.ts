import { grams } from '../../../../packages/shared/src';
export { grams };
export const weight = (mg: number) =>
  mg >= 1_000_000
    ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(mg / 1_000_000)} kg`
    : `${grams(mg)} g`;
export const money = (cents: number | null) =>
  cents === null ? '价格未记录' : `¥${(cents / 100).toFixed(2)}`;
export function date(value: string | null, timezone = 'Asia/Shanghai') {
  return value
    ? new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: timezone,
      }).format(new Date(value))
    : '时间未记录';
}
export const dayKey = (value: string, timezone = 'Asia/Shanghai') =>
  new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: timezone,
  }).format(new Date(value));
export const shortId = (id: string) => id.slice(0, 8).toUpperCase();
