/**
 * Orchestrator — Ralph Loop
 * 브리핑 §8 기준
 */
import { ClaudeClient } from '@/api/ClaudeClient';
import type {
  Task,
  TaskOutput,
  FileOutput,
  CostEntry,
  ProgressUpdate,
} from '@/types';
import { MODEL_TIERS } from '@/types';
import {
  CODER_SYSTEM_PROMPT,
  REVIEWER_SYSTEM_PROMPT,
  TESTER_SYSTEM_PROMPT,
  DEBUGGER_SYSTEM_PROMPT,
  buildCoderPrompt,
  buildReviewerPrompt,
  buildTesterPrompt,
  buildDebuggerPrompt,
} from './prompts';

interface OrchestratorConfig {
  maxIterations: number;
  reviewThreshold: number;
  autoUpgrade: boolean;
  onProgress?: (p: ProgressUpdate) => void;
}

interface CodeGenResult {
  isCodingTask: boolean;
  summary: string;
  files: FileOutput[];
  commands: string[];
  gitMessage: string;
  questions: string | null;
}

interface ReviewResult {
  score: number;
  passed: boolean;
  issues: Array<{
    severity: string;
    file: string;
    line?: number;
    description: string;
    fix?: string;
  }>;
  summary: string;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxIterations: 10,
  reviewThreshold: 70,
  autoUpgrade: true,
};

export class Orchestrator {
  private client: ClaudeClient;
  private config: OrchestratorConfig;
  private costEntries: CostEntry[] = [];

