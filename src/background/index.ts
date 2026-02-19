/**
 * OmniCoder v2.0 — Background Service Worker
 * 브리핑 §10 기준 완전 재작성
 */
import { StorageManager } from '@/storage/StorageManager';
import { ClaudeClient } from '@/api/ClaudeClient';
import { TaskQueue } from '@/queue/TaskQueue';
import { Orchestrator } from '@/agents/Orchestrator';
import type {
  Task,
  AppState,
  OmniCoderSettings,
  ConversationLog,
  FileOutput,
  CostEntry,
  ChromeMessage,
  ProgressUpdate,
} from '@/types';
import { MODEL_TIERS, DEFAULT_SETTINGS } from '@/types';

// ─── 전역 ───────────────────────────────────────────────────────
let queue: TaskQueue;
let orchestrator: Orchestrator;
let settings: OmniCoderSettings = { ...DEFAULT_SETTINGS };
let isInitialized = false;
let processingLock = false;

// ─── buildState ─────────────────────────────────────────────────
async function buildState(): Promise<AppState> {
  const [tasks, costs, files, logs] = await Promise.all([
    StorageManager.getTasks(),
    StorageManager.getCosts(),
    StorageManager.getFiles(),
    StorageManager.getLogs(),
  ]);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayMs = todayStart.getTime();

  return {
    isMonitoring: settings.isMonitoring ?? false,
    executionMode: settings.executionMode,
    currentModelIndex: settings.defaultModelIndex,
    tasks,
    conversationLogs: logs,
    projectFiles: files,
    costHistory: costs,
    totalCost: costs.reduce((s, c) => s + c.cost, 0),
    todayCost: costs
      .filter((c) => c.timestamp >= todayMs)
      .reduce((s, c) => s + c.cost, 0),
    tasksQueued: tasks.filter(
      (t) => t.status === 'pending' || t.status === 'queued'
    ).length,
    tasksCompleted: tasks.filter((t) => t.status === 'completed').length,
    tasksFailed: tasks.filter((t) => t.status === 'failed').length,
    isProcessing: processingLock,
    lastActivity: null,
  };
}

// ─── 초기화 ─────────────────────────────────────────────────────
async function initialize(): Promise<void> {
  if (isInitialized) return;
  try {
    settings = await StorageManager.getSettings();
    queue = new TaskQueue(settings.maxConcurrentTasks || 3);
    orchestrator = new Orchestrator(settings.apiKey, {
      maxIterations: 10,
      reviewThreshold: 70,
      autoUpgrade: settings.autoUpgrade,
      onProgress: broadcastProgress,
    });
    isInitialized = true;
    console.log('[OmniCoder] Background initialized');
  } catch (err) {
    console.error('[OmniCoder] Init failed:', err);
  }
}

// ─── Keep-Alive Alarms ─────────────────────────────────────────
chrome.alarms.create('omnicoder-keepalive', { periodInMinutes: 0.4 });
chrome.alarms.create('omnicoder-process-queue', { periodInMinutes: 0.5 });
chrome.alarms.create('omnicoder-daily-cleanup', { periodInMinutes: 60 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  await initialize();
  if (alarm.name === 'omnicoder-process-queue') {
    await processQueue();
  } else if (alarm.name === 'omnicoder-daily-cleanup') {
    await dailyCleanup();
  }
});

// ─── 큐 처리 ───────────────────────────────────────────────────
async function processQueue(): Promise<void> {
  if (processingLock) return;
  processingLock = true;

  try {
    let task = await queue.dequeue();
    while (task) {
      // manual 모드에서 pending은 release하고 스킵
      if (settings.executionMode === 'manual' && task.status === 'pending') {
        await queue.release(task.id);
        task = await queue.dequeue();
        continue;
      }

      try {
        await executeTask(task);
      } catch (err) {
        await queue.retry(
          task.id,
          err instanceof Error ? err.message : String(err)
        );
      }

      task = await queue.dequeue();
    }
  } finally {
    processingLock = false;
    await broadcastState();
  }
}

// ─── 파일 확장자로 언어 감지 ────────────────────────────────────
function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescriptreact',
    js: 'javascript',
    jsx: 'javascriptreact',
    py: 'python',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
  };
  return map[ext || ''] || 'plaintext';
}

