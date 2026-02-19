# OmniCoder v2.0 기술 사양서

## 1. 시스템 아키텍처

### 1.1 전체 구조
```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                    │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Content  │  │Background│  │    Dashboard       │  │
│  │ Scripts  │→ │ Service  │← │    (React)         │  │
│  │          │  │ Worker   │  │                    │  │
│  │• Claude  │  │• Engine  │  │• 컨트롤 패널      │  │
│  │  Monitor │  │• Queue   │  │• 태스크 관리      │  │
│  │• GenSpark│  │• Agents  │  │• 로그 뷰어        │  │
│  │  Login   │  │• Storage │  │• 파일 탐색기      │  │
│  │          │  │• Alarms  │  │• 설정             │  │
│  └──────────┘  └────┬─────┘  │• 비용 대시보드    │  │
│                     │        │• DOM 디버거       │  │
│                     ▼        └───────────────────┘  │
│              ┌──────────┐                            │
│              │Claude API│                            │
│              │(Haiku →  │                            │
│              │ Sonnet → │                            │
│              │ Opus)    │                            │
│              └──────────┘                            │
└─────────────────────────────────────────────────────┘
```

### 1.2 기술 스택
- Build: Vite 6 + @crxjs/vite-plugin
- Language: TypeScript 5 (strict)
- UI: React 19 + Tailwind CSS
- State: Zustand
- Testing: Vitest + @testing-library/react
- Storage: chrome.storage.sync + chrome.storage.local
- Scheduling: chrome.alarms API

---

## 2. 모듈 상세 설계

### 2.1 Background Service Worker (background/index.ts)

핵심 엔진. 모든 로직의 중심.

#### 2.1.1 서비스워커 영구 유지 (Keep-Alive)
MV3 서비스워커는 30초 후 비활성화됨. 반드시 해결해야 함.

```typescript
// chrome.alarms로 25초마다 깨우기
chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive') {
    // 상태 체크 및 큐 처리
    processQueue();
  }
});

// offscreen document로 WebSocket 유지 (백업)
chrome.offscreen.createDocument({
  url: 'offscreen.html',
  reasons: ['WORKERS'],
  justification: 'Keep service worker alive'
});
```

#### 2.1.2 태스크 큐 시스템 (queue/TaskQueue.ts)
```typescript
interface Task {
  id: string;
  type: 'code_generation' | 'error_fix' | 'review' | 'test_generation';
  priority: 'low' | 'medium' | 'high' | 'critical';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  input: {
    userMessage: string;
    claudeResponse: string;
    existingFiles: Record<string, string>;
  };
  output: {
    files: FileOutput[];
    commands: string[];
    gitMessage: string;
    cost: number;
    model: string;
  } | null;
  retryCount: number;
  maxRetries: number;
  currentModel: ModelTier;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  parentTaskId: string | null; // 서브태스크용
}

interface FileOutput {
  path: string;
  content: string;
  action: 'create' | 'modify' | 'delete';
  language: string;
}
```

큐 기능:
- 우선순위 기반 처리
- 동시 실행 제한 (최대 3개 병렬)
- 실패 시 자동 재시도 + 모델 업그레이드
- 서브태스크 분할 (큰 작업 → 작은 작업으로 나누기)
- 스케줄링 (예약 실행)
- 영속 저장 (chrome.storage.local)

#### 2.1.3 멀티 에이전트 오케스트레이터 (agents/Orchestrator.ts)

Claude Code의 sub-agent 패턴을 API로 재현.

```typescript
interface Agent {
  id: string;
  role: 'architect' | 'coder' | 'reviewer' | 'tester' | 'debugger';
  model: ModelTier;
  systemPrompt: string;
  conversationHistory: Message[];
}

// 에이전트 역할:
// 1. Architect (Opus 채팅에서 스크래핑한 설계)
// 2. Coder (Haiku/Sonnet - 코드 작성)
// 3. Reviewer (Haiku - 코드 리뷰)
// 4. Tester (Haiku - 테스트 코드 생성)
// 5. Debugger (Sonnet - 에러 수정)
```

플로우:
```
Architect(무료 Claude 채팅) 
  → Coder(Haiku)가 코드 생성
  → Reviewer(Haiku)가 코드 리뷰
  → Tester(Haiku)가 테스트 생성
  → Debugger(Sonnet)가 에러 수정
  → 모든 에이전트 통과할 때까지 반복 (Ralph Loop)
```

