# OmniCoder v2.0 — 동일 재현을 위한 상세 명세

다른 AI가 이 프로그램을 **그대로 동일하게** 만들 수 있도록, 구조·동작·코드 위치·데이터 흐름을 최대한 구체적으로 적어 둔 문서입니다.

---

## 1. 프로그램이 하는 일 (한 줄 요약)

**Genspark AI(무료 채팅)에서 사용자–AI 대화를 감지하면, 그 “설계안”을 로컬 bridge 서버로 보내고, bridge가 Claude Code CLI를 실행해 프로젝트 폴더에 파일을 생성·수정한다. 실행 모드에 따라 수동 승인 또는 자동 실행하며, 비용은 대시보드에 원화(₩)로 표시한다.**

---

## 2. 아키텍처 개요

```
[ Genspark (www.genspark.ai/agents) ]
         │
         │ DOM 감시 (content script)
         ▼
[ Content Script: genspark-monitor.ts ]
  - 대화 영역 MutationObserver + 3초 폴링
  - 응답 완료 판단: stop 버튼 숨김, "Thinking" 아님, 마지막 assistant에 .cursor 없음
  - NEW_CHAT_DETECTED 메시지로 background에 전달
         │
         │ chrome.runtime.sendMessage
         ▼
[ Background Service Worker: background/index.ts ]
  - 설정/큐/스토리지 초기화
  - handleNewChat → queue.enqueue → (full_auto면 processQueue)
  - processQueue → executeTask → settings.useBridge ? executeTaskViaBridge : orchestrator
         │
         │ useBridge === true 인 경우
         ▼
[ Bridge Server: bridge-server.cjs ]  (Node.js, 포트 7842)
  - POST /execute 수신: { agentId, userMessage, claudeResponse, model }
  - instruction = "User request: ...\n\nDesign from AI assistant:\n...\n\nImplement exactly as designed above..."
  - runClaudeCodeDumb(instruction, PROJECT_DIR, model) → spawn('claude', ['-p','-', '--output-format','json', '--max-turns','3', '--dangerously-skip-permissions', ...('--model', model) if model])
  - stdin에 instruction 쓰고 end
  - stdout JSON에서 total_cost_usd 파싱 → cost
  - git diff + ls-files로 변경 파일 목록, 제외: src/, dist/, node_modules/, bridge-server.cjs, package.json 등
  - 응답: { success, taskId, cost, changedFiles, fileContents, reportToGenspark }
         │
         │ fetch(`${bridgeUrl}/execute`)
         ▼
[ Claude Code CLI ]  (시스템에 설치된 `claude` 명령)
  - 프로젝트 디렉터리에서 코드 생성/수정
  - JSON 출력에 total_cost_usd 포함
         │
         ▼
[ Background ]
  - result.fileContents → StorageManager.mergeFiles
  - result.cost → StorageManager.addCost (CostEntry)
  - queue.updateStatus(task.id, 'completed', { output, ... })
  - 실패 시 result.reportToGenspark → sendToGenspark (Genspark 입력창에 에러 보고문 자동 입력)

[ Dashboard (React) ]
  - 확장 프로그램 팝업 = src/dashboard/index.html → main.tsx → App
  - GET_ALL_DATA로 state/tasks/logs/files/costs/settings 로드, 5초마다 갱신
  - 컨트롤: 감시 on/off, full_auto/manual, 모델 선택, 승인/스킵/재시도
  - 비용: state.totalCost * 1450 → ₩ 표시
```

---

## 3. 디렉터리 및 파일 구조

