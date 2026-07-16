/**
 * feed 服务与 web 客户端共享的传输协议。
 * 类型在运行时被擦除；STATUSES 数组是货运生命周期的唯一真相源，两端共用。
 */

/** 货运生命周期。数组顺序即天然的正向推进顺序。 */
export const STATUSES = [
  'created',
  'picked_up',
  'in_transit',
  'delivered',
  'failed',
] as const;

export type Status = (typeof STATUSES)[number];

/** 单条货运记录。与 shipments_10k.csv 的列一一对应。 */
export interface Shipment {
  reference: string;
  customer_name: string;
  status: Status;
  /** ISO-8601 UTC 时间戳，例如 2026-07-04T22:08:00Z */
  last_update: string;
}

/** 最小的状态变更——高频推送的热路径载荷。 */
export interface StatusUpdate {
  reference: string;
  status: Status;
  last_update: string;
}

/** 服务端 → 客户端：完整初始状态，连接时发送一次。 */
export interface SnapshotMessage {
  type: 'snapshot';
  shipments: Shipment[];
  serverTime: string;
}

/** 服务端 → 客户端：一批状态变更。 */
export interface DeltaMessage {
  type: 'delta';
  updates: StatusUpdate[];
  /** 服务端发送时间戳（毫秒 epoch）——用于在 demo 中测量 feed 延迟。 */
  sentAt: number;
}

export type ServerMessage = SnapshotMessage | DeltaMessage;

/** 客户端 → 服务端：调整 feed 的目标更新速率（条/秒）。 */
export interface SetRateMessage {
  type: 'setRate';
  rate: number;
}

export type ClientMessage = SetRateMessage;

export const DEFAULT_FEED_PORT = 8080;