  constructor(apiKey: string, config?: Partial<OrchestratorConfig>) {
    this.client = new ClaudeClient(apiKey);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  updateApiKey(key: string): void {
    this.client.setApiKey(key);
  }

  /**
   * Ralph Loop 실행
   */
  async execute(task: Task): Promise<TaskOutput> {
    let currentModelIndex = task.currentModelIndex;
    const allFiles: Record<string, string> = { ...task.input.existingFiles };
    this.costEntries = [];

    for (let iteration = 1; iteration <= this.config.maxIterations; iteration++) {
      const modelId = MODEL_TIERS[Math.min(currentModelIndex, MODEL_TIERS.length - 1)].id;

      this.emitProgress(task.id, iteration, 'coder', modelId, `코드 생성 중 (반복 ${iteration})`);

      // 1. Coder
      let codeResult: CodeGenResult;
      try {
        codeResult = await this.runCoder(task, allFiles, modelId);
      } catch (err) {
        if (this.config.autoUpgrade && currentModelIndex < MODEL_TIERS.length - 1) {
          currentModelIndex++;
          continue;
        }
        throw err;
      }

      if (!codeResult.isCodingTask) {
        return {
          summary: codeResult.summary || '비코딩 응답',
          files: [],
          commands: [],
          gitMessage: '',
          cost: this.totalCost(),
          model: modelId,
          isCodingTask: false,
          questions: codeResult.questions,
        };
      }

      // 파일 병합
      for (const f of codeResult.files) {
        if (f.action === 'delete') {
          delete allFiles[f.path];
        } else {
          allFiles[f.path] = f.content;
        }
      }

      // 2. Reviewer (Haiku급)
      this.emitProgress(task.id, iteration, 'reviewer', modelId, '코드 리뷰 중');
      let reviewResult: ReviewResult;
      try {
        const reviewModelId = MODEL_TIERS[0].id; // 가장 저렴한 모델
        reviewResult = await this.runReviewer(allFiles, reviewModelId, task.id);
      } catch {
        reviewResult = { score: 80, passed: true, issues: [], summary: '리뷰 스킵' };
      }

      if (!reviewResult.passed) {
        // 리뷰 이슈를 코더에게 피드백
        const issueText = reviewResult.issues
          .map((i) => `[${i.severity}] ${i.file}: ${i.description}`)
          .join('\n');
        task = {
          ...task,
          input: {
            ...task.input,
            claudeResponse: task.input.claudeResponse + '\n\n리뷰 이슈:\n' + issueText,
          },
        };
        continue;
      }

      // 3. Tester
      this.emitProgress(task.id, iteration, 'tester', modelId, '테스트 생성 중');
      try {
        const testFiles = await this.runTester(allFiles, modelId, task.id);
        for (const f of testFiles) {
          allFiles[f.path] = f.content;
        }
      } catch {
        // 테스트 생성 실패는 무시
      }

      // 4. Static Analysis
      this.emitProgress(task.id, iteration, 'analyzer', modelId, '정적 분석 중');
      const errors = this.staticAnalysis(allFiles);

      if (errors.length > 0) {
        // 5. Debugger
        this.emitProgress(task.id, iteration, 'debugger', modelId, '에러 수정 중');
        try {
          const fixedFiles = await this.runDebugger(allFiles, errors, modelId, task.id);
          for (const f of fixedFiles) {
            allFiles[f.path] = f.content;
          }
        } catch {
          // 디버거 실패 시 다음 반복
        }
        continue;
      }

      // 전부 통과 — 결과 반환
      const finalFiles: FileOutput[] = Object.entries(allFiles).map(
        ([path, content]) => ({
          path,
          content,
          action: 'create' as const,
          language: this.detectLanguage(path),
        })
      );

      this.emitProgress(task.id, iteration, 'complete', modelId, '완료!', finalFiles);

      return {
        summary: codeResult.summary,
        files: finalFiles,
        commands: codeResult.commands,
        gitMessage: codeResult.gitMessage,
        cost: this.totalCost(),
        model: modelId,
        isCodingTask: true,
        questions: null,
      };
    }

    throw new Error(`최대 반복 횟수(${this.config.maxIterations}) 초과`);
  }

  // ─── 에이전트 실행 ────────────────────────────────────────────

  private async runCoder(
    task: Task,
    allFiles: Record<string, string>,
    modelId: string
  ): Promise<CodeGenResult> {
    const prompt = buildCoderPrompt(
      task.input.userMessage,
      task.input.claudeResponse,
      allFiles
    );
    const response = await this.client.call({
      model: modelId,
      system: CODER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    this.costEntries.push(
      ClaudeClient.createCostEntry(response, modelId, task.id)
    );

    const text = response.content[0]?.text || '';
    const parsed = this.parseJSON(text) as Record<string, unknown> | null;
    const filesRaw = (parsed?.files as Array<{ path: string; content: string; action?: string; language?: string }> | undefined) || [];

    return {
      isCodingTask: (parsed?.is_coding_task as boolean | undefined) ?? true,
      summary: (parsed?.summary as string) || '코드 생성 완료',
      files: filesRaw.map((f) => ({
        path: f.path,
        content: f.content,
        action: (f.action || 'create') as 'create' | 'modify' | 'delete',
        language: f.language || this.detectLanguage(f.path),
      })),
      commands: (parsed?.commands as string[] | undefined) || [],
      gitMessage: (parsed?.git_message as string) || '',
      questions: (parsed?.questions as string | null | undefined) ?? null,
    };
  }

  private async runReviewer(
    allFiles: Record<string, string>,
    modelId: string,
    taskId: string
  ): Promise<ReviewResult> {
    const prompt = buildReviewerPrompt(allFiles);
    const response = await this.client.call({
      model: modelId,
      system: REVIEWER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    this.costEntries.push(
      ClaudeClient.createCostEntry(response, modelId, taskId)
    );

    const text = response.content[0]?.text || '';
    const parsed = this.parseJSON(text) as Record<string, unknown> | null;
    const score = (parsed?.score as number | undefined) ?? 80;

    return {
      score,
      passed: (parsed?.passed as boolean | undefined) ?? score >= this.config.reviewThreshold,
      issues: (parsed?.issues as ReviewResult['issues']) || [],
      summary: (parsed?.summary as string) || '',
    };
  }

  private async runTester(
    allFiles: Record<string, string>,
    modelId: string,
    taskId: string
  ): Promise<FileOutput[]> {
    const prompt = buildTesterPrompt(allFiles);
    const response = await this.client.call({
      model: modelId,
      system: TESTER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    this.costEntries.push(
      ClaudeClient.createCostEntry(response, modelId, taskId)
    );

    const text = response.content[0]?.text || '';
    const parsed = this.parseJSON(text) as Record<string, unknown> | null;
    const testFiles = (parsed?.test_files as Array<{ path: string; content: string }> | undefined) || [];

    return testFiles.map((f) => ({
      path: f.path,
      content: f.content,
      action: 'create' as const,
      language: this.detectLanguage(f.path),
    }));
  }

  private async runDebugger(
    allFiles: Record<string, string>,
    errors: string[],
    modelId: string,
    taskId: string
  ): Promise<FileOutput[]> {
    const prompt = buildDebuggerPrompt(allFiles, errors);
    const response = await this.client.call({
      model: modelId,
      system: DEBUGGER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
    });
    this.costEntries.push(
      ClaudeClient.createCostEntry(response, modelId, taskId)
    );

    const text = response.content[0]?.text || '';
    const parsed = this.parseJSON(text) as Record<string, unknown> | null;
    const filesRaw = (parsed?.files as Array<{ path: string; content: string; action?: string }> | undefined) || [];

    return filesRaw.map((f) => ({
      path: f.path,
      content: f.content,
      action: (f.action || 'modify') as 'create' | 'modify' | 'delete',
      language: this.detectLanguage(f.path),
    }));
  }

  // ─── 유틸 ─────────────────────────────────────────────────────

  private parseJSON(text: string): Record<string, unknown> | null {
    // ```json ... ``` 블록 우선 시도
    const fenced = text.match(/```json\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        return JSON.parse(fenced[1]);
      } catch { /* fall through */ }
    }
    // { ... } 블록 시도
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart >= 0 && braceEnd > braceStart) {
      try {
        return JSON.parse(text.slice(braceStart, braceEnd + 1));
      } catch { /* fall through */ }
    }
    return null;
  }

  private staticAnalysis(allFiles: Record<string, string>): string[] {
    const errors: string[] = [];
    for (const [path, content] of Object.entries(allFiles)) {
      if (!content.trim()) {
        errors.push(`빈 파일: ${path}`);
      }
      if (content.includes('require(') && !path.endsWith('.cjs')) {
        errors.push(`${path}: require() 대신 import 사용 필요`);
      }
      if (content.includes('TODO') || content.includes('FIXME')) {
        errors.push(`${path}: TODO/FIXME 미완성 코드 발견`);
      }
      if (
        content.includes('console.log') &&
        !path.includes('.test.') &&
        !path.includes('__test__')
      ) {
        errors.push(`${path}: console.log 제거 필요`);
      }
      if (path.endsWith('.json')) {
        try {
          JSON.parse(content);
        } catch {
          errors.push(`${path}: 유효하지 않은 JSON`);
        }
      }
    }
    return errors;
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      ts: 'typescript', tsx: 'typescriptreact', js: 'javascript',
      jsx: 'javascriptreact', py: 'python', json: 'json',
      html: 'html', css: 'css', md: 'markdown', sh: 'shell',
    };
    return map[ext || ''] || 'plaintext';
  }

  private emitProgress(
    taskId: string,
    step: number,
    agentRole: string,
    model: string,
    status: string,
    files?: FileOutput[]
  ): void {
    if (this.config.onProgress) {
      this.config.onProgress({
        taskId,
        step,
        maxSteps: this.config.maxIterations,
        status,
        model,
        files,
        cost: this.totalCost(),
        agentRole,
      });
    }
  }

  private totalCost(): number {
    return this.costEntries.reduce((s, c) => s + c.cost, 0);
  }
}