// ─── Genspark 대화창에 텍스트 자동 입력 ───────────────────────────
async function sendToGenspark(text: string): Promise<void> {
  const tabs = await chrome.tabs.query({ url: 'https://www.genspark.ai/*' });
  const targetTab = tabs.find((t) => t.url?.includes('/agents')) || tabs[0];
  if (!targetTab?.id) return;

  await chrome.scripting.executeScript({
    target: { tabId: targetTab.id },
    func: (message: string) => {
      const textarea = document.querySelector('textarea.j-search-input') as HTMLTextAreaElement | null;
      if (!textarea) return;
      textarea.value = message;
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      textarea.style.height = 'auto';
      textarea.style.height = textarea.scrollHeight + 'px';
      const badge = document.getElementById('omnicoder-text');
      if (badge) {
        badge.textContent = '에러 보고 입력됨 — 전송하세요';
        setTimeout(() => {
          const b = document.getElementById('omnicoder-text');
          if (b) b.textContent = 'OmniCoder 감시 중';
        }, 5000);
      }
    },
    args: [text],
  });
}

// ─── 브릿지 모드: Genspark 지시 → Claude Code 실행 → 에러 시 Genspark 보고 ─
async function executeTaskViaBridge(task: Task): Promise<void> {
  const bridgeUrl = settings.bridgeUrl || 'http://127.0.0.1:7842';
  const agentId = `agent-${task.id.slice(-6)}`;

  broadcastProgress({
    taskId: task.id,
    step: 1,
    maxSteps: 5,
    status: 'Claude Code에 지시 전달 중...',
    model: 'claude-code (실행기)',
    agentRole: 'bridge',
  });

  try {
    const res = await fetch(`${bridgeUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentId,
        userMessage: task.input.userMessage,
        claudeResponse: task.input.claudeResponse,
      }),
    });

    const result = await res.json();

    if (result.success) {
      const files: FileOutput[] = [];
      if (result.fileContents) {
        for (const [filePath, content] of Object.entries(result.fileContents)) {
          files.push({
            path: filePath,
            content: content as string,
            action: 'create',
            language: detectLanguage(filePath),
          });
        }
      }

      const fileMap: Record<string, string> = {};
      for (const f of files) {
        fileMap[f.path] = f.content;
      }
      if (Object.keys(fileMap).length > 0) {
        await StorageManager.mergeFiles(fileMap);
      }

      await queue.updateStatus(task.id, 'completed', {
        output: {
          summary: `Claude Code 완료: ${files.length}개 파일 변경`,
          files,
          commands: [],
          gitMessage: '',
          cost: 0,
          model: 'claude-code',
          isCodingTask: true,
          questions: null,
        },
        completedAt: Date.now(),
      });

      broadcastProgress({
        taskId: task.id,
        step: 5,
        maxSteps: 5,
        status: `완료: ${files.length}개 파일`,
        model: 'claude-code',
        files,
        agentRole: 'complete',
      });

      if (result.reportToGenspark) {
        await sendToGenspark(result.reportToGenspark);
      }

      if (settings.notificationsEnabled) {
        showNotification('Claude Code 완료', `${files.length}개 파일 변경`);
      }
    } else {
      broadcastProgress({
        taskId: task.id,
        step: 3,
        maxSteps: 5,
        status: '에러 발생 → Genspark에 보고 중...',
        model: 'claude-code',
        agentRole: 'error-report',
      });

      if (result.reportToGenspark) {
        await sendToGenspark(result.reportToGenspark);
      }

      await StorageManager.updateTask(task.id, {
        status: 'pending',
        error: result.error,
      });

      if (settings.notificationsEnabled) {
        showNotification('에러 → Genspark에 보고', '에러 내용이 Genspark에 전송되었습니다. Genspark의 답변을 기다리세요.');
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await queue.retry(task.id, errMsg, false);

    if (settings.notificationsEnabled) {
      showNotification('브릿지 연결 실패', 'bridge-server.js가 실행 중인지 확인하세요');
    }
  }

  await broadcastState();
}

// ─── 태스크 실행 ────────────────────────────────────────────────
async function executeTask(task: Task): Promise<void> {
  if (settings.useBridge) {
    await executeTaskViaBridge(task);
    return;
  }

  orchestrator.updateApiKey(settings.apiKey);

  // currentModelIndex 보정
  const modelIndex = Math.min(
    task.currentModelIndex,
    MODEL_TIERS.length - 1
  );
  if (modelIndex !== task.currentModelIndex) {
    await StorageManager.updateTask(task.id, {
      currentModelIndex: modelIndex,
    });
    task = { ...task, currentModelIndex: modelIndex };
  }

  broadcastProgress({
    taskId: task.id,
    step: 0,
    maxSteps: 10,
    status: '실행 시작',
    model: MODEL_TIERS[modelIndex].id,
    agentRole: 'system',
  });

  const result = await orchestrator.execute(task);

  if (!result.isCodingTask) {
    await queue.updateStatus(task.id, 'completed', {
      output: result,
      completedAt: Date.now(),
    });
    await broadcastState();
    return;
  }

  // 파일 저장 (Record로 변환)
  const fileMap: Record<string, string> = {};
  for (const f of result.files) {
    if (f.action !== 'delete') {
      fileMap[f.path] = f.content;
    }
  }
  await StorageManager.mergeFiles(fileMap);

  // 비용 기록
  const costEntry: CostEntry = {
    timestamp: Date.now(),
    model: result.model,
    inputTokens: 0,
    outputTokens: 0,
    cost: result.cost,
    taskId: task.id,
  };
  await StorageManager.addCost(costEntry);

  // 태스크 완료
  await queue.updateStatus(task.id, 'completed', {
    output: result,
    completedAt: Date.now(),
  });

  broadcastProgress({
    taskId: task.id,
    step: 10,
    maxSteps: 10,
    status: `완료: ${result.files.length}개 파일`,
    model: result.model,
    cost: result.cost,
    files: result.files,
    agentRole: 'complete',
  });

  if (settings.notificationsEnabled) {
    showNotification(
      '태스크 완료',
      `${result.files.length}개 파일, $${result.cost.toFixed(4)}`
    );
  }

  await broadcastState();
}

// ─── 새 대화 처리 ───────────────────────────────────────────────
async function handleNewChat(
  userMessage: string,
  claudeResponse: string
): Promise<string> {
  // 기존 파일 로드
  const existingFiles = await StorageManager.getFiles();

  // 큐에 추가
  const task = await queue.enqueue(
    { userMessage, claudeResponse, existingFiles },
    { maxRetries: settings.maxRetries, modelIndex: settings.defaultModelIndex }
  );

  // 로그 기록
  const log: ConversationLog = {
    id: `log_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userMessage,
    claudeResponse,
    status: 'detected',
    taskId: task.id,
  };
  await StorageManager.addLog(log);

  // full_auto면 즉시 queued로 변경 후 처리
  if (settings.executionMode === 'full_auto') {
    await StorageManager.updateTask(task.id, { status: 'queued' });
    processQueue(); // 비동기로 실행
  }

  await broadcastState();

  if (settings.notificationsEnabled) {
    const modeMsg =
      settings.executionMode === 'full_auto'
        ? '자동 실행 중'
        : '승인 대기';
    showNotification('새 대화 감지', `${modeMsg}: ${userMessage.slice(0, 80)}`);
  }

  return task.id;
}

// ─── 메시지 핸들러 ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener(
  (
    message: ChromeMessage,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: unknown) => void
  ) => {
    initialize().then(() => handleMessage(message, sendResponse));
    return true;
  }
);