```
프로젝트 루트/
├── manifest.json                 # 참고용; 실제 빌드는 vite.config.ts의 manifest 사용
├── package.json
├── vite.config.ts                # crx(manifest) + react, alias '@' -> src
├── tsconfig.json
├── tailwind.config.js
├── bridge-server.cjs              # 독립 실행 Node 서버 (Chrome 확장 빌드에 포함 안 됨)
├── RECREATION.md                  # 이 문서
├── SPEC.md                        # 기존 기술 사양서
│
├── src/
│   ├── background/
│   │   └── index.ts               # 서비스 워커: 메시지 처리, 큐, executeTask / executeTaskViaBridge, sendToGenspark
│   ├── content/
│   │   └── genspark-monitor.ts    # Genspark 페이지 주입: 배지, DOM 감시, getLatestExchange, isResponseComplete, NEW_CHAT_DETECTED
│   ├── dashboard/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── store.ts               # Zustand, sendMessage, loadAllData, toggleMonitor, setModel, approveTask 등
│   │   └── components/
│   │       ├── ControlPanel.tsx   # 감시 토글, 자동/수동, 모델 버튼, AgentStatus, 브릿지 URL
│   │       ├── TaskManager.tsx
│   │       ├── LogViewer.tsx
│   │       ├── FileExplorer.tsx
│   │       ├── CostDashboard.tsx
│   │       ├── DebugPanel.tsx
│   │       └── SettingsPanel.tsx  # API 키, 기본 모델, executionMode, bridge 사용 여부, bridgeUrl 등
│   ├── storage/
│   │   └── StorageManager.ts      # chrome.storage.sync (설정) / local (tasks, logs, files, costs)
│   ├── queue/
│   │   └── TaskQueue.ts           # enqueue, dequeue, updateStatus, retry, cancel, release
│   ├── api/
│   │   └── ClaudeClient.ts        # API 모드용 (useBridge false일 때)
│   ├── agents/
│   │   ├── Orchestrator.ts        # API 모드용
│   │   └── prompts.ts
│   ├── types/
│   │   └── index.ts               # Task, TaskInput, TaskOutput, AppState, OmniCoderSettings, CostEntry, MODEL_TIERS, DEFAULT_SELECTORS 등
│   └── styles/
│       └── tailwind.css
│
└── dist/                          # npm run build 결과 (crx 플러그인 빌드)
```

---

## 4. 빌드 및 실행 방법

- **필수 환경**: Node.js, npm, 시스템에 `claude` CLI 설치됨 (Anthropic Claude Code).
- **의존성 설치**: `npm install`
- **확장 프로그램 빌드**: `npm run build` (또는 `tsc --noEmit && vite build`)
- **Bridge 서버 실행**: 프로젝트 루트에서  
  `node bridge-server.cjs "C:\Projects\미친클로그코드_젠스파크코드생성기"`  
  (인자 없으면 `process.cwd()`가 작업 디렉터리)
- **Chrome**: `chrome://extensions` → “압축해제된 항목 로드” → `dist` 폴더 선택.  
  Genspark 탭에서 확장 아이콘 클릭 시 대시보드(팝업) 열림.

---

## 5. 핵심 타입 정의 (재현 시 그대로 유지)

- **위치**: `src/types/index.ts`

- **ModelTier**: `{ id: string; name: string; inputPer1M: number; outputPer1M: number }`
- **MODEL_TIERS**:  
  `claude-3-5-haiku-20241022` (Haiku 3.5),  
  `claude-haiku-4-5` (Haiku 4.5),  
  `claude-sonnet-4`,  
  `claude-opus-4-6`

- **Task**:  
  `id`, `type`, `priority`, `status`, `input` (TaskInput), `output` (TaskOutput | null),  
  `retryCount`, `maxRetries`, **`currentModelIndex`** (number, MODEL_TIERS 인덱스),  
  `createdAt`, `startedAt`, `completedAt`, `error`, `retryHistory`, `parentTaskId`, `childTaskIds`

- **TaskInput**: `userMessage`, `claudeResponse`, `existingFiles` (Record<string, string>), `context?`

- **TaskOutput**: `summary`, `files` (FileOutput[]), `commands`, `gitMessage`, `cost`, `model`, `isCodingTask`, `questions`

- **CostEntry**: `timestamp`, `model`, `inputTokens`, `outputTokens`, `cost`, `taskId`

- **OmniCoderSettings**:  
  `apiKey`, `defaultModelIndex`, `autoUpgrade`, `maxRetries`, `executionMode` ('manual'|'semi_auto'|'full_auto'),  
  `projectName`, `gitAutoCommit`, `gensparkCookies`, `notificationsEnabled`, `maxConcurrentTasks`,  
  `autoCleanupDays`, `selectorOverrides`, `budgetLimit`, **`isMonitoring`**, **`useBridge`**, **`bridgeUrl`** (기본 `http://127.0.0.1:7842`)

- **DEFAULT_SELECTORS** (Genspark DOM):  
  `userMessage`, `assistantMessage`, `sendButton`, `stopButton`, `copyButton`, `chatContainer`, `inputArea`  
  각각 `{ primary: string; fallbacks: string[] }`.

---

## 6. 스토리지 키 (StorageManager)

- **chrome.storage.sync**: `omnicoder_settings` (OmniCoderSettings)
- **chrome.storage.local**:  
  `omnicoder_tasks`, `omnicoder_logs`, `omnicoder_files` (JSON 문자열), `omnicoder_costs`

파일/태스크/로그는 JSON 직렬화 저장. 비용은 배열 그대로.

---

## 7. Content Script: genspark-monitor.ts (동작 요약)

