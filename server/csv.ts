import { readFileSync } from 'node:fs';
import { STATUSES, type Shipment, type Status } from '../shared/protocol';

const STATUS_SET = new Set<string>(STATUSES);

/**
 * 解析 CSV 文本（含表头行）为带类型的行数据。纯函数——有单测覆盖。
 *
 * 所提供的数据集干净且扁平（已核实：无内嵌逗号或引号、无缺失字段），
 * 因此按逗号切分即正确且零依赖。我们仍对每行做守卫（字段数 + 已知 status）
 * 并跳过任何格式错误的行，使一行脏数据永远不会拖垮 feed。若源数据将来出现
 * 带引号的字段，再换成流式 CSV 解析器——已记入"下一步"。
 */
export function parseShipments(text: string): Shipment[] {
  const lines = text.split(/\r?\n/);

  const out: Shipment[] = [];
  // 从 1 开始，跳过表头行。
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const parts = line.split(',');
    if (parts.length !== 4) continue;

    const [reference, customer_name, status, last_update] = parts;
    if (!reference || !STATUS_SET.has(status)) continue;

    out.push({ reference, customer_name, status: status as Status, last_update });
  }
  return out;
}

export function loadShipments(path: string): Shipment[] {
  return parseShipments(readFileSync(path, 'utf8'));
}
