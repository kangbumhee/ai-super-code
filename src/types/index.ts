/**
 * OmniCoder v2.0 — 전역 타입 정의
 * BRIEFING.md §4 기준 완전 재작성
 */

// ─── 모델 ──────────────────────────────────────────────────────
export interface ModelTier {
  id: string;
  name: string;
  inputPer1M: number;
  outputPer1M: number;
}

export const MODEL_TIERS: ModelTier[] = [
  { id: 'claude-3-5-haiku-20241022', name: 'Haiku 3.5', inputPer1M: 0.25, outputPer1M: 1.25 },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', inputPer1M: 1, outputPer1M: 5 },
  { id: 'claude-sonnet-4', name: 'Sonnet 4', inputPer1M: 3, outputPer1M: 15 },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', inputPer1M: 5, outputPer1M: 25 },
];

// ─── 열거형 (문자열 리터럴) ─────────────────────────────────────
export type TaskType = 'code_generation' | 'error_fix' | 'review' | 'test_generation';
export type TaskStatus = 'pending' | 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'skipped';
export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';
export type ExecutionMode = 'manual' | 'semi_auto' | 'full_auto';

// ─── 메시지 타입 ────────────────────────────────────────────────
export type MessageType =
  | 'NEW_CHAT_DETECTED'
  | 'APPROVE_TASK'
  | 'SKIP_TASK'
  | 'DELETE_TASK'
  | 'GET_STATE'
  | 'STATE_UPDATE'
  | 'PROGRESS_UPDATE'
  | 'GET_SETTINGS'
  | 'TOGGLE_MONITOR'
  | 'SET_EXECUTION_MODE'
  | 'SET_MODEL'
  | 'CLEAR_LOGS'
  | 'EXPORT_LOGS'
  | 'EXPORT_FILES'
  | 'TEST_API'
  | 'GENSPARK_LOGIN'
  | 'CANCEL_TASK'
  | 'RETRY_TASK'
  | 'REORDER_TASKS'
  | 'GET_ALL_DATA'
  | 'SAVE_SETTINGS'
  | 'RUN_SELECTOR_TEST'
  | 'DOWNLOAD_FILE'
  | 'IMPORT_DATA'
  | 'CLEAR_DATA'
  | 'MONITOR_STATUS';

// ─── 파일 ───────────────────────────────────────────────────────
export interface FileOutput {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
  language?: string;
}

// ─── 태스크 입출력 ──────────────────────────────────────────────
export interface TaskInput {
  userMessage: string;
  claudeResponse: string;
  existingFiles: Record<string, string>;
  context?: string;
}

export interface TaskOutput {
  summary: string;
  files: FileOutput[];
  commands: string[];
  gitMessage: string;
  cost: number;
  model: string;
  isCodingTask: boolean;
  questions: string | null;
}

export interface TaskRetryEntry {
  attempt: number;
  model: string;
  error: string;
  timestamp: number;
}

export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  input: TaskInput;
  output: TaskOutput | null;
  retryCount: number;
  maxRetries: number;
  currentModelIndex: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  retryHistory: TaskRetryEntry[];
  parentTaskId: string | null;
  childTaskIds: string[];
}

// ─── 대화 로그 ──────────────────────────────────────────────────
export interface ConversationLog {
  id: string;
  timestamp: string; // ISO string
  userMessage: string;
  claudeResponse: string;
  status: 'detected' | 'approved' | 'executing' | 'completed' | 'failed' | 'skipped';
  taskId: string | null;
  cost?: number;
}

// ─── 설정 ───────────────────────────────────────────────────────
export interface OmniCoderSettings {
  apiKey: string;
  defaultModelIndex: number;
  autoUpgrade: boolean;
  maxRetries: number;
  executionMode: ExecutionMode;
  projectName: string;
  gitAutoCommit: boolean;
  gensparkCookies: string;
  notificationsEnabled: boolean;
  maxConcurrentTasks: number;
  autoCleanupDays: number;
  selectorOverrides: Record<string, string>;
  budgetLimit?: number;
  isMonitoring?: boolean;
  useBridge?: boolean;
  bridgeUrl?: string;
}

export const DEFAULT_SETTINGS: OmniCoderSettings = {
  apiKey: '',
  defaultModelIndex: 0,
  autoUpgrade: true,
  maxRetries: 5,
  executionMode: 'manual',
  projectName: 'omnicoder-project',
  gitAutoCommit: true,
  gensparkCookies: '',
  notificationsEnabled: true,
  maxConcurrentTasks: 3,
  autoCleanupDays: 30,
  selectorOverrides: {},
  budgetLimit: 15000,
  isMonitoring: false,
  useBridge: false,
  bridgeUrl: 'http://127.0.0.1:7842',
};

// ─── 비용 ───────────────────────────────────────────────────────
export interface CostEntry {
  timestamp: number; // ms
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  taskId: string;
}

// ─── 앱 상태 ────────────────────────────────────────────────────
export interface AppState {
  isMonitoring: boolean;
  executionMode: ExecutionMode;
  currentModelIndex: number;
  tasks: Task[];
  conversationLogs: ConversationLog[];
  projectFiles: Record<string, string>;
  costHistory: CostEntry[];
  totalCost: number;
  isProcessing: boolean;
  todayCost?: number;
  tasksCompleted?: number;
  tasksQueued?: number;
  tasksFailed?: number;
  lastActivity?: string | null;
}

// ─── 크롬 메시지 ────────────────────────────────────────────────
export interface ChromeMessage {
  type: MessageType;
  data?: unknown;
}

// ─── 셀렉터 ─────────────────────────────────────────────────────
export interface SelectorConfig {
  primary: string;
  fallbacks: string[];
}

export interface SelectorSet {
  userMessage: SelectorConfig;
  assistantMessage: SelectorConfig;
  sendButton: SelectorConfig;
  stopButton: SelectorConfig;
  copyButton: SelectorConfig;
  chatContainer: SelectorConfig;
  inputArea: SelectorConfig;
}

export const DEFAULT_SELECTORS: SelectorSet = {
  userMessage: {
    primary: '.conversation-statement.user .content',
    fallbacks: [
      '.conversation-item-desc.user',
      '.conversation-statement.user .bubble',
      '.conversation-statement.user',
    ],
  },
  assistantMessage: {
    primary: '.conversation-statement.assistant .content',
    fallbacks: [
      '.conversation-item-desc.assistant',
      '.conversation-statement.assistant .bubble',
      '.conversation-statement.assistant',
    ],
  },
  sendButton: {
    primary: '.enter-icon-wrapper',
    fallbacks: ['button[type="submit"]', '[class*="send-btn"]'],
  },
  stopButton: {
    primary: '.stop-generation-btn',
    fallbacks: ['[class*="stop"]', 'button[aria-label*="Stop"]'],
  },
  copyButton: {
    primary: '.message-action-icon',
    fallbacks: ['button[aria-label="Copy"]'],
  },
  chatContainer: {
    primary: '.conversation-content',
    fallbacks: [
      '.conversation-wrapper',
      '.chat-wrapper',
      '.general-chat-wrapper',
    ],
  },
  inputArea: {
    primary: 'textarea.j-search-input',
    fallbacks: ['textarea.search-input', '[contenteditable="true"]'],
  },
};

// ─── 진행 상태 ──────────────────────────────────────────────────
export interface ProgressUpdate {
  taskId: string;
  step: number;
  maxSteps: number;
  status: string;
  model: string;
  files?: FileOutput[];
  cost?: number;
  agentRole?: string;
}
