import type { Status } from '@shared/protocol';

/**
 * 状态的呈现，与生命周期语义绑定。颜色是看板的功能核心：它同时驱动状态 chip
 * 和每行左侧的色轨，因此状态分布会沿列表边缘形成可扫读的色带。
 */
export interface StatusMeta {
  label: string;
  color: string;
  bg: string;
}

export const STATUS_META: Record<Status, StatusMeta> = {
  created: { label: 'Created', color: '#9db2d4', bg: 'rgba(157, 178, 212, 0.14)' },
  picked_up: { label: 'Picked up', color: '#e0a94a', bg: 'rgba(224, 169, 74, 0.14)' },
  in_transit: { label: 'In transit', color: '#4aa3ff', bg: 'rgba(74, 163, 255, 0.14)' },
  delivered: { label: 'Delivered', color: '#3fce93', bg: 'rgba(63, 206, 147, 0.14)' },
  failed: { label: 'Failed', color: '#f56b70', bg: 'rgba(245, 107, 112, 0.16)' },
};