async function handleMessage(
  msg: ChromeMessage,
  respond: (r: unknown) => void
): Promise<void> {
  const data = msg.data as Record<string, unknown> | undefined;

  try {
    switch (msg.type) {
      case 'NEW_CHAT_DETECTED': {
        const taskId = await handleNewChat(
          data?.userMessage as string,
          data?.claudeResponse as string
        );
        respond({ success: true, taskId });
        break;
      }

      case 'APPROVE_TASK': {
        const taskId = data?.taskId as string;
        await StorageManager.updateTask(taskId, { status: 'queued' });
        processQueue();
        respond({ success: true });
        break;
      }

      case 'SKIP_TASK': {
        const taskId = data?.taskId as string;
        await StorageManager.updateTask(taskId, {
          status: 'skipped',
          completedAt: Date.now(),
        });
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'CANCEL_TASK': {
        const taskId = data?.taskId as string;
        await queue.cancel(taskId);
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'RETRY_TASK': {
        const taskId = data?.taskId as string;
        const tasks = await StorageManager.getTasks();
        const target = tasks.find((t) => t.id === taskId);
        if (target) {
          await StorageManager.updateTask(taskId, {
            status: 'queued',
            error: null,
            completedAt: null,
          });
          processQueue();
        }
        respond({ success: true });
        break;
      }

      case 'REORDER_TASKS': {
        const { taskId, priority } = data as { taskId: string; priority: string };
        await queue.reorderTask(taskId, priority as Task['priority']);
        respond({ success: true });
        break;
      }

      case 'GET_STATE': {
        const state = await buildState();
        const stats = await queue.getStats();
        respond({ success: true, state, queueStats: stats });
        break;
      }

      case 'GET_ALL_DATA': {
        const [tasks, logs, rawFiles, costs] = await Promise.all([
          StorageManager.getTasks(),
          StorageManager.getLogs(),
          StorageManager.getFiles(),
          StorageManager.getCosts(),
        ]);
        // files: Record → FileOutput[] 변환
        const files: FileOutput[] = Object.entries(rawFiles).map(
          ([path, content]) => ({
            path,
            content,
            action: 'create' as const,
            language: 'typescript',
          })
        );
        const state = await buildState();
        respond({ success: true, state, tasks, logs, files, costs, settings });
        break;
      }

      case 'GET_SETTINGS': {
        respond({ success: true, settings });
        break;
      }

      case 'SAVE_SETTINGS': {
        const partial = data as Partial<OmniCoderSettings>;
        settings = { ...settings, ...partial };
        await StorageManager.saveSettings(settings);
        orchestrator.updateApiKey(settings.apiKey);
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'TOGGLE_MONITOR': {
        settings.isMonitoring = !settings.isMonitoring;
        await StorageManager.saveSettings({ isMonitoring: settings.isMonitoring });

        // content script에 알림
        const tabs = await chrome.tabs.query({ url: 'https://www.genspark.ai/*' });
        for (const tab of tabs) {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, {
              type: 'MONITOR_STATUS',
              data: { isMonitoring: settings.isMonitoring },
            });
          }
        }

        respond({ success: true, isMonitoring: settings.isMonitoring });
        break;
      }

      case 'SET_EXECUTION_MODE': {
        const mode = (data as { executionMode: string }).executionMode;
        settings.executionMode = mode as OmniCoderSettings['executionMode'];
        await StorageManager.saveSettings({ executionMode: settings.executionMode });
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'SET_MODEL': {
        const modelIndex =
          (data as { modelIndex?: number }).modelIndex ??
          MODEL_TIERS.findIndex(
            (m) => m.id === (data as { modelId?: string }).modelId
          );
        if (modelIndex >= 0) {
          settings.defaultModelIndex = modelIndex;
          await StorageManager.saveSettings({ defaultModelIndex: modelIndex });
        }
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'TEST_API': {
        try {
          const apiKey = (data as { apiKey?: string })?.apiKey || settings.apiKey;
          const testClient = new ClaudeClient(apiKey);
          const result = await testClient.testConnection();
          respond({
            success: result.success,
            message: result.success ? 'API 연결 성공' : result.error || 'API 연결 실패',
          });
        } catch (err) {
          respond({
            success: false,
            message: err instanceof Error ? err.message : 'API 테스트 실패',
          });
        }
        break;
      }

      case 'GENSPARK_LOGIN': {
        try {
          const raw = (data as { cookies?: Array<{
            name: string; value: string; domain?: string;
            path?: string; secure?: boolean; httpOnly?: boolean;
            expirationDate?: number;
          }> }).cookies;
          if (!Array.isArray(raw)) {
            respond({ success: false, error: 'cookies array required' });
            break;
          }
          const cookies = raw;
          for (const c of cookies) {
            await chrome.cookies.set({
              url: 'https://www.genspark.ai',
              name: c.name,
              value: c.value,
              domain: c.domain || '.genspark.ai',
              path: c.path || '/',
              secure: c.secure ?? true,
              httpOnly: c.httpOnly ?? false,
              expirationDate: c.expirationDate || Date.now() / 1000 + 86400 * 30,
            });
          }
          const gsTabs = await chrome.tabs.query({
            url: 'https://www.genspark.ai/*',
          });
          for (const tab of gsTabs) {
            if (tab.id) chrome.tabs.reload(tab.id);
          }
          respond({ success: true, message: 'Genspark 쿠키 설정 완료' });
        } catch (err) {
          respond({
            success: false,
            error: err instanceof Error ? err.message : 'Cookie 설정 실패',
          });
        }
        break;
      }

      case 'EXPORT_LOGS': {
        const exported = await StorageManager.exportAll();
        respond({ success: true, data: exported });
        break;
      }

      case 'CLEAR_LOGS': {
        await StorageManager.saveLogs([]);
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'EXPORT_FILES': {
        const files = await StorageManager.getFiles();
        const fileList: FileOutput[] = Object.entries(files).map(
          ([path, content]) => ({ path, content, action: 'create' as const, language: 'typescript' })
        );
        respond({ success: true, files: fileList });
        break;
      }

      case 'IMPORT_DATA': {
        const jsonStr = (data as { data: string }).data;
        await StorageManager.importAll(
          typeof jsonStr === 'string' ? jsonStr : JSON.stringify(jsonStr)
        );
        isInitialized = false;
        await initialize();
        respond({ success: true });
        break;
      }

      case 'CLEAR_DATA': {
        await StorageManager.clearAll();
        settings = { ...DEFAULT_SETTINGS };
        isInitialized = false;
        await initialize();
        await broadcastState();
        respond({ success: true });
        break;
      }

      case 'RUN_SELECTOR_TEST': {
        const targetTabs = await chrome.tabs.query({ url: 'https://www.genspark.ai/*' });
        if (targetTabs.length === 0 || !targetTabs[0].id) {
          respond({ success: false, error: 'Genspark 탭 없음' });
          break;
        }
        try {
          const results = await chrome.scripting.executeScript({
            target: { tabId: targetTabs[0].id },
            func: () => {
              const selectors = [
                { name: 'userMessage', sel: '.conversation-statement.user .content' },
                { name: 'userMessage (fallback)', sel: '.conversation-item-desc.user' },
                { name: 'assistantMessage', sel: '.conversation-statement.assistant .content' },
                { name: 'assistantMessage (fallback)', sel: '.conversation-item-desc.assistant' },
                { name: 'chatContainer', sel: '.conversation-content' },
                { name: 'chatContainer (fallback)', sel: '.chat-wrapper' },
                { name: 'inputArea', sel: 'textarea.j-search-input' },
                { name: 'sendButton', sel: '.enter-icon-wrapper' },
                { name: 'stopButton', sel: '.stop-generation-btn' },
                { name: 'bubble (user)', sel: '.conversation-statement.user .bubble' },
                { name: 'bubble (assistant)', sel: '.conversation-statement.assistant .bubble' },
              ];
              const out: Record<string, { found: boolean; count: number; sample: string }> = {};
              for (const { name, sel } of selectors) {
                const els = document.querySelectorAll(sel);
                out[name] = {
                  found: els.length > 0,
                  count: els.length,
                  sample: els.length > 0 ? (els[els.length - 1].textContent || '').trim().slice(0, 100) : '',
                };
              }
              return out;
            },
          });
          respond({ success: true, results: results?.[0]?.result ?? null });
        } catch (err) {
          respond({
            success: false,
            error: err instanceof Error ? err.message : 'Selector test failed',
          });
        }
        break;
      }

      case 'DOWNLOAD_FILE': {
        const { path, content } = data as { path: string; content: string };
        // 서비스워커에서는 Blob/createObjectURL 사용 불가 → data URL 사용
        const base64 = btoa(unescape(encodeURIComponent(content)));
        const dataUrl = `data:text/plain;base64,${base64}`;
        chrome.downloads.download({
          url: dataUrl,
          filename: path.replace(/\//g, '_'),
          saveAs: true,
        });
        respond({ success: true });
        break;
      }

      default:
        respond({ success: false, error: `Unknown: ${msg.type}` });
    }
  } catch (err) {
    console.error('[OmniCoder] Message handler error:', err);
    respond({
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
}

// ─── 브로드캐스트 ────────────────────────────────────────────────
async function broadcastState(): Promise<void> {
  const state = await buildState();
  const stats = await queue.getStats();
  chrome.runtime.sendMessage({
    type: 'STATE_UPDATE',
    data: { state, queueStats: stats },
  }).catch(() => {});
}

function broadcastProgress(progress: ProgressUpdate): void {
  chrome.runtime.sendMessage({
    type: 'PROGRESS_UPDATE',
    data: progress,
  }).catch(() => {});
}

// ─── 알림 ────────────────────────────────────────────────────────
function showNotification(title: string, message: string): void {
  chrome.notifications.create({
    type: 'basic',
    iconUrl: chrome.runtime.getURL('src/assets/icon128.png'),
    title: `OmniCoder: ${title}`,
    message,
  });
}

// ─── 일일 정리 ──────────────────────────────────────────────────
async function dailyCleanup(): Promise<void> {
  await StorageManager.cleanup(settings.autoCleanupDays);
}

// ─── 설치 이벤트 ────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async (details) => {
  await initialize();
  if (details.reason === 'install') {
    showNotification('설치 완료', 'API 키를 설정해주세요.');
  }
});

// ─── 시작 ───────────────────────────────────────────────────────
initialize();
console.log('[OmniCoder] Background service worker loaded');

// ─── 아이콘 클릭 시 대시보드를 새 탭으로 열기 ─────────────────
chrome.action.onClicked.addListener(async () => {
  const dashboardUrl = chrome.runtime.getURL('src/dashboard/index.html');
  const tabs = await chrome.tabs.query({});
  const existing = tabs.find((t) => t.url?.startsWith(dashboardUrl));

  if (existing && existing.id) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId) {
      await chrome.windows.update(existing.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
});
