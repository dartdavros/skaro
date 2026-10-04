import type { ProjectDocs } from './data.svelte';

export type TreeProps = {
  docs: ProjectDocs;
  width: number;
  onselect: (path: string) => void;
  onhide: () => void;
  onnew: () => void;
  onnewspec: () => void;
  onimport: () => void;
};
export type TreePropsContext = TreeProps & { width: NonNullable<TreeProps['width']> };
