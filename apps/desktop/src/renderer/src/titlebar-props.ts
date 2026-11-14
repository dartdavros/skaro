import type { ProjectTab } from '@skaro/ui';

export type TitleBarProps =
  | { closing: true }
  | {
      closing?: false;
      locked?: boolean;
      project?: { id: string; name: string };
      tabs: ProjectTab[];
      active?: string;
      home: boolean;
      settings: boolean;
      onhome: () => void;
      onselect: (id: string) => void;
      onclose: (id: string) => void;
      onadd: () => void;
      onsettings: () => void;
    };