- **주입 대상**: `https://www.genspark.ai/*` (vite manifest 기준)
- **역할**: Genspark 채팅 페이지에서 “마지막 사용자 메시지 + 마지막 AI 응답” 한 쌍을 감지해, **응답이 완전히 끝난 뒤** 한 번만 background에 알림.

**셀렉터 (기본값, 설정에서 오버라이드 가능)**  
- 사용자 메시지: `.conversation-statement.user .content` (fallback: `.conversation-item-desc.user` 등)  
- AI 메시지: `.conversation-statement.assistant .content` (fallback 동일 패턴)  
- 채팅 컨테이너: `.conversation-content`  
- 입력창: `textarea.j-search-input`  
- 중지 버튼: `.stop-generation-btn`

**응답 “완료” 조건 (isResponseComplete)**  
1. 중지 버튼이 보이면 (display/visibility) → 미완료  
2. assistant 메시지가 없으면 → 미완료  
3. 마지막 assistant의 text가 “Thinking”으로 시작하고 길이 < 30 → 미완료  
4. 마지막 assistant 텍스트가 비어 있으면 → 미완료  
5. **마지막 assistant 노드 안에 `.cursor` 또는 `[class*="cursor"]`가 있으면 → 미완료** (스트리밍 중 커서)  
6. 그 외 → 완료

**감지 경로 두 가지**  
- **MutationObserver**: 채팅 컨테이너(또는 main/body)에 대해 childList + subtree + characterData.  
  assistant 노드 추가/변경 시 `isResponseInProgress = true`, `pendingDetection = true` → 1.5초 디바운스 후 `isResponseComplete()` 이면 `onNewMessageDetected()` 호출.  
- **폴링 (3초)**: `getLatestExchange()`로 마지막 user/assistant 텍스트 취득.  
  `resp !== lastAssistantText` 이고 Thinking 아님, 길이 > 10, **isResponseComplete()** 이면, 중복 키(`${messageCount}:${resp.slice(0,100)}`) 체크 후 `NEW_CHAT_DETECTED` 전송.

**onNewMessageDetected**  
- 메시지 개수 증가 여부 확인  
- resp 비었거나 “Thinking”이면 3초 후 재귀  
- **isResponseComplete() 아니면 3초 후 재귀**  
- `lastSentText` / `lastMessageCount`로 중복 방지 후 `chrome.runtime.sendMessage({ type: 'NEW_CHAT_DETECTED', data: { userMessage, claudeResponse, timestamp, messageCount } })`

**배지**: 우하단 고정, “OmniCoder 감시 중” / “OmniCoder 꺼짐”, 클릭 시 on/off, 드래그 가능.  
**MONITOR_STATUS** 메시지 수신 시 `isEnabled` 반영.

**초기화**: `/agents` 경로일 때만 채팅 컨테이너 찾아서 배지·Observer·폴링 시작.  
SPA URL 변경 감지 시 lastUrl 변경되면 observer/폴링 해제 후 lastMessageCount 등 리셋, `/agents`면 1초 뒤 init 재실행.

---

## 8. Background: index.ts (핵심만)

- **초기화**: `StorageManager.getSettings()` → settings, `TaskQueue(settings.maxConcurrentTasks)`, `queue.onReady(executeTask)` 등록.
- **Alarms**:  
  - `omnicoder-keepalive`: 0.4분 주기 (유지용)  
  - `omnicoder-process-queue`: 0.5분 주기 → `processQueue()`  
  - `omnicoder-daily-cleanup`: 60분 주기 → 로그 정리 등

- **processQueue()**:  
  - `processingLock`으로 동시 한 번만 실행.  
  - `queue.dequeue()`로 태스크 취득.  
  - **manual 모드이고 status가 pending이면** `queue.release(task.id)` 하고 다음 dequeue.  
  - 그 외에는 `executeTask(task)` 호출.  
  - 예외 시 `queue.retry(task.id, errMsg)`.

- **executeTask(task)**  
  - **settings.useBridge === true** → `executeTaskViaBridge(task)` 만 호출 후 종료.  
  - 아니면 Orchestrator + API로 실행 (이 문서에서는 생략 가능).

