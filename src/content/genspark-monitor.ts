/**
 * OmniCoder v2.0 — Genspark AI 대화 감시 Content Script
 * https://www.genspark.ai/agents* 에서 동작
 */
(() => {
  'use strict';

  const SELECTORS: Record<string, string | string[]> = {
    userMessage: '.conversation-statement.user .content',
    userMessageFallbacks: [
      '.conversation-item-desc.user',
      '.conversation-statement.user .bubble',
      '.conversation-statement.user',
    ],
    assistantMessage: '.conversation-statement.assistant .content',
    assistantMessageFallbacks: [
      '.conversation-item-desc.assistant',
      '.conversation-statement.assistant .bubble',
      '.conversation-statement.assistant',
    ],
    chatContainer: '.conversation-content',
    chatContainerFallbacks: [
      '.conversation-wrapper',
      '.chat-wrapper',
      '.general-chat-wrapper',
    ],
    inputArea: 'textarea.j-search-input',
    sendButton: '.enter-icon-wrapper',
    stopButton: '.stop-generation-btn',
  };

  let lastMessageCount = -1;
  let isEnabled = true;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastSentKey = '';
  let stableText = '';
  let stableCount = 0;
  let initDone = false;

  // ─── 헬퍼 ───────────────────────────────────────────────────
  function $(sel: string, fallbacks?: string[]): Element | null {
    let el = document.querySelector(sel);
    if (el) return el;
    if (fallbacks) {
      for (const fb of fallbacks) {
        el = document.querySelector(fb);
        if (el) return el;
      }
    }
    return null;
  }

  function $$(sel: string, fallbacks?: string[]): Element[] {
    let els = Array.from(document.querySelectorAll(sel));
    if (els.length > 0) return els;
    if (fallbacks) {
      for (const fb of fallbacks) {
        els = Array.from(document.querySelectorAll(fb));
        if (els.length > 0) return els;
      }
    }
    return [];
  }

  // ─── 배지 UI ────────────────────────────────────────────────
  function createBadge(): void {
    if (document.getElementById('omnicoder-badge')) return;

    const badge = document.createElement('div');
    badge.id = 'omnicoder-badge';
    badge.innerHTML = `
      <div style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        z-index: 999999;
        background: linear-gradient(135deg, #6366f1, #8b5cf6);
        color: white;
        padding: 8px 14px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        gap: 6px;
        user-select: none;
        transition: opacity 0.2s;
      " id="omnicoder-badge-inner">
        <span id="omnicoder-dot" style="
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #22c55e;
          display: inline-block;
        "></span>
        <span id="omnicoder-text">OmniCoder 감시 중</span>
      </div>
    `;
    document.body.appendChild(badge);

    const inner = document.getElementById('omnicoder-badge-inner');
    if (inner) {
      inner.addEventListener('click', () => {
        isEnabled = !isEnabled;
        const dot = document.getElementById('omnicoder-dot');
        const text = document.getElementById('omnicoder-text');
        if (dot) dot.style.background = isEnabled ? '#22c55e' : '#ef4444';
        if (text) text.textContent = isEnabled ? 'OmniCoder 감시 중' : 'OmniCoder 꺼짐';
      });

      let isDragging = false;
      let offsetX = 0;
      let offsetY = 0;

      inner.addEventListener('mousedown', (e: MouseEvent) => {
        isDragging = true;
        offsetX = e.clientX - inner.getBoundingClientRect().left;
        offsetY = e.clientY - inner.getBoundingClientRect().top;
      });

      document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!isDragging) return;
        inner.style.position = 'fixed';
        inner.style.left = `${e.clientX - offsetX}px`;
        inner.style.top = `${e.clientY - offsetY}px`;
        inner.style.right = 'auto';
        inner.style.bottom = 'auto';
      });

      document.addEventListener('mouseup', () => { isDragging = false; });
    }
  }

  // ─── 핵심: Genspark이 아직 생성 중인지 판별 ─────────────────
  function isGenerating(): boolean {
    // 방법 1: enter-icon-wrapper 안에 svg.stop-icon이 있으면 생성 중
    const enterWrapper = document.querySelector('.enter-icon-wrapper');
    if (enterWrapper) {
      const stopIcon = enterWrapper.querySelector('svg.stop-icon');
      if (stopIcon) {
        console.log('[OmniCoder] isGenerating: stop-icon 발견 → 생성 중');
        return true;
      }
      // SVG의 class에 stop이 포함된 경우도 체크
      const svgs = enterWrapper.querySelectorAll('svg');
      for (const svg of Array.from(svgs)) {
        const cls = svg.getAttribute('class') || '';
        if (cls.includes('stop')) {
          console.log('[OmniCoder] isGenerating: svg class에 stop 포함 → 생성 중');
          return true;
        }
      }
    }

    // 방법 2: stop-generation-btn
    const stopBtn = document.querySelector('.stop-generation-btn');
    if (stopBtn) {
      const style = window.getComputedStyle(stopBtn);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        console.log('[OmniCoder] isGenerating: stop-generation-btn 보임 → 생성 중');
        return true;
      }
    }

    return false;
  }

  // ─── 대화 추출 ──────────────────────────────────────────────
  function getLatestExchange(): {
    userMessage: string;
    claudeResponse: string;
    timestamp: number;
    messageCount: number;
  } | null {
    const userEls = $$(
      SELECTORS.userMessage as string,
      SELECTORS.userMessageFallbacks as string[]
    );
    const assistantEls = $$(
      SELECTORS.assistantMessage as string,
      SELECTORS.assistantMessageFallbacks as string[]
    );

    if (userEls.length === 0 || assistantEls.length === 0) return null;

    const lastUser = userEls[userEls.length - 1];
    const lastAssistant = assistantEls[assistantEls.length - 1];

    const userText = (lastUser.textContent || '').trim();
    let assistantText = (lastAssistant.textContent || '')
      .trim()
      .replace(/█/g, '')
      .replace(/▊/g, '')
      .replace(/▋/g, '')
      .replace(/\n?추가 작업\s*$/, '')
      .replace(/^Copy\n?/gm, '')
      .replace(/\nCopy$/gm, '')
      .replace(/Copy$/gm, '')
      .replace(/\s+$/, '')
      .trim();

    if (!userText || !assistantText) return null;

    const totalMessages = userEls.length + assistantEls.length;

    return {
      userMessage: userText,
      claudeResponse: assistantText,
      timestamp: Date.now(),
      messageCount: totalMessages,
    };
  }

  // ─── 메시지 전송 ───────────────────────────────────────────
  function sendDetection(exchange: {
    userMessage: string;
    claudeResponse: string;
    timestamp: number;
    messageCount: number;
  }): void {
    const key = exchange.claudeResponse.slice(0, 200);
    if (key === lastSentKey) {
      console.log('[OmniCoder] 중복 → 스킵');
      return;
    }
    lastSentKey = key;
    lastMessageCount = exchange.messageCount;

    console.log('[OmniCoder] 새 대화 감지:', {
      user: exchange.userMessage.slice(0, 60),
      assistant: exchange.claudeResponse.slice(0, 60),
      count: exchange.messageCount,
    });

    const text = document.getElementById('omnicoder-text');
    if (text) {
      text.textContent = '감지됨!';
      setTimeout(() => {
        const t = document.getElementById('omnicoder-text');
        if (t) t.textContent = 'OmniCoder 감시 중';
      }, 2000);
    }

    chrome.runtime.sendMessage(
      {
        type: 'NEW_CHAT_DETECTED',
        data: {
          userMessage: exchange.userMessage,
          claudeResponse: exchange.claudeResponse,
          timestamp: exchange.timestamp,
          messageCount: exchange.messageCount,
        },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[OmniCoder] sendMessage error:', chrome.runtime.lastError.message);
          return;
        }
        console.log('[OmniCoder] Background 응답:', response);
      }
    );
  }

  // ─── 폴링 (유일한 감지 경로) ───────────────────────────────
  function startPolling(): void {
    pollTimer = setInterval(() => {
      if (!isEnabled) return;

      // 1. 생성 중이면 무조건 대기
      if (isGenerating()) {
        stableCount = 0;
        stableText = '';
        return;
      }

      // 2. 대화 추출
      const exchange = getLatestExchange();
      if (!exchange) return;

      const resp = exchange.claudeResponse;

      // 3. 기본 필터
      if (!resp || resp.length < 30) return;
      if (resp.startsWith('Thinking') && resp.length < 50) return;

      // 4. 중복 체크 — 응답 내용(앞 200자)이 이미 전송한 것과 같으면 스킵
      const key = resp.slice(0, 200);
      if (key === lastSentKey) {
        return;
      }

      // 5. 안정성 체크: 텍스트가 3번 연속(9초) 같아야 완료
      if (resp === stableText) {
        stableCount++;
        console.log('[OmniCoder] 안정성 체크:', stableCount, '/3');
      } else {
        stableText = resp;
        stableCount = 1;
        console.log('[OmniCoder] 텍스트 변경 감지 → 안정성 리셋');
        return;
      }

      if (stableCount < 3) return;

      // 7. 마지막으로 한 번 더 isGenerating 체크
      if (isGenerating()) {
        stableCount = 0;
        return;
      }

      console.log('[OmniCoder] ✅ 안정성 확인 완료 (3회 연속 동일, 생성 버튼 없음) → 전송');

      // 8. 전송!
      sendDetection(exchange);

    }, 3000);
  }

  // ─── MONITOR_STATUS / SEND_TO_GENSPARK 수신 ─────────────────
  chrome.runtime.onMessage.addListener(
    (msg: { type: string; data?: unknown }) => {
      if (msg.type === 'MONITOR_STATUS') {
        const { isMonitoring } = msg.data as { isMonitoring: boolean };
        isEnabled = isMonitoring;
        const dot = document.getElementById('omnicoder-dot');
        const text = document.getElementById('omnicoder-text');
        if (dot) dot.style.background = isEnabled ? '#22c55e' : '#ef4444';
        if (text) text.textContent = isEnabled ? 'OmniCoder 감시 중' : 'OmniCoder 꺼짐';
      }

      if (msg.type === 'SEND_TO_GENSPARK') {
        const { message } = msg.data as { message: string };
        const textarea = document.querySelector('textarea.j-search-input') as HTMLTextAreaElement | null;
        if (!textarea) {
          console.error('[OmniCoder] 입력창 못 찾음');
          return;
        }

        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.set;
        if (nativeSetter) {
          nativeSetter.call(textarea, message);
        } else {
          textarea.value = message;
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
        textarea.focus();

        const badge = document.getElementById('omnicoder-text');
        if (badge) badge.textContent = '자동 전송 중...';

        setTimeout(() => {
          const sendBtn =
            document.querySelector('.enter-icon-wrapper') as HTMLElement ||
            document.querySelector('.search-icon-wrapper') as HTMLElement ||
            document.querySelector('button[type="submit"]') as HTMLElement ||
            document.querySelector('[class*="send-btn"]') as HTMLElement;

          if (sendBtn) {
            sendBtn.click();
            console.log('[OmniCoder] SEND_TO_GENSPARK: 전송 완료');
          } else {
            textarea.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true,
            }));
          }

          const b = document.getElementById('omnicoder-text');
          if (b) {
            b.textContent = '자동 전송 완료!';
            setTimeout(() => {
              const b2 = document.getElementById('omnicoder-text');
              if (b2) b2.textContent = 'OmniCoder 감시 중';
            }, 3000);
          }
        }, 800);
      }
    }
  );

  // ─── 셀렉터 오버라이드 로드 ─────────────────────────────────
  function loadSelectorOverrides(): void {
    try {
      chrome.storage.sync.get('omnicoder_settings', (result) => {
        const overrides = result?.omnicoder_settings?.selectorOverrides;
        if (overrides && typeof overrides === 'object') {
          for (const [key, value] of Object.entries(overrides)) {
            if (key in SELECTORS && typeof value === 'string') {
              (SELECTORS as Record<string, unknown>)[key] = value;
              console.log(`[OmniCoder] 셀렉터 오버라이드: ${key} = ${value}`);
            }
          }
        }
      });
    } catch (err) {
      console.warn('[OmniCoder] 셀렉터 오버라이드 로드 실패:', err);
    }
  }

  // ─── 초기화 ─────────────────────────────────────────────────
  function init(): void {
    if (initDone) return;
    console.log('[OmniCoder] Genspark 모니터 초기화 시작');

    const tryInit = setInterval(() => {
      const container = $(
        SELECTORS.chatContainer as string,
        SELECTORS.chatContainerFallbacks as string[]
      );

      if (!window.location.pathname.startsWith('/agents')) {
        clearInterval(tryInit);
        return;
      }

      if (container || document.querySelector('.chat-wrapper')) {
        clearInterval(tryInit);
        initDone = true;
        console.log('[OmniCoder] 채팅 컨테이너 발견');

        createBadge();
        loadSelectorOverrides();

        // 현재 메시지 수를 기록해서 "이미 있는 메시지"는 감지하지 않음
        const exchange = getLatestExchange();
        if (exchange) {
          lastMessageCount = exchange.messageCount;
          lastSentKey = exchange.claudeResponse.slice(0, 200) || '';
          console.log('[OmniCoder] 초기 lastSentKey 설정:', lastSentKey.slice(0, 50) + (lastSentKey.length > 50 ? '...' : ''));
          console.log('[OmniCoder] 기존 메시지 수:', lastMessageCount, '→ 이후 응답 내용 변경 시 감지');
        } else {
          lastMessageCount = 0;
        }

        // 폴링만 사용 (Observer는 제거 — 불필요한 조기 감지 방지)
        startPolling();

        console.log('[OmniCoder] 초기화 완료 (폴링 3초 간격, 안정성 3회=9초)');
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(tryInit);
      if (!initDone) {
        console.log('[OmniCoder] 30초 타임아웃 — 강제 시작');
        initDone = true;
        createBadge();
        loadSelectorOverrides();
        lastMessageCount = 0;
        startPolling();
      }
    }, 30000);
  }

  // SPA 네비게이션 대응
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[OmniCoder] URL 변경 감지:', lastUrl);

      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      // 리셋하지만 initDone도 리셋해서 새로 초기화
      stableText = '';
      stableCount = 0;
      initDone = false;

      if (lastUrl.includes('/agents')) {
        setTimeout(init, 2000);
      }
    }
  });
  urlObserver.observe(document.body, { childList: true, subtree: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
