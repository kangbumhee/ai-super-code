/**
 * OmniCoder v2.0 — Genspark AI 대화 감시 Content Script
 * https://www.genspark.ai/agents* 에서 동작
 */
(() => {
  'use strict';

  // ─── 셀렉터 ─────────────────────────────────────────────────
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

  let lastMessageCount = 0;
  let isResponseInProgress = false;
  let pendingDetection = false;
  let isEnabled = true;
  let observer: MutationObserver | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let lastSentText = '';

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

      // 드래그
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

      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
    }
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
    const assistantText = (lastAssistant.textContent || '')
      .trim()
      .replace(/\n?추가 작업\s*$/, '')
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

  // ─── 응답 완료 감지 ─────────────────────────────────────────
  function isStopButtonVisible(): boolean {
    const stop = $(SELECTORS.stopButton as string);
    if (!stop) return false;
    const style = window.getComputedStyle(stop);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function isResponseComplete(): boolean {
    if (isStopButtonVisible()) return false;
    const assistants = document.querySelectorAll(
      SELECTORS.assistantMessage as string
    );
    if (assistants.length === 0) return false;
    const last = assistants[assistants.length - 1];
    const lastText = last.textContent?.trim() || '';
    if (lastText.startsWith('Thinking') && lastText.length < 30) return false;
    if (lastText === '') return false;
    // 스트리밍 중 cursor 감지
    if (last.querySelector('.cursor, [class*="cursor"]')) return false;
    return true;
  }

  // ─── 새 메시지 감지 핸들러 ──────────────────────────────────
  function onNewMessageDetected(): void {
    if (!isEnabled) return;

    const exchange = getLatestExchange();
    if (!exchange) return;

    const currentCount = exchange.messageCount;
    if (currentCount <= lastMessageCount) return;

    // Thinking 상태면 3초 후 다시 시도
    const resp = exchange.claudeResponse.trim();
    if (!resp || (resp.startsWith('Thinking') && resp.length < 30)) {
      setTimeout(() => onNewMessageDetected(), 3000);
      return;
    }

    if (!isResponseComplete()) {
      setTimeout(() => onNewMessageDetected(), 3000);
      return;
    }

    // 중복 방지
    const key = `${currentCount}:${resp.slice(0, 100)}`;
    if (key === lastSentText) return;
    lastSentText = key;
    lastMessageCount = currentCount;

    console.log('[OmniCoder] 새 대화 감지:', {
      user: exchange.userMessage.slice(0, 60),
      assistant: exchange.claudeResponse.slice(0, 60),
      count: currentCount,
    });

    const text = document.getElementById('omnicoder-text');
    if (text) {
      text.textContent = '감지됨!';
      setTimeout(() => {
        if (text) text.textContent = 'OmniCoder 감시 중';
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

  // ─── MutationObserver ───────────────────────────────────────
  let completeCheckTimer: ReturnType<typeof setTimeout> | null = null;

  function checkResponseComplete(): void {
    if (completeCheckTimer) clearTimeout(completeCheckTimer);

    completeCheckTimer = setTimeout(() => {
      if (isResponseComplete() || !isStopButtonVisible()) {
        isResponseInProgress = false;
        if (pendingDetection) {
          pendingDetection = false;
          onNewMessageDetected();
        }
      } else {
        checkResponseComplete();
      }
    }, 1500);
  }

  function startObserver(): void {
    const container = $(
      SELECTORS.chatContainer as string,
      SELECTORS.chatContainerFallbacks as string[]
    );

    const target = container || document.querySelector('main') || document.body;

    observer = new MutationObserver((mutations) => {
      if (!isEnabled) return;

      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (!(node instanceof HTMLElement)) continue;

            if (
              node.classList?.contains('conversation-statement') ||
              node.querySelector?.('.conversation-statement')
            ) {
              if (
                node.classList?.contains('assistant') ||
                node.querySelector?.('.conversation-statement.assistant')
              ) {
                isResponseInProgress = true;
                pendingDetection = true;
              }
            }
          }
        }

        if (mutation.type === 'characterData' || mutation.type === 'childList') {
          if (isResponseInProgress && pendingDetection) {
            checkResponseComplete();
          }
        }
      }
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log('[OmniCoder] Observer 시작, 타겟:', target.className || target.tagName);
  }

  // ─── 폴링 (응답 내용 변화 감지) ───────────────────────────────
  let lastAssistantText = '';

  function startPolling(): void {
    pollTimer = setInterval(() => {
      if (!isEnabled) return;

      const exchange = getLatestExchange();
      if (!exchange) return;

      const resp = exchange.claudeResponse.trim();

      // 응답이 완료되고 이전과 다르면 감지
      if (
        resp &&
        resp !== lastAssistantText &&
        !(resp.startsWith('Thinking') && resp.length < 30) &&
        resp.length > 10 &&
        isResponseComplete()
      ) {
        const key = `${exchange.messageCount}:${resp.slice(0, 100)}`;
        if (key === lastSentText) return;
        lastSentText = key;
        lastAssistantText = resp;
        if (exchange.messageCount >= lastMessageCount) {
          lastMessageCount = exchange.messageCount;

          console.log('[OmniCoder] 새 대화 감지 (폴링):', {
            user: exchange.userMessage.slice(0, 60),
            assistant: resp.slice(0, 60),
            count: exchange.messageCount,
          });

          const text = document.getElementById('omnicoder-text');
          if (text) {
            text.textContent = '감지됨!';
            setTimeout(() => {
              if (text) text.textContent = 'OmniCoder 감시 중';
            }, 2000);
          }

          chrome.runtime.sendMessage(
            {
              type: 'NEW_CHAT_DETECTED',
              data: {
                userMessage: exchange.userMessage,
                claudeResponse: resp,
                timestamp: exchange.timestamp,
                messageCount: exchange.messageCount,
              },
            },
            (response) => {
              if (chrome.runtime.lastError) {
                console.warn('[OmniCoder] sendMessage error:', chrome.runtime.lastError.message);
              } else {
                console.log('[OmniCoder] Background 응답:', response);
              }
            }
          );
        }
      }
    }, 3000);
  }

  // ─── MONITOR_STATUS 수신 ───────────────────────────────────
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

      // Genspark에 메시지 자동 입력 + 전송 (background에서 요청)
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

  // ─── Genspark 자동 로그인 (쿠키 기반) ───────────────────────
  function attemptGensparkLogin(): void {
    setTimeout(() => {
      try {
        chrome.storage.sync.get('omnicoder_settings', (result) => {
          const cookiesStr = result?.omnicoder_settings?.gensparkCookies;
          if (!cookiesStr) return;

          const loginIndicators = document.querySelectorAll(
            '[class*="avatar"], [class*="profile"], [class*="user-info"], [class*="account"]'
          );
          if (loginIndicators.length > 0) {
            console.log('[OmniCoder] Genspark 이미 로그인됨');
            return;
          }

          try {
            const cookies = JSON.parse(cookiesStr);
            if (Array.isArray(cookies) && cookies.length > 0) {
              chrome.runtime.sendMessage(
                { type: 'GENSPARK_LOGIN', data: { cookies } },
                (response) => {
                  if (response?.success) {
                    console.log('[OmniCoder] Genspark 쿠키 설정 완료');
                    setTimeout(() => location.reload(), 1500);
                  }
                }
              );
            }
          } catch (e) {
            console.warn('[OmniCoder] 쿠키 파싱 실패:', e);
          }
        });
      } catch (err) {
        console.warn('[OmniCoder] 로그인 시도 실패:', err);
      }
    }, 2000);
  }

  // ─── 초기화 ─────────────────────────────────────────────────
  function init(): void {
    console.log('[OmniCoder] Genspark 모니터 초기화 시작');

    const tryInit = setInterval(() => {
      const container = $(
        SELECTORS.chatContainer as string,
        SELECTORS.chatContainerFallbacks as string[]
      );

      if (!window.location.pathname.startsWith('/agents')) {
        clearInterval(tryInit);
        attemptGensparkLogin();
        return;
      }

      if (container || document.querySelector('.chat-wrapper')) {
        clearInterval(tryInit);
        console.log('[OmniCoder] 채팅 컨테이너 발견');

        createBadge();
        loadSelectorOverrides();
        startObserver();
        startPolling();
        attemptGensparkLogin();

        const exchange = getLatestExchange();
        if (exchange) {
          lastMessageCount = 0; // 0으로 설정해서 폴링 첫 회차에 바로 감지 가능
          lastAssistantText = '';
          console.log('[OmniCoder] 초기화 완료 (폴링 대기)');
        }
      }
    }, 1000);

    setTimeout(() => {
      clearInterval(tryInit);
      if (!observer) {
        console.log('[OmniCoder] 30초 타임아웃 — 강제 시작');
        createBadge();
        loadSelectorOverrides();
        startObserver();
        startPolling();
        attemptGensparkLogin();
      }
    }, 30000);
  }

  // SPA 네비게이션 대응
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      console.log('[OmniCoder] URL 변경 감지:', lastUrl);

      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      lastMessageCount = 0;
      isResponseInProgress = false;
      pendingDetection = false;
      lastSentText = '';

      if (lastUrl.includes('/agents')) {
        setTimeout(init, 1000);
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
