/**
 * DOM 셀렉터 파인더
 * claude.ai 콘솔(F12)에서 실행하는 디버그 도구
 *
 * 사용법: 이 파일 내용을 콘솔에 붙여넣기
 */
export function runSelectorFinder(): void {
  const tests = [
    { name: '사용자 메시지', sel: '[data-testid="user-message"]' },
    { name: '사용자 메시지 (alt)', sel: '.font-user-message' },
    { name: 'Claude 메시지', sel: '[data-testid="assistant-message"]' },
    { name: 'Claude 메시지 (alt)', sel: '.font-claude-message' },
    { name: 'Claude 메시지 (alt2)', sel: '.prose' },
    { name: '메시지 그룹', sel: '[data-testid="chat-message"]' },
    { name: '메시지 그룹 (alt)', sel: '.group' },
    { name: '전송 버튼', sel: 'button[aria-label="Send Message"]' },
    { name: '전송 버튼 (alt)', sel: 'button[type="submit"]' },
    { name: '전송 버튼 (alt2)', sel: 'fieldset button' },
    { name: '정지 버튼', sel: 'button[aria-label="Stop Response"]' },
    { name: '정지 버튼 (alt)', sel: 'button[aria-label="Stop"]' },
    { name: '복사 버튼', sel: 'button[data-testid="action-bar-copy"]' },
    { name: '복사 버튼 (alt)', sel: 'button[aria-label="Copy"]' },
    { name: '편집 버튼', sel: 'button[aria-label="Edit"]' },
    { name: '입력창', sel: '[contenteditable="true"]' },
    { name: '입력창 (alt)', sel: 'div[role="textbox"]' },
    { name: '입력창 (alt2)', sel: 'textarea' },
    { name: '채팅 컨테이너', sel: '[data-testid="chat-messages"]' },
    { name: '채팅 컨테이너 (alt)', sel: 'main' },
    { name: '스크롤 영역', sel: '.overflow-y-auto' },
    { name: '대화 제목', sel: '[data-testid="chat-title-button"]' },
  ];

  console.log('%c🔍 OmniCoder Selector Finder', 'font-size:16px;font-weight:bold;color:#818cf8');
  console.log('');

  const working: string[] = [];
  const broken: string[] = [];

  for (const { name, sel } of tests) {
    const els = document.querySelectorAll(sel);
    const count = els.length;
    const sample = els[0]?.textContent?.substring(0, 50)?.trim() || '-';

    if (count > 0) {
      console.log(`%c✅ ${name}%c  "${sel}"  (${count}개)  샘플: ${sample}`,
        'color:#4ade80;font-weight:bold', 'color:#9ca3af');
      working.push(`${name}: "${sel}"`);
    } else {
      console.log(`%c❌ ${name}%c  "${sel}"`,
        'color:#f87171;font-weight:bold', 'color:#6b7280');
      broken.push(`${name}: "${sel}"`);
    }
  }

  console.log('\n%c📋 요약', 'font-size:14px;font-weight:bold;color:#fbbf24');
  console.log(`  작동: ${working.length}개 / 미작동: ${broken.length}개`);
  console.log('\n작동하는 셀렉터:');
  working.forEach(w => console.log(`  ${w}`));

  if (broken.length > 0) {
    console.log('\n미작동 셀렉터 (대체 셀렉터 사용됨):');
    broken.forEach(b => console.log(`  ${b}`));
  }

  // 전역 저장
  (window as unknown as { __omnicoder_selectors?: { working: string[]; broken: string[] } }).__omnicoder_selectors = { working, broken };
  console.log('\n💡 window.__omnicoder_selectors 에 결과 저장됨');
}

// 직접 실행 시 (스크립트 주입 시)
if (typeof window !== 'undefined' && !(window as unknown as { __omnicoder_loaded?: boolean }).__omnicoder_loaded) {
  (window as unknown as { __omnicoder_loaded: boolean }).__omnicoder_loaded = true;
  runSelectorFinder();
}
