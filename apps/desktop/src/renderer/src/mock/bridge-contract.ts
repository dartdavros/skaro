import type { PreviewMethods } from '../preview-contract';
export type PreviewHandlers = {
  [M in keyof PreviewMethods]: (
    ...args: Parameters<PreviewMethods[M]>
  ) => ReturnType<PreviewMethods[M]>;
};
