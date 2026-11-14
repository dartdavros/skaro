import { t } from '@skaro/ui';
import type { ResourceWait } from '../../shared/resource-wait';
import './resource-wait-i18n';

export function resourceWaitLabel(wait: ResourceWait): string {
  return t(
    ['budget_disk', 'unknown_disk', 'budget_pool:dockerDiskBytes'].includes(wait.reason)
      ? 'resource.wait.disk'
      : 'resource.wait.other',
  );
}
export function resourceBytes(value: number | undefined): string {
  if (value === undefined) return t('resource.wait.unknown');
  const unit = value >= 1024 ** 3 ? 'gib' : value >= 1024 ** 2 ? 'mib' : 'bytes';
  const divisor = unit === 'gib' ? 1024 ** 3 : unit === 'mib' ? 1024 ** 2 : 1;
  return `${Number((value / divisor).toFixed(2))} ${t(`resource.wait.${unit}`)}`;
}
export function resourceWaitAmount(wait: ResourceWait): string {
  return wait.disks
    .map((disk) =>
      t('resource.wait.amount', {
        path: disk.path,
        requested: resourceBytes(disk.requested),
        available: resourceBytes(
          disk.available === undefined ? undefined : Math.max(0, disk.available - disk.reserved),
        ),
      }),
    )
    .join('; ');
}
export function resourceWaitDetail(wait: ResourceWait): string {
  const key = `resource.wait.${wait.reason}`;
  const reason = t(key);
  return [
    resourceWaitLabel(wait),
    reason === key ? wait.reason : reason,
    resourceWaitAmount(wait),
    ...wait.disks.map((disk) =>
      t('resource.wait.measurement', {
        free: resourceBytes(disk.free),
        reserve: resourceBytes(disk.reserve),
        reserved: resourceBytes(disk.reserved),
      }),
    ),
    wait.reason,
  ]
    .filter(Boolean)
    .join(' · ');
}
