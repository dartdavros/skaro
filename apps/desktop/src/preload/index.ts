import { contextBridge } from 'electron';
import type { SkaroApi } from './api';

const api: SkaroApi = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld('skaro', api);
