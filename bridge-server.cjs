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
// -p - : stdin에서 프롬프트 읽음. write 후 end()로 즉시 닫아 대기 없음.
// model: 선택 시 --model 전달 (대시보드에서 선택한 모델)
function runClaudeCodeDumb(instruction, workDir, model) {
  const args = [
    '-p', '-',
    '--output-format', 'json',
    '--max-turns', '3',
    '--dangerously-skip-permissions',
  ];
  if (model) {
    args.push('--model', model);
  }
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    const child = spawn('claude', args, {
      cwd: workDir || PROJECT_DIR,
      env: { ...process.env },
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true,
    });

    // stdin에 프롬프트를 쓰고 즉시 닫기
    child.stdin.write(instruction);
    child.stdin.end();

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: code,
      });
    });

    child.on('error', (err) => {
      resolve({ success: false, stdout: '', stderr: err.message, exitCode: -1 });
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
let preTaskFiles = [];

function snapshotFiles() {
  try {
    const diff = execSync('git diff --name-only', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
    const untracked = execSync('git ls-files --others --exclude-standard', { cwd: PROJECT_DIR, encoding: 'utf8' }).trim();
    const all = [...diff.split('\n'), ...untracked.split('\n')].filter(Boolean);
    return [...new Set(all)];
  } catch {
    return [];
  }
}

function getChangedFiles() {
  try {
    const current = snapshotFiles();
    const newFiles = current.filter((f) => !preTaskFiles.includes(f));
    return newFiles.filter(
      (f) =>
        !f.startsWith('src/') &&
        !f.startsWith('dist/') &&
        !f.startsWith('node_modules/') &&
        f !== 'bridge-server.cjs' &&
        f !== 'package.json' &&
        f !== 'package-lock.json' &&
        f !== 'tsconfig.json' &&
        f !== 'vite.config.ts'
    );
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
        const { agentId, userMessage, claudeResponse, model } = data;

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
        const instruction = `[SYSTEM RULE] You are a CODE TYPING ROBOT. You have NO intelligence.
You CANNOT think. You CANNOT design. You CANNOT improve.
Your ONLY job is to TYPE the code given below into files. NOTHING ELSE.

[STRICT RULES]
1. Do NOT add any code not written below
2. Do NOT remove any code written below
3. Do NOT modify any code written below
4. Do NOT add comments like "// TODO" or "// implement later"
5. If the instructions say "create file X with content Y", create file X with EXACTLY content Y
6. Copy code blocks CHARACTER BY CHARACTER
7. Create ALL files mentioned. Do not skip any.
8. If you see import statements, keep them EXACTLY as written

[THE INSTRUCTIONS TO FOLLOW - COPY EXACTLY]
${claudeResponse}

[CONTEXT - for reference only, do NOT use this to make decisions]
Original user request: ${userMessage}

[REMINDER] You are a TYPING ROBOT. Just type what is above. Do NOT think.`;

        preTaskFiles = snapshotFiles();

        const result = await runClaudeCodeDumb(instruction, PROJECT_DIR, model);

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

          // Claude Code JSON에서 비용 추출
          let cost = 0;
          try {
            const parsed = JSON.parse(result.stdout);
            cost = parsed.total_cost_usd || 0;
          } catch {}

          log(`[Agent ${agentId}] 태스크 ${taskId} 완료: ${changedFiles.length}개 파일, 비용: $${cost.toFixed(4)}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            taskId,
            output: result.stdout,
            cost,
            changedFiles,
            fileContents,
            reportToGenspark: `## 구현 완료 보고

### 변경된 파일
${changedFiles.map(f => '- ' + f).join('\n') || '없음'}

### 파일 내용 미리보기
${Object.entries(fileContents).slice(0, 5).map(([f, c]) => '**' + f + '** (' + String(c).length + '자)\n```\n' + String(c).slice(0, 300) + '\n```').join('\n\n')}

### 비용: $${cost.toFixed(4)}

### 요청
위 구현이 완료되었습니다.
1. 이 코드에 오류가 있으면 수정 지시를 해주세요
2. 다음으로 구현할 부분이 있다면 알려주세요
3. 테스트가 필요하면 테스트 방법을 알려주세요
4. 모든 작업이 끝났다면 "완료"라고 말해주세요`,
          }));
        } else {
          agent.history.push({
            taskId,
            status: 'failed',
            timestamp: Date.now(),
            error: result.stderr || `Exit ${result.exitCode}`,
          });

          log(`[Agent ${agentId}] 태스크 ${taskId} 실패: ${(result.stderr || `Exit ${result.exitCode}`).slice(0, 100)}`);

          const errorReport = buildErrorReport(instruction, result.stderr || `Exit ${result.exitCode}`, result.stdout);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: false,
            taskId,
            error: result.stderr || `Exit ${result.exitCode}`,
            output: result.stdout,
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