- **executeTaskViaBridge(task)**  
  - `bridgeUrl = settings.bridgeUrl || 'http://127.0.0.1:7842'`  
  - `agentId = 'agent-' + task.id.slice(-6)`  
  - **modelId = MODEL_TIERS[Math.min(task.currentModelIndex, MODEL_TIERS.length - 1)].id**  
  - `fetch(bridgeUrl + '/execute', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId, userMessage: task.input.userMessage, claudeResponse: task.input.claudeResponse, model: modelId }) })`  
  - 성공 시:  
    - `result.fileContents` → FileOutput[] 변환 (path, content, action: 'create', language: detectLanguage(path))  
    - `StorageManager.mergeFiles(fileMap)`  
    - `result.cost > 0` 이면 `StorageManager.addCost({ timestamp, model: 'claude-code', inputTokens: 0, outputTokens: 0, cost: result.cost, taskId })`  
    - `queue.updateStatus(task.id, 'completed', { output: { summary, files, commands, gitMessage, cost, model: 'claude-code', isCodingTask: true, questions: null }, completedAt })`  
    - `result.reportToGenspark` 있으면 `sendToGenspark(result.reportToGenspark)`  
  - 실패 시:  
    - `sendToGenspark(result.reportToGenspark)`  
    - `queue.updateStatus(task.id, 'pending', { error: result.error })`  
    - 알림: “에러 → Genspark에 보고”

- **sendToGenspark(text)**  
  - `chrome.tabs.query({ url: 'https://www.genspark.ai/*' })`  
  - `/agents` 포함 탭 우선, 없으면 첫 탭  
  - `chrome.scripting.executeScript`로 해당 탭에 함수 주입:  
    - `textarea = document.querySelector('textarea.j-search-input')`  
    - `textarea.value = message` 후 input/change 이벤트 dispatch  
    - 배지 텍스트 잠시 “에러 보고 입력됨 — 전송하세요”로 변경

- **handleNewChat(userMessage, claudeResponse)**  
  - `queue.enqueue({ userMessage, claudeResponse, existingFiles }, { maxRetries: settings.maxRetries, modelIndex: settings.defaultModelIndex })`  
  - ConversationLog 추가 (status: 'detected', taskId 연결)  
  - **executionMode === 'full_auto'** 이면 해당 task를 queued로 바꾼 뒤 `processQueue()` 호출.  
  - broadcastState, 알림.

- **메시지 타입**:  
  NEW_CHAT_DETECTED, APPROVE_TASK, SKIP_TASK, DELETE_TASK, CANCEL_TASK, RETRY_TASK, REORDER_TASKS,  
  GET_STATE, GET_ALL_DATA, GET_SETTINGS, SAVE_SETTINGS, TOGGLE_MONITOR, SET_EXECUTION_MODE, SET_MODEL,  
  TEST_API, GENSPARK_LOGIN, …  
  (TOGGLE_MONITOR 시 Genspark 탭에 MONITOR_STATUS 브로드캐스트.)

---

## 9. Bridge Server: bridge-server.cjs (동작 요약)

- **실행**: `node bridge-server.cjs [PROJECT_DIR]`  
  PROJECT_DIR 기본값: `process.cwd()`.  
  로그: `PROJECT_DIR/omnicoder-bridge.log`

- **runClaudeCodeDumb(instruction, workDir, model)**  
  - `claude`를 다음 인자로 spawn:  
    `-p -`, `--output-format json`, `--max-turns 3`, `--dangerously-skip-permissions`  
    + (model이 있으면) `--model`, model  
  - stdio: ['pipe','pipe','pipe'], shell: true, cwd: workDir, timeout 120000  
  - `child.stdin.write(instruction); child.stdin.end();`  
  - stdout/stderr 수집 후 close 시 resolve({ success: code === 0, stdout, stderr, exitCode })

- **POST /execute**  
  - body: `{ agentId, userMessage, claudeResponse, model }`  
  - instruction 문자열:  
    `User request: ${userMessage}\n\nDesign from AI assistant:\n${claudeResponse}\n\nImplement exactly as designed above. Create all necessary files and write the code to disk.`  
  - `preTaskFiles = snapshotFiles()` (git diff --name-only + git ls-files --others --exclude-standard)  
  - `runClaudeCodeDumb(instruction, PROJECT_DIR, model)`  
  - `getChangedFiles()`: snapshotFiles() 중 preTaskFiles에 없고, src/, dist/, node_modules/, bridge-server.cjs, package.json, package-lock.json, tsconfig.json, vite.config.ts 제외  
  - 성공 시: stdout JSON parse → `total_cost_usd` → cost.  
  - 응답: `{ success: true, taskId, output, cost, changedFiles, fileContents, reportToGenspark }`  
  - 실패 시: `buildErrorReport(instruction, stderr, stdout)` → reportToGenspark, 응답에 success: false, error, reportToGenspark, changedFiles

- **기타 엔드포인트**: /status, /agent/register, /agents, /file/:path, /files 등 (에이전트 목록/상태, 파일 목록 등).

---

## 10. 대시보드 (React + Zustand)

