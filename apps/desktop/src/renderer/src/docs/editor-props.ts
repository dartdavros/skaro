import type { ProjectDocs } from './data.svelte';

export type EditorProps = {
  docs: ProjectDocs;
  title: string;
  treeHidden: boolean;
  onshowtree: () => void;
  oncancel: () => void;
  onlink: (href: string) => void;
};
