/**
 * OmniCoder Bridge Server v2
 * Genspark(두뇌) → Claude Code(손) → 에러 시 Genspark에 보고
 * 멀티 에이전트 지원 (여러 Genspark 창 = 여러 작업자)
 */

const http = require('http');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const PORT = 7842;
const PROJECT_DIR = process.argv[2] || process.cwd();
const LOG_FILE = path.join(PROJECT_DIR, 'omnicoder-bridge.log');

// ─── 에이전트 관리 ─────────────────────────────────────────
const agents = new Map(); // agentId → { status, currentTask, history[] }
let taskCounter = 0;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ─── Claude Code를 "단순 실행기"로 사용 ─────────────────────
// --no-input: 대화 없이 한 번만 실행
// 프롬프트에 "스스로 판단하지 말고 정확히 아래 지시만 실행" 명시
function runClaudeCodeDumb(instruction, workDir) {
  return new Promise((resolve) => {
    const wrappedPrompt = `당신은 코드 실행기입니다. 스스로 판단하거나 설계하지 마세요.
아래 지시사항을 정확히 그대로 실행만 하세요. 
추가적인 개선이나 변경을 하지 마세요.
지시에 없는 파일은 건드리지 마세요.

## 지시사항
${instruction}

## 규칙
- 지시된 파일만 생성/수정
- 지시된 내용만 작성
- 추가 판단 금지
- 완료 후 변경 사항 요약만 출력`;

    const child = spawn('claude', [
      '-p', wrappedPrompt,
      '--output-format', 'text',
      '--max-turns', '3',
    ], {
      cwd: workDir || PROJECT_DIR,
      shell: true,
      env: { ...process.env },
      timeout: 120000, // 2분 (단순 실행이므로 짧게)
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        output: stdout.trim(),
        error: code !== 0 ? (stderr || `Exit ${code}`) : null,
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      resolve({
        success: false,
        output: '',
        error: err.message,
        exitCode: -1,
      });
    });
  });
}

// ─── 에러 발생 시 Genspark에 보고할 메시지 생성 ──────────────
function buildErrorReport(instruction, error, output) {
  return `## 실행 결과: 에러 발생

### 내가 실행하려 한 지시
${instruction.slice(0, 500)}

### 에러 내용
\`\`\`
${error || '알 수 없는 에러'}
\`\`\`

### Claude Code 출력
\`\`\`
${(output || '').slice(0, 1000)}
\`\`\`

### 현재 프로젝트 상태
${getProjectSnapshot()}

이 에러를 분석하고, 수정할 정확한 지시사항을 알려주세요.
파일 경로, 수정할 내용, 순서를 구체적으로 알려주세요.`;
}

// ─── 프로젝트 스냅샷 ────────────────────────────────────────
function getProjectSnapshot() {
  try {
    const gitStatus = execSync('git status --short', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
    let files = '';
    try {
      files = execSync('find . -maxdepth 3 \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.json" \\) ! -path "*/node_modules/*" ! -path "*/dist/*" 2>/dev/null | head -30', {
        cwd: PROJECT_DIR,
        shell: true,
        encoding: 'utf8',
      }).trim();
    } catch {
      // Windows 등: Node로 파일 목록
      const ext = ['.ts', '.tsx', '.js', '.py', '.json'];
      const list = [];
      function walk(dir, depth) {
        if (depth > 3) return;
        try {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            const full = path.join(dir, e.name);
            const rel = path.relative(PROJECT_DIR, full).replace(/\\/g, '/');
            if (e.isDirectory()) {
              if (e.name !== 'node_modules' && e.name !== 'dist') walk(full, depth + 1);
            } else if (ext.some((x) => e.name.endsWith(x))) {
              list.push(rel);
              if (list.length >= 30) return;
            }
          }
        } catch (_) {}
      }
      walk(PROJECT_DIR, 0);
      files = list.join('\n');
    }
    return `Git 상태:\n${gitStatus || '(클린)'}\n\n파일 목록:\n${files}`;
  } catch {
    return '(프로젝트 상태를 읽을 수 없음)';
  }
}

// ─── 파일 읽기 ──────────────────────────────────────────────
function readFile(filePath) {
  const full = path.join(PROJECT_DIR, filePath);
  if (fs.existsSync(full)) {
    return fs.readFileSync(full, 'utf-8');
  }
  return null;
}