#### 2.1.4 모델 자동 전환 (api/ModelSwitcher.ts)
```typescript
const MODEL_TIERS: ModelTier[] = [
  { id: 'claude-3-5-haiku-20241022', name: 'Haiku 3.5', inputPer1M: 0.25, outputPer1M: 1.25 },
  { id: 'claude-haiku-4-5', name: 'Haiku 4.5', inputPer1M: 1, outputPer1M: 5 },
  { id: 'claude-sonnet-4', name: 'Sonnet 4', inputPer1M: 3, outputPer1M: 15 },
  { id: 'claude-opus-4-6', name: 'Opus 4.6', inputPer1M: 5, outputPer1M: 25 }
];

// 전환 조건:
// 1. API 에러 (rate limit, 500 등) → 다음 티어
// 2. 코드 품질 점수 < 60% → 다음 티어
// 3. 3회 연속 같은 에러 → 다음 티어
// 4. 사용자 수동 전환 가능
```

#### 2.1.5 자율 실행 루프 — Ralph Loop 패턴 적용
```typescript
async function ralphLoop(task: Task): Promise<TaskResult> {
  const MAX_ITERATIONS = 10;
  
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    // 1단계: 코드 생성
    const code = await coderAgent.generate(task);
    
    // 2단계: 정적 분석 (문법, 타입 체크)
    const syntaxErrors = await staticAnalysis(code);
    if (syntaxErrors.length > 0) {
      task = enrichTaskWithErrors(task, syntaxErrors);
      continue;
    }
    
    // 3단계: 코드 리뷰 (별도 에이전트)
    const reviewResult = await reviewerAgent.review(code);
    if (reviewResult.issues.length > 0 && reviewResult.score < 70) {
      task = enrichTaskWithReview(task, reviewResult);
      continue;
    }
    
    // 4단계: 테스트 생성 및 실행 (TDD)
    const tests = await testerAgent.generateTests(code);
    const testResult = await runTests(tests, code);
    if (!testResult.allPassed) {
      task = enrichTaskWithTestFailures(task, testResult);
      continue;
    }
    
    // 5단계: 모든 검증 통과 → 완료
    return { success: true, files: code.files, tests };
  }
  
  // 최대 반복 초과 → 모델 업그레이드 후 재시도
  return upgradeModelAndRetry(task);
}
```

### 2.2 Content Script — Claude Monitor (content/claude-monitor.ts)

#### 2.2.1 DOM 감시 전략 (3중 감지)
```typescript
// 전략 1: MutationObserver (메인)
// - 채팅 컨테이너의 childList 변화 감지
// - Stop 버튼 출현/소멸로 응답 상태 추적

// 전략 2: 버튼 상태 감시 (보조)
// - Send 버튼 disabled 상태 변화
// - Copy 버튼 개수 변화

// 전략 3: 폴링 (백업, 5초 간격)
// - 메시지 개수 비교
// - 최후의 수단

// 셀렉터 자동 탐지 시스템:
// DOM이 바뀌면 자동으로 대체 셀렉터를 찾아 적용
interface SelectorConfig {
  primary: string;
  fallbacks: string[];
  autoDetect: boolean; // true면 자동 탐지
}
```

#### 2.2.2 메시지 추출
Claude Chat Exporter 오픈소스의 검증된 방법 적용:
- Human 메시지: Edit 버튼 시뮬레이션 → textarea 값 추출
- Claude 메시지: Copy 버튼 시뮬레이션 → 클립보드 인터셉트
- 100% 정확한 마크다운 추출 보장

#### 2.2.3 상태 배지 UI
- 우측 하단 플로팅 배지
- 상태: 감시중(초록) / 응답대기(파랑) / 감지됨(노랑) / 에러(빨강) / 정지(회색)
- 클릭 시 토글
- 드래그로 위치 이동 가능

### 2.3 Dashboard (React)

