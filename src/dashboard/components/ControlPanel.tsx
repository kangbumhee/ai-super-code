import * as React from 'react';
import { useDashboardStore } from '../store';
import { MODEL_TIERS } from '@/types';

function AgentStatus({ bridgeUrl }: { bridgeUrl: string }) {
  const [agents, setAgents] = React.useState<Array<{
    id: string;
    status: string;
    role?: string;
    currentTask?: string;
    history?: Array<{ taskId: string; status: string; timestamp: number }>;
  }>>([]);

  React.useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch(`${bridgeUrl}/agents`);
        const data = await res.json();
        if (data.success) setAgents(data.agents || []);
      } catch {
        // 브릿지 꺼져있으면 무시
      }
    };
    fetchAgents();
    const interval = setInterval(fetchAgents, 3000);
    return () => clearInterval(interval);
  }, [bridgeUrl]);

  if (agents.length === 0) {
    return <p className="text-sm text-gray-500">활성 에이전트 없음 — Genspark에서 대화를 시작하세요</p>;
  }

  return (
    <div className="space-y-2">
      {agents.map((a) => (
        <div key={a.id} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
          <span className={`w-2.5 h-2.5 rounded-full ${
            a.status === 'executing' ? 'bg-yellow-500 animate-pulse' : 'bg-green-500'
          }`} />
          <div className="flex-1 min-w-0">
            <span className="text-sm font-mono">{a.id}</span>
            {a.role && <span className="text-xs text-gray-500 ml-2">({a.role})</span>}
          </div>
          <span className="text-xs text-gray-400">
            {a.status === 'executing' ? '실행 중' : '대기'}
          </span>
          <span className="text-xs text-gray-500">
            {a.history?.length || 0}건 완료
          </span>
        </div>
      ))}
    </div>
  );
}

