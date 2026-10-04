// Icons of the empty board columns (Skaro UI v2 mockup).

import { Bot, Eye, GitMerge, Inbox } from '@lucide/svelte';
import type { Component } from 'svelte';
import type { Column } from './model';

export const COLUMN_ICONS: Record<
  Column['key'],
  Component<{ size?: number; strokeWidth?: number }>
> = { todo: Inbox, working: Bot, review: Eye, done: GitMerge };
