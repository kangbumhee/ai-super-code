import { create } from 'zustand';
import type {
  AppState,
  Task,
  ConversationLog,
  FileOutput,
  CostEntry,
  OmniCoderSettings,
  ProgressUpdate
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

interface DashboardStore {
  state: AppState | null;
  tasks: Task[];
  logs: ConversationLog[];
  files: FileOutput[];
  costs: CostEntry[];
  settings: OmniCoderSettings;
  progress: ProgressUpdate | null;
  isConnected: boolean;
  activeTab: string;

  setActiveTab: (tab: string) => void;
  setState: (s: AppState | null) => void;
  setTasks: (t: Task[]) => void;
  setLogs: (l: ConversationLog[]) => void;
  setFiles: (f: FileOutput[]) => void;
  setCosts: (c: CostEntry[]) => void;
  setSettings: (s: OmniCoderSettings) => void;
  setProgress: (p: ProgressUpdate | null) => void;
  setConnected: (c: boolean) => void;

  sendMessage: (msg: { type: string; data?: unknown }) => Promise<unknown>;
  loadAllData: () => Promise<void>;
  toggleMonitor: () => Promise<void>;
  setAutoMode: (auto: boolean) => Promise<void>;
  setModel: (modelIndex: number) => Promise<void>;
  approveTask: (taskId: string) => Promise<void>;
  skipTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  retryTask: (taskId: string) => Promise<void>;
  saveSettings: (s: Partial<OmniCoderSettings>) => Promise<void>;
  testApi: (apiKey?: string) => Promise<{ success: boolean; message: string }>;
  exportData: () => Promise<string>;
  importData: (data: string) => Promise<void>;
  clearData: () => Promise<void>;
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  state: null,
  tasks: [],
  logs: [],
  files: [],
  costs: [],
  settings: { ...DEFAULT_SETTINGS },
  progress: null,
  isConnected: false,
  activeTab: 'control',

  setActiveTab: (tab) => set({ activeTab: tab }),
  setState: (s) => set({ state: s }),
  setTasks: (t) => set({ tasks: t }),
  setLogs: (l) => set({ logs: l }),
  setFiles: (f) => set({ files: f }),
  setCosts: (c) => set({ costs: c }),
  setSettings: (s) => set({ settings: s }),
  setProgress: (p) => set({ progress: p }),
  setConnected: (c) => set({ isConnected: c }),

  sendMessage: async (msg) => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response: unknown) => {
        if (chrome.runtime.lastError) {
          set({ isConnected: false });
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else {
          set({ isConnected: true });
          resolve(response);
        }
      });
    });
  },

  loadAllData: async () => {
    const res = (await get().sendMessage({ type: 'GET_ALL_DATA' })) as {
      success: boolean;
      state: AppState;
      tasks: Task[];
      logs: ConversationLog[];
      files: FileOutput[];
      costs: CostEntry[];
      settings: OmniCoderSettings;
    };
    if (res?.success) {
      set({
        state: res.state,
        tasks: res.tasks ?? [],
        logs: res.logs ?? [],
        files: res.files ?? [],
        costs: res.costs ?? [],
        settings: res.settings ?? { ...DEFAULT_SETTINGS },
        isConnected: true
      });
    }
  },

  toggleMonitor: async () => {
    const res = (await get().sendMessage({ type: 'TOGGLE_MONITOR' })) as { success: boolean; isMonitoring?: boolean };
    if (res?.success && get().state) {
      set({ state: { ...get().state!, isMonitoring: res.isMonitoring ?? !get().state!.isMonitoring } });
    }
  },

  setAutoMode: async (auto) => {
    await get().sendMessage({
      type: 'SET_EXECUTION_MODE',
      data: { executionMode: auto ? 'full_auto' : 'manual' }
    });
    if (get().state) set({ state: { ...get().state!, executionMode: auto ? 'full_auto' : 'manual' } });
  },

  setModel: async (modelIndex) => {
    await get().sendMessage({ type: 'SET_MODEL', data: { modelIndex } });
    if (get().state) set({ state: { ...get().state!, currentModelIndex: modelIndex } });
  },

  approveTask: async (taskId) => {
    await get().sendMessage({ type: 'APPROVE_TASK', data: { taskId } });
    await get().loadAllData();
  },

  skipTask: async (taskId) => {
    await get().sendMessage({ type: 'SKIP_TASK', data: { taskId } });
    await get().loadAllData();
  },

  cancelTask: async (taskId) => {
    await get().sendMessage({ type: 'CANCEL_TASK', data: { taskId } });
    await get().loadAllData();
  },

  retryTask: async (taskId) => {
    await get().sendMessage({ type: 'RETRY_TASK', data: { taskId } });
    await get().loadAllData();
  },

  saveSettings: async (s) => {
    await get().sendMessage({ type: 'SAVE_SETTINGS', data: s });
    set({ settings: { ...get().settings, ...s } });
  },

  testApi: async (apiKey?) => {
    const res = (await get().sendMessage({
      type: 'TEST_API',
      data: apiKey ? { apiKey } : undefined
    })) as { success: boolean; message?: string };
    return { success: res?.success ?? false, message: res?.message ?? 'No response' };
  },

  exportData: async () => {
    const res = (await get().sendMessage({ type: 'EXPORT_LOGS' })) as { success: boolean; data?: string };
    return res?.data || '{}';
  },

  importData: async (data) => {
    await get().sendMessage({ type: 'IMPORT_DATA', data: { data } });
    await get().loadAllData();
  },

  clearData: async () => {
    await get().sendMessage({ type: 'CLEAR_DATA' });
    await get().loadAllData();
  }
}));
