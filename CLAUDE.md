# OmniCoder v2.0 — 완전 자동화 AI 코딩 크롬 확장프로그램

## 프로젝트 개요
Claude 채팅(무료 Opus)의 두뇌를 스크래핑하고, 저렴한 API(Haiku→Sonnet 자동 전환)로
코드를 생성하는 크롬 확장프로그램. 24시간 자율 동작.

## 핵심 원칙
- IMPORTANT: 모든 코드는 TypeScript로 작성
- IMPORTANT: Manifest V3 규격 준수
- IMPORTANT: 모든 함수에 JSDoc 주석 필수
- IMPORTANT: 모든 기능에 대해 테스트 코드 작성 (vitest)
- IMPORTANT: 에러 핸들링을 빈틈없이 - try/catch + 사용자 알림
- IMPORTANT: chrome.alarms API로 서비스워커 영구 유지
- 코드 스타일: ES modules, async/await, strict TypeScript

## 빌드 시스템
- Vite + CRXJS (크롬 확장 빌드)
- TypeScript strict mode
- Vitest (테스트)
- ESLint + Prettier

## 테스트 명령어
- `npm run test` — 전체 테스트
- `npm run build` — 프로덕션 빌드
- `npm run lint` — 린트 검사
- `npm run typecheck` — 타입 체크

## 아키텍처
- background/ : 서비스워커 (핵심 엔진)
- content/ : claude.ai DOM 감시
- dashboard/ : React 대시보드 UI
- api/ : Claude API 클라이언트
- queue/ : 태스크 큐 시스템
- agents/ : 멀티 에이전트 오케스트레이터
- storage/ : 영속 저장소
- utils/ : 유틸리티

## Git 커밋 규칙
- feat: 새 기능
- fix: 버그 수정
- test: 테스트 추가
- refactor: 리팩토링
- docs: 문서