#### 2.3.1 페이지 구성
```
대시보드 레이아웃 (탭 기반, 팝업 800x600):

1. 🎮 컨트롤 센터
   - 모니터링 ON/OFF (대형 토글)
   - 실행 모드: 수동승인 / 반자동 / 완전자동
   - 모델 선택 (티어별 가격 표시)
   - 자동 업그레이드 ON/OFF
   - 실시간 진행 상황 (프로그레스 바 + 스텝 로그)
   - 대기 중 승인 카드

2. 📋 태스크 매니저
   - 태스크 큐 리스트 (우선순위, 상태, 모델, 비용)
   - 태스크 상세 (입력/출력/에러/재시도 이력)
   - 태스크 스케줄링 (예약 실행)
   - 드래그앤드롭 우선순위 변경

3. 💬 대화 로그
   - 전체 대화 타임라인
   - 대화별 상세 (사용자 질문 + Opus 응답 + 생성된 코드)
   - 검색 및 필터
   - 내보내기 (JSON/마크다운)

4. 📁 프로젝트 탐색기
   - 파일 트리 (좌측)
   - 코드 미리보기 (우측, 구문 하이라이트)
   - diff 뷰어 (변경 전/후)
   - ZIP 다운로드
   - GitHub 저장소 연동 (push)

5. 💰 비용 대시보드
   - 총 누적 비용
   - 모델별 비용 차트
   - 일별/주별 트렌드
   - 예상 월 비용
   - 절약된 금액 (Opus 대비)

6. 🔍 디버거
   - DOM 셀렉터 실시간 테스트
   - 현재 적용 중인 셀렉터 목록
   - 셀렉터 자동 탐지 결과
   - 콘솔 로그 뷰어
   - 에러 히스토리

7. ⚙️ 설정
   - API 키 (입력 + 테스트 + 저장)
   - 프로젝트 설정
   - 모델/실행 설정
   - 젠스파크 쿠키 (자동 로그인)
   - 알림 설정
   - 데이터 관리 (백업/복원/초기화)
```

#### 2.3.2 UI 컴포넌트 상세

React 컴포넌트:
```
src/dashboard/
├── App.tsx
├── components/
│   ├── Layout/
│   │   ├── Header.tsx        (로고, 비용, 상태)
│   │   ├── TabNav.tsx        (탭 네비게이션)
│   │   └── StatusBar.tsx     (하단 상태바)
│   ├── Control/
│   │   ├── MonitorToggle.tsx
│   │   ├── ExecutionMode.tsx
│   │   ├── ModelSelector.tsx
│   │   ├── ProgressPanel.tsx
│   │   └── ApprovalCard.tsx
│   ├── Tasks/
│   │   ├── TaskQueue.tsx
│   │   ├── TaskDetail.tsx
│   │   └── TaskScheduler.tsx
│   ├── Logs/
│   │   ├── ConversationTimeline.tsx
│   │   ├── LogDetail.tsx
│   │   └── LogSearch.tsx
│   ├── Files/
│   │   ├── FileTree.tsx
│   │   ├── CodePreview.tsx   (구문 하이라이트: highlight.js)
│   │   ├── DiffViewer.tsx
│   │   └── DownloadPanel.tsx
│   ├── Cost/
│   │   ├── CostSummary.tsx
│   │   ├── CostChart.tsx     (차트: recharts)
│   │   └── CostProjection.tsx
│   ├── Debug/
│   │   ├── SelectorTester.tsx
│   │   ├── SelectorList.tsx
│   │   └── ErrorHistory.tsx
│   └── Settings/
│       ├── ApiKeyForm.tsx
│       ├── ProjectConfig.tsx
│       ├── ModelConfig.tsx
│       ├── GensparkConfig.tsx
│       ├── NotificationConfig.tsx
│       └── DataManager.tsx
├── stores/
│   ├── appStore.ts           (Zustand 전역 상태)
│   ├── taskStore.ts
│   └── settingsStore.ts
├── hooks/
│   ├── useChromeMessage.ts
│   ├── useSettings.ts
│   └── useAutoRefresh.ts
└── utils/
    ├── formatters.ts
    ├── costCalculator.ts
    └── exporters.ts
```

### 2.4 API Client (api/ClaudeClient.ts)

```typescript
// 핵심 기능:
// - 재시도 로직 (exponential backoff)
// - Rate limit 자동 대기
// - 비용 실시간 추적
// - 응답 스트리밍 지원
// - 프롬프트 캐싱 활용 (반복 시스템 프롬프트)
// - 토큰 사용량 추적

interface APICallOptions {
  model: string;
  messages: Message[];
  maxTokens: number;
  system?: string;
  stream?: boolean;
  cache?: boolean; // 프롬프트 캐싱
}

// 에러별 처리:
// 400 Bad Request → 프롬프트 수정 후 재시도
// 401 Unauthorized → API 키 재확인 알림
// 429 Rate Limited → 대기 후 재시도
// 500 Server Error → 다른 모델로 전환
// 529 Overloaded → 대기 후 재시도
```

### 2.5 Storage (storage/StorageManager.ts)

```typescript
// chrome.storage.sync — 설정 (API키, 모델 설정 등)
// chrome.storage.local — 로그, 태스크, 파일 (용량 큼)

// 데이터 압축: 큰 파일은 LZ-String으로 압축 저장
// 자동 정리: 30일 이상 된 로그 자동 삭제
// 백업/복원: JSON 내보내기/가져오기
// 마이그레이션: 버전 업그레이드 시 스키마 변환
```

### 2.6 Genspark 자동 로그인 (content/genspark-login.ts)