- **진입점**: 확장 프로그램 action의 default_popup이 빌드 시 `dist/src/dashboard/index.html`로 설정됨 (crx 플러그인 빌드 결과).
- **store (store.ts)**:  
  - state, tasks, logs, files, costs, settings, progress, isConnected, activeTab  
  - sendMessage(msg): chrome.runtime.sendMessage  
  - loadAllData(): GET_ALL_DATA → state/tasks/logs/files/costs/settings 반영  
  - toggleMonitor, setAutoMode, setModel, approveTask, skipTask, cancelTask, retryTask, deleteTask, saveSettings, testApi, exportData, importData, clearData

- **App.tsx**:  
  - 탭: control, tasks, logs, files, costs, debug, settings  
  - 헤더: 모델명(MODEL_TIERS[state.currentModelIndex].name), 비용 ₩(state.totalCost * 1450), 완료 개수  
  - 5초마다 loadAllData, STATE_UPDATE / PROGRESS_UPDATE 리스너

- **ControlPanel**:  
  - 감시 on/off 버튼, 자동/수동 모드, 모델 버튼(MODEL_TIERS), AgentStatus(bridgeUrl로 /agents 폴링), 브릿지 URL 표시

- **SettingsPanel**:  
  - API 키, 기본 모델(select MODEL_TIERS), executionMode, **useBridge 체크**, **bridgeUrl**, 기타 설정

- **비용 표시**:  
  - App 헤더: `state.totalCost * 1450` 원화  
  - CostDashboard 등에서 costHistory 사용

---

## 11. 비용이 대시보드에 반영되는 경로

1. Bridge가 Claude Code stdout에서 `total_cost_usd` 파싱 → 응답의 `cost`  
2. Background의 executeTaskViaBridge에서 `result.cost` → `StorageManager.addCost({ ... cost: bridgeCost, taskId })`  
3. buildState()에서 `costHistory`를 가져와 `totalCost = costs.reduce((s, c) => s + c.cost, 0)`  
4. 대시보드는 GET_ALL_DATA 또는 STATE_UPDATE로 state를 받아 `state.totalCost * 1450`을 ₩로 표시  

→ **빌드가 최신이어야** background의 addCost/mergeFiles 로직이 확장에 포함되므로, 비용이 ₩0으로 남는 경우 “빌드 후 확장 다시 로드”가 필요함.

---

## 12. 재현 체크리스트

- [ ] package.json: react 19, zustand, recharts, highlight.js, lz-string, @crxjs/vite-plugin, vite 6, tailwind, typescript 5
- [ ] vite.config: crx(manifest), host_permissions에 http://127.0.0.1:7842
- [ ] manifest: content_scripts는 Genspark만 (genspark-monitor.ts), background service_worker, action default_popup은 빌드 결과의 dashboard index.html
- [ ] types: Task에 currentModelIndex, OmniCoderSettings에 useBridge, bridgeUrl, DEFAULT_SETTINGS 값
- [ ] StorageManager: KEYS, getSettings, saveSettings, getTasks, addTask, updateTask, getLogs, addLog, getFiles, mergeFiles, getCosts, addCost
- [ ] TaskQueue: enqueue(옵션 modelIndex), dequeue, updateStatus, retry(모델 업그레이드), cancel, release
- [ ] genspark-monitor: SELECTORS, getLatestExchange, isStopButtonVisible, isResponseComplete(**.cursor** 체크 포함), onNewMessageDetected( isResponseComplete 후에만 전송), MutationObserver + 3초 폴링, lastSentText/lastMessageCount/lastAssistantText 중복 방지, MONITOR_STATUS 수신
- [ ] background: initialize, processQueue(manual이면 pending 시 release), executeTask → useBridge ? executeTaskViaBridge : orchestrator, executeTaskViaBridge에서 body에 **model: MODEL_TIERS[task.currentModelIndex].id** 포함, result.cost → addCost, result.fileContents → mergeFiles, sendToGenspark(textarea 주입)
- [ ] bridge-server: runClaudeCodeDumb(instruction, workDir, **model**), spawn 시 model이 있으면 --model 추가, /execute에서 data.model 전달, getChangedFiles 제외 목록, total_cost_usd 파싱
- [ ] dashboard: store sendMessage/loadAllData/toggleMonitor/setModel/approveTask, App 탭/헤더 비용(₩), ControlPanel 모델 버튼/AgentStatus, SettingsPanel useBridge/bridgeUrl

위 항목을 모두 만족하면 “Genspark 설계안 → bridge → Claude Code 실행 → 비용·파일 반영” 및 “대시보드 선택 모델을 bridge로 전달”까지 동일하게 재현할 수 있습니다.
