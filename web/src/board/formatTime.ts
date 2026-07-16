// 模块级 formatter——提升到模块级，避免每行渲染时都构造一个 Intl 实例。
// 时间戳以 UTC ISO 字符串到达；我们按本地时间显示。
const timeFmt = new Intl.DateTimeFormat('en-AU', {
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

export function formatTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return timeFmt.format(ms);
}