```typescript
// 쿠키 기반 자동 로그인
// 1. 설정에서 쿠키 JSON 입력
// 2. chrome.cookies API로 쿠키 설정
// 3. 페이지 로드 시 로그인 상태 확인
// 4. 만료 시 자동 재설정 + 알림
```

---

## 3. 보안 설계

- API 키는 chrome.storage.sync에 암호화 저장
- Content Script는 claude.ai, genspark.ai에만 동작
- CSP (Content Security Policy) 적용
- 모든 외부 API 호출은 background에서만
- 사용자 데이터는 로컬만 저장 (외부 전송 없음)

---

## 4. 테스트 전략 (TDD)

```
모든 모듈에 대해:
1. 단위 테스트 (vitest)
   - API Client: 모킹된 응답으로 재시도, 모델전환 테스트
   - TaskQueue: 우선순위, 동시실행, 재시도 로직
   - ModelSwitcher: 전환 조건, 비용 계산
   - StorageManager: 저장, 로드, 마이그레이션
   - Orchestrator: 에이전트 플로우, Ralph Loop

2. 컴포넌트 테스트 (@testing-library/react)
   - 모든 React 컴포넌트의 렌더링 + 인터랙션

3. 통합 테스트
   - 대화 감지 → 큐 등록 → API 호출 → 파일 생성 전체 플로우
```

---

## 5. 구현 순서 (서브에이전트 병렬 가능)

### Phase 1: 기반 (병렬 가능)
- [ ] 프로젝트 스캐폴딩 (Vite + React + TypeScript)
- [ ] chrome.storage 래퍼 (StorageManager)
- [ ] Claude API 클라이언트 + 모델 전환
- [ ] 태스크 큐 시스템

### Phase 2: 핵심 (순차)
- [ ] Content Script (claude.ai 감시)
- [ ] Background 엔진 (태스크 처리 + Ralph Loop)
- [ ] 멀티 에이전트 오케스트레이터

### Phase 3: UI (병렬 가능)
- [ ] 대시보드 레이아웃 + 탭
- [ ] 컨트롤 패널
- [ ] 태스크 매니저
- [ ] 대화 로그
- [ ] 프로젝트 탐색기
- [ ] 비용 대시보드
- [ ] 디버거
- [ ] 설정

### Phase 4: 부가 기능
- [ ] 젠스파크 자동 로그인
- [ ] DOM 셀렉터 자동 탐지
- [ ] ZIP 다운로드
- [ ] 데이터 백업/복원
- [ ] 알림 시스템

### Phase 5: 검증
- [ ] 전체 테스트 통과
- [ ] 린트 에러 0개
- [ ] 타입 에러 0개
- [ ] 빌드 성공
- [ ] 실제 claude.ai에서 동작 확인

---

## Claude Code 실행 명령어

```bash
# 1. 프로젝트 폴더 생성
mkdir omnicoder-v2 && cd omnicoder-v2
git init

# 2. CLAUDE.md와 SPEC.md를 위 내용으로 저장

# 3. Claude Code 실행 (Sonnet 추천 — 이 프로젝트는 Haiku로 부족)
claude

# 4. 아래 프롬프트 입력:
```

### Claude Code에 넣을 프롬프트:

```
SPEC.md를 정독하고 OmniCoder v2.0을 완전히 구현해줘.

구현 규칙:
1. Phase 순서대로 진행
2. 각 Phase 완료 후 테스트 실행해서 통과 확인
3. 린트, 타입체크 에러 0개 확인
4. 실패하면 스스로 수정하고 다시 테스트
5. 모든 Phase 완료될 때까지 멈추지 마
6. SPEC.md의 모든 기능을 빠짐없이 구현
7. 각 단계 완료 시 CLAUDE.md에 진행상황 업데이트
8. 커밋 메시지는 conventional commits 형식

시작해.
```

---

## 왜 이 방식이 개발인력 10명과 비슷한가

| 역할 | 누가 하는가 |
|---|---|
| PM / 기획자 | 저 (이 대화에서 완성된 SPEC.md) |
| 아키텍트 | 저 (시스템 설계) + Claude Code (구현 설계) |
| 프론트엔드 개발자 3명 | Claude Code 서브에이전트 (React 컴포넌트 병렬) |
| 백엔드 개발자 3명 | Claude Code 서브에이전트 (API, Queue, Agent 병렬) |
| QA 엔지니어 2명 | Claude Code (TDD + Ralph Loop) |
| DevOps | Claude Code (빌드, 린트, 타입체크) |

**예상 비용: Sonnet 기준 $5~15 (7,000~20,000원)**
**예상 시간: Claude Code가 1~3시간 자율 실행**
