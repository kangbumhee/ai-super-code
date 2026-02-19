/**
 * StorageManager — 모두 static 메서드
 * 브리핑 §5 기준
 */
import type {
  OmniCoderSettings,
  Task,
  ConversationLog,
  CostEntry,
} from '@/types';
import { DEFAULT_SETTINGS } from '@/types';

const KEYS = {
  settings: 'omnicoder_settings',   // sync
  tasks: 'omnicoder_tasks',         // local (압축)
  logs: 'omnicoder_logs',           // local (압축)
  files: 'omnicoder_files',         // local (압축)
  costs: 'omnicoder_costs',         // local (비압축)
};

export class StorageManager {
  // ─── 헬퍼 ───────────────────────────────────────────────────
  private static async getSync<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.sync.get(key);
    return (result[key] as T) ?? null;
  }

  private static async setSync(key: string, value: unknown): Promise<void> {
    await chrome.storage.sync.set({ [key]: value });
  }

  private static async getLocal<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.local.get(key);
    return (result[key] as T) ?? null;
  }

  private static async setLocal(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  private static async setCompressed(key: string, data: unknown): Promise<void> {
    await this.setLocal(key, JSON.stringify(data));
  }

  /** 읽기 */
  private static async getCompressed<T>(key: string): Promise<T | null> {
    const raw = await this.getLocal<string>(key);
    if (!raw) return null;
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return parsed as T;
    } catch {
      return null;
    }
  }

  // ─── Settings (sync, 비압축) ────────────────────────────────
  static async getSettings(): Promise<OmniCoderSettings> {
    const saved = await this.getSync<Partial<OmniCoderSettings>>(KEYS.settings);
    return { ...DEFAULT_SETTINGS, ...saved };
  }

  static async saveSettings(partial: Partial<OmniCoderSettings>): Promise<void> {
    const current = await this.getSettings();
    await this.setSync(KEYS.settings, { ...current, ...partial });
  }

  // ─── Tasks (local, 압축) ───────────────────────────────────
  static async getTasks(): Promise<Task[]> {
    return (await this.getCompressed<Task[]>(KEYS.tasks)) || [];
  }

  static async saveTasks(tasks: Task[]): Promise<void> {
    await this.setCompressed(KEYS.tasks, tasks);
  }

  static async addTask(task: Task): Promise<void> {
    const tasks = await this.getTasks();
    tasks.push(task);
    await this.saveTasks(tasks);
  }

  static async updateTask(taskId: string, updates: Partial<Task>): Promise<void> {
    const tasks = await this.getTasks();
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      tasks[idx] = { ...tasks[idx], ...updates };
      await this.saveTasks(tasks);
    }
  }

  // ─── Logs (local, 압축) ────────────────────────────────────
  static async getLogs(): Promise<ConversationLog[]> {
    return (await this.getCompressed<ConversationLog[]>(KEYS.logs)) || [];
  }

  static async saveLogs(logs: ConversationLog[]): Promise<void> {
    await this.setCompressed(KEYS.logs, logs);
  }

  static async addLog(log: ConversationLog): Promise<void> {
    const logs = await this.getLogs();
    logs.push(log);
    await this.saveLogs(logs);
  }

  static async updateLog(
    logId: string,
    updates: Partial<ConversationLog>
  ): Promise<void> {
    const logs = await this.getLogs();
    const idx = logs.findIndex((l) => l.id === logId);
    if (idx !== -1) {
      logs[idx] = { ...logs[idx], ...updates };
      await this.saveLogs(logs);
    }
  }

  // ─── Files (local, 압축, Record<string, string>) ──────────
  static async getFiles(): Promise<Record<string, string>> {
    return (await this.getCompressed<Record<string, string>>(KEYS.files)) || {};
  }

  static async saveFiles(files: Record<string, string>): Promise<void> {
    await this.setCompressed(KEYS.files, files);
  }

  static async mergeFiles(newFiles: Record<string, string>): Promise<void> {
    const current = await this.getFiles();
    await this.saveFiles({ ...current, ...newFiles });
  }

  // ─── Costs (local, 비압축) ────────────────────────────────
  static async getCosts(): Promise<CostEntry[]> {
    return (await this.getLocal<CostEntry[]>(KEYS.costs)) || [];
  }

  static async addCost(entry: CostEntry): Promise<void> {
    const costs = await this.getCosts();
    costs.push(entry);
    await this.setLocal(KEYS.costs, costs);
  }

  // ─── 유틸 ──────────────────────────────────────────────────
  static async clearAll(): Promise<void> {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
  }

  static async exportAll(): Promise<string> {
    const [settings, tasks, logs, files, costs] = await Promise.all([
      this.getSettings(),
      this.getTasks(),
      this.getLogs(),
      this.getFiles(),
      this.getCosts(),
    ]);
    return JSON.stringify(
      { settings, tasks, logs, files, costs, exportedAt: new Date().toISOString() },
      null,
      2
    );
  }

  static async importAll(jsonStr: string): Promise<void> {
    const data = JSON.parse(jsonStr);
    if (data.settings) await this.saveSettings(data.settings);
    if (data.tasks) await this.saveTasks(data.tasks);
    if (data.logs) await this.saveLogs(data.logs);
    if (data.files) await this.saveFiles(data.files);
    if (data.costs) await this.setLocal(KEYS.costs, data.costs);
  }

  static async cleanup(daysToKeep: number): Promise<number> {
    const logs = await this.getLogs();
    const cutoff = Date.now() - daysToKeep * 86400000;
    const kept = logs.filter((l) => new Date(l.timestamp).getTime() > cutoff);
    const removed = logs.length - kept.length;
    await this.saveLogs(kept);
    return removed;
  }
}
