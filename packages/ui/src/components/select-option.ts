export interface SelectOptionItem<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  tag?: string;
}