export default function ControlPanel() {
  const {
    state,
    progress,
    settings,
    toggleMonitor,
    setAutoMode,
    setModel,
    loadAllData,
    clearData,
    testApi,
    exportData
  } = useDashboardStore();

  if (!state) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        연결 중...
      </div>
    );
  }

  const handleExport = async () => {
    const data = await exportData();
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnicoder-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const progressPercent = progress
    ? Math.round((progress.step / progress.maxSteps) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={toggleMonitor}
          className={`p-6 rounded-xl text-center transition-all ${
            state.isMonitoring
              ? 'bg-green-900/40 border border-green-700 hover:bg-green-900/60'
              : 'bg-gray-800 border border-gray-700 hover:bg-gray-700'
          }`}
        >
          <div className="text-3xl mb-2">{state.isMonitoring ? '🟢' : '⏸️'}</div>
          <div className="font-bold text-lg">
            {state.isMonitoring ? '감시 중' : '감시 꺼짐'}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            클릭하여 {state.isMonitoring ? '중지' : '시작'}
          </div>
        </button>

        <button
          onClick={() => setAutoMode(!(state.executionMode === 'full_auto'))}
          className={`p-6 rounded-xl text-center transition-all ${
            state.executionMode === 'full_auto'
              ? 'bg-blue-900/40 border border-blue-700 hover:bg-blue-900/60'
              : 'bg-gray-800 border border-gray-700 hover:bg-gray-700'
          }`}
        >
          <div className="text-3xl mb-2">{state.executionMode === 'full_auto' ? '🤖' : '👆'}</div>
          <div className="font-bold text-lg">
            {state.executionMode === 'full_auto' ? '자동 실행' : '수동 승인'}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {state.executionMode === 'full_auto' ? '대화 감지 즉시 실행' : '매번 승인 필요'}
          </div>
        </button>
      </div>

      <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
        <h3 className="font-bold mb-3">AI 모델 선택</h3>
        <div className="grid grid-cols-2 gap-2">
          {MODEL_TIERS.map((tier, idx) => (
            <button
              key={tier.id}
              onClick={() => setModel(idx)}
              className={`p-3 rounded-lg text-left transition-all ${
                state.currentModelIndex === idx
                  ? 'bg-accent-900/40 border-2 border-accent-500'
                  : 'bg-gray-800 border border-gray-700 hover:border-gray-600'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="font-bold text-sm">{tier.name}</span>
                {idx === 0 && (
                  <span className="text-[10px] bg-green-800 text-green-200 px-1.5 py-0.5 rounded">최저가</span>
                )}
                {idx === 2 && (
                  <span className="text-[10px] bg-blue-800 text-blue-200 px-1.5 py-0.5 rounded">추천</span>
                )}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                ${tier.inputPer1M} / ${tier.outputPer1M} per M tokens
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="대기" value={state.tasksQueued ?? 0} color="yellow" />
        <StatCard label="완료" value={state.tasksCompleted ?? 0} color="green" />
        <StatCard label="실패" value={state.tasksFailed ?? 0} color="red" />
        <StatCard label="오늘 비용" value={`₩${Math.round((state.todayCost ?? 0) * 1450).toLocaleString()}`} color="blue" />
      </div>

      {state && settings.useBridge && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800">
          <h3 className="font-bold mb-3">Genspark 에이전트 (멀티 창)</h3>
          <p className="text-xs text-gray-400 mb-3">
            Genspark 탭을 여러 개 열면 각각이 독립 에이전트로 동작합니다.
            각 탭에서 다른 모듈을 동시에 작업할 수 있습니다.
          </p>
          <AgentStatus bridgeUrl={settings.bridgeUrl || 'http://127.0.0.1:7842'} />
        </div>
      )}

      {progress && (
        <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 animate-fade-in">
          <div className="flex justify-between items-center mb-2">
            <h3 className="font-bold text-sm">
              {progress.agentRole === 'complete' ? '✅ 완료' : `⚡ 진행 중 (${progress.agentRole ?? ''})`}
            </h3>
            <span className="text-xs text-gray-500 font-mono">{progress.model}</span>
          </div>
          <p className="text-sm text-gray-300 mb-3">{progress.status}</p>
          <div className="w-full bg-gray-800 rounded-full h-2.5">
            <div
              className={`h-2.5 rounded-full transition-all duration-500 ${
                progress.agentRole === 'complete' ? 'bg-green-500' :
                progress.agentRole === 'error-report' ? 'bg-red-500' : 'bg-accent-500'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-2">
            <span>단계: {progress.step}/{progress.maxSteps}</span>
            <span>비용: ₩{progress.cost != null ? Math.round(progress.cost * 1450).toLocaleString() : '0'}</span>
          </div>

          {/* 실시간 상세 로그 */}
          {(() => {
            const detail = (progress as unknown as Record<string, unknown>).detail as undefined | {
              instruction?: string;
              streamLogs?: Array<{ type: string; data: string; time: number }>;
              output?: string;
              error?: string;
              changedFiles?: string[];
            };
            if (!detail) return null;
            return (
              <div className="mt-4 space-y-3">
                {detail.instruction && (
                  <details className="group">
                    <summary className="text-xs text-purple-400 cursor-pointer hover:text-purple-300">
                      📝 Claude Code에 보낸 프롬프트 (클릭하여 펼치기)
                    </summary>
                    <pre className="mt-2 text-xs text-gray-400 bg-gray-800 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                      {detail.instruction}
                    </pre>
                  </details>
                )}

                {detail.streamLogs && detail.streamLogs.length > 0 && (
                  <details open className="group">
                    <summary className="text-xs text-blue-400 cursor-pointer hover:text-blue-300">
                      🖥️ Claude Code 실행 로그 ({detail.streamLogs.length}줄)
                    </summary>
                    <div className="mt-2 bg-black rounded p-3 max-h-60 overflow-y-auto font-mono text-xs">
                      {detail.streamLogs.map((log, i) => (
                        <div key={i} className={`${log.type === 'stderr' ? 'text-yellow-400' : 'text-green-400'} break-words`}>
                          <span className="text-gray-600">[{new Date(log.time).toLocaleTimeString()}]</span>{' '}
                          {log.data.trim()}
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {detail.output && (
                  <details className="group">
                    <summary className="text-xs text-green-400 cursor-pointer hover:text-green-300">
                      📄 Claude Code 최종 출력
                    </summary>
                    <pre className="mt-2 text-xs text-gray-400 bg-gray-800 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                      {detail.output}
                    </pre>
                  </details>
                )}

                {detail.error && (
                  <details open className="group">
                    <summary className="text-xs text-red-400 cursor-pointer hover:text-red-300">
                      ❌ 에러 내용
                    </summary>
                    <pre className="mt-2 text-xs text-red-300 bg-red-900/30 rounded p-3 max-h-40 overflow-y-auto whitespace-pre-wrap break-words">
                      {detail.error}
                    </pre>
                  </details>
                )}

                {detail.changedFiles && detail.changedFiles.length > 0 && (
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">변경된 파일:</span>{' '}
                    {detail.changedFiles.map((f, i) => (
                      <span key={i} className="inline-block bg-gray-800 rounded px-1.5 py-0.5 mr-1 mt-1 text-blue-300">{f}</span>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <button onClick={loadAllData} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
          새로고침
        </button>
        <button onClick={() => testApi()} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
          API 테스트
        </button>
        <button onClick={handleExport} className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors">
          데이터 내보내기
        </button>
        <button
          onClick={() => { if (confirm('모든 데이터를 삭제하시겠습니까?')) clearData(); }}
          className="px-4 py-2 bg-red-900/50 hover:bg-red-900 rounded-lg text-sm transition-colors text-red-300"
        >
          전체 초기화
        </button>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colorMap: Record<string, string> = {
    green: 'text-green-400',
    red: 'text-red-400',
    yellow: 'text-yellow-400',
    blue: 'text-blue-400'
  };
  return (
    <div className="bg-gray-900 rounded-xl p-4 border border-gray-800 text-center">
      <div className={`text-2xl font-bold ${colorMap[color] || 'text-white'}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
    </div>
  );
}
