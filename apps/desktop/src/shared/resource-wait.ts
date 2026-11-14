/** Current host admission, never inferred from an old task status or agent log. */
export interface ResourceWait {
  reason: string;
  since: number;
  disks: {
    volume: string;
    path: string;
    requested: number;
    reserved: number;
    available?: number;
    free?: number;
    reserve?: number;
  }[];
}