// ─── 변경 파일 ──────────────────────────────────────────────
function getChangedFiles() {
  try {
    const diff = execSync('git diff --name-only', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
    const all = [...diff.split('\n'), ...untracked.split('\n')].filter(Boolean);
    return [...new Set(all)];
  } catch {
    return [];
  }
}

// ─── HTTP 서버 ──────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', async () => {
    try {
      const url = req.url;

      // ── 상태 ──
      if (url === '/status') {
        const agentList = [];
        agents.forEach((v, k) => agentList.push({ id: k, ...v }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          directory: PROJECT_DIR,
          snapshot: getProjectSnapshot(),
          agents: agentList,
          totalTasks: taskCounter,
        }));
        return;
      }

      // ── Genspark 대화 → Claude Code 실행 (핵심) ──
      if (url === '/execute' && req.method === 'POST') {
        const data = JSON.parse(body);
        const { agentId, userMessage, claudeResponse } = data;

        taskCounter++;
        const taskId = `task-${taskCounter}`;

        // 에이전트 등록/업데이트
        if (!agents.has(agentId)) {
          agents.set(agentId, { status: 'idle', currentTask: null, history: [] });
        }
        const agent = agents.get(agentId);
        agent.status = 'executing';
        agent.currentTask = taskId;

        log(`[Agent ${agentId}] 태스크 ${taskId} 시작`);

        // Genspark 응답에서 "실행 지시"를 추출
        const instruction = claudeResponse;

        const result = await runClaudeCodeDumb(instruction, PROJECT_DIR);

        const changedFiles = getChangedFiles();
        const fileContents = {};
        for (const f of changedFiles) {
          const content = readFile(f);
          if (content !== null) fileContents[f] = content;
        }

        agent.status = 'idle';
        agent.currentTask = null;

        if (result.success) {
          agent.history.push({
            taskId,
            status: 'completed',
            timestamp: Date.now(),
            files: changedFiles,
          });

          log(`[Agent ${agentId}] 태스크 ${taskId} 완료: ${changedFiles.length}개 파일`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            taskId,
            output: result.output,
            changedFiles,
            fileContents,
            reportToGenspark: `## 실행 완료\n변경된 파일: ${changedFiles.join(', ') || '없음'}\n\n출력:\n${result.output.slice(0, 500)}`,
          }));
        } else {
          agent.history.push({
            taskId,
            status: 'failed',
            timestamp: Date.now(),
            error: result.error,
          });

          log(`[Agent ${agentId}] 태스크 ${taskId} 실패: ${result.error?.slice(0, 100)}`);

          const errorReport = buildErrorReport(instruction, result.error, result.output);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            taskId,
            error: result.error,
            output: result.output,
            reportToGenspark: errorReport,
            changedFiles: getChangedFiles(),
          }));
        }
        return;
      }

      // ── 에이전트 등록 ──
      if (url === '/agent/register' && req.method === 'POST') {
        const { agentId, role } = JSON.parse(body);
        agents.set(agentId, {
          status: 'idle',
          role: role || 'coder',
          currentTask: null,
          history: [],
        });
        log(`[Agent ${agentId}] 등록 (역할: ${role || 'coder'})`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, agentId }));
        return;
      }

      // ── 에이전트 목록 ──
      if (url === '/agents') {
        const list = [];
        agents.forEach((v, k) => list.push({ id: k, ...v }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, agents: list }));
        return;
      }

      // ── 파일 조회 ──
      if (url?.startsWith('/file/')) {
        const filePath = decodeURIComponent(url.slice(6));
        const content = readFile(filePath);
        if (content !== null) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, path: filePath, content }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Not found' }));
        }
        return;
      }

      // ── 프로젝트 파일 목록 ──
      if (url === '/files') {
        const changed = getChangedFiles();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, files: changed }));
        return;
      }

      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
      log(`[Error] ${err.message}`);
      res.writeHead(500);
      res.end(JSON.stringify({ success: false, error: err.message }));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  log('═══════════════════════════════════════════════');
  log(`  OmniCoder Bridge v2 — Genspark 두뇌 모드`);
  log(`  프로젝트: ${PROJECT_DIR}`);
  log(`  서버: http://127.0.0.1:${PORT}`);
  log('═══════════════════════════════════════════════');
  log('');
  log('  Genspark(무료 두뇌) → Claude Code(단순 실행기)');
  log('  에러 발생 시 → Genspark에 보고 → 재지시');
  log('');
  log('  엔드포인트:');
  log('    POST /execute     — Genspark 지시 → Claude Code 실행');
  log('    POST /agent/register — 에이전트(Genspark 창) 등록');
  log('    GET  /agents      — 에이전트 목록');
  log('    GET  /status      — 프로젝트 상태');
  log('    GET  /files       — 변경 파일');
  log('    GET  /file/:path  — 파일 내용');
  log('');
});
