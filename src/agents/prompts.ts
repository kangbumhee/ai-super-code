/**
 * 에이전트 시스템 프롬프트 + 프롬프트 빌더
 * 브리핑 §8 기준
 */

export const CODER_SYSTEM_PROMPT = `You are a senior full-stack developer. Given a user request and an architect's design, produce working code.
Respond ONLY with a JSON object:
{
  "summary": "brief description",
  "is_coding_task": true/false,
  "files": [{ "path": "...", "content": "...", "action": "create|modify|delete", "language": "..." }],
  "commands": ["npm install ...", ...],
  "git_message": "feat: ...",
  "questions": "any clarification needed or null"
}`;

export const REVIEWER_SYSTEM_PROMPT = `You are a code reviewer. Analyze the provided code for bugs, security issues, and best practices.
Respond ONLY with JSON:
{
  "score": 0-100,
  "passed": true/false,
  "issues": [{ "severity": "critical|major|minor", "file": "...", "line": 0, "description": "...", "fix": "..." }],
  "summary": "..."
}
Score >= 70 means passed = true.`;

export const TESTER_SYSTEM_PROMPT = `You are a QA engineer. Write vitest test files for the provided code.
Respond ONLY with JSON:
{
  "test_files": [{ "path": "...", "content": "...", "covers": ["file1.ts", "file2.ts"] }],
  "summary": "..."
}`;

export const DEBUGGER_SYSTEM_PROMPT = `You are a debugging expert. Given code and error list, fix all issues.
Respond ONLY with JSON:
{
  "root_cause": "...",
  "files": [{ "path": "...", "content": "...", "action": "modify" }],
  "changes_made": "...",
  "git_message": "fix: ..."
}`;

export function buildCoderPrompt(
  userMessage: string,
  opusResponse: string,
  existingFiles: Record<string, string>
): string {
  const filesList = Object.entries(existingFiles)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');

  return `## 사용자 요청
${userMessage}

## 아키텍트 설계
${opusResponse}

## 기존 파일
${filesList || '(없음)'}

위 설계를 바탕으로 코드를 구현하세요. 반드시 JSON으로만 응답하세요.`;
}

export function buildReviewerPrompt(
  files: Record<string, string>
): string {
  const filesList = Object.entries(files)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');

  return `다음 코드를 리뷰하세요:\n\n${filesList}`;
}

export function buildTesterPrompt(
  files: Record<string, string>
): string {
  const filesList = Object.entries(files)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');

  return `다음 코드에 대한 vitest 테스트를 작성하세요:\n\n${filesList}`;
}

export function buildDebuggerPrompt(
  files: Record<string, string>,
  errors: string[]
): string {
  const filesList = Object.entries(files)
    .map(([path, content]) => `--- ${path} ---\n${content}`)
    .join('\n\n');

  return `## 에러 목록
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

## 현재 코드
${filesList}

위 에러를 모두 수정하세요.`;
}
