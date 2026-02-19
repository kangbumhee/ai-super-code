import { useState } from 'react';
import { useDashboardStore } from '../store';
import type { Task } from '@/types';

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  queued: '📥',
  running: '⚡',
  completed: '🎉',
  failed: '❌',
  skipped: '🚫',
  retrying: '🔄'
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'text-yellow-400',
  queued: 'text-blue-400',
  running: 'text-accent-400',
  completed: 'text-green-400',
  failed: 'text-red-400',
  skipped: 'text-gray-500',
  retrying: 'text-yellow-400'
};

const ALL_STATUSES = ['pending', 'queued', 'running', 'completed', 'failed', 'retrying', 'skipped'];

export default function TaskManager() {
  const { tasks, approveTask, skipTask, cancelTask, retryTask, deleteTask } = useDashboardStore();
  const [filter, setFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const perPage = 20;

  const filtered = tasks
    .filter((t) => filter === 'all' || t.status === filter)
    .filter(
      (t) =>
        search === '' ||
        t.input.userMessage.toLowerCase().includes(search.toLowerCase()) ||
        t.id.includes(search)
    )
    .sort((a, b) => b.createdAt - a.createdAt);

  const paged = filtered.slice(page * perPage, (page + 1) * perPage);
  const totalPages = Math.ceil(filtered.length / perPage);

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex gap-3 flex-wrap items-center">
        <select
          value={filter}
          onChange={(e) => { setFilter(e.target.value); setPage(0); }}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
        >
          <option value="all">전체 ({tasks.length})</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_ICONS[s]} {s} ({tasks.filter((t) => t.status === s).length})
            </option>
          ))}
        </select>
        <input
          type="text"
          placeholder="검색..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(0); }}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm min-w-[200px]"
        />
      </div>

      {paged.length === 0 ? (
        <div className="text-center text-gray-500 py-12">태스크가 없습니다</div>
      ) : (
        <div className="space-y-2">
          {paged.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              expanded={expandedId === task.id}
              onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
              onApprove={() => approveTask(task.id)}
              onSkip={() => skipTask(task.id)}
              onCancel={() => cancelTask(task.id)}
              onRetry={() => retryTask(task.id)}
              onDelete={() => deleteTask(task.id)}
            />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="px-3 py-1 bg-gray-800 rounded disabled:opacity-30 text-sm"
          >
            이전
          </button>
          <span className="px-3 py-1 text-sm text-gray-400">{page + 1} / {totalPages}</span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="px-3 py-1 bg-gray-800 rounded disabled:opacity-30 text-sm"
          >
            다음
          </button>
        </div>
      )}
    </div>
  );
}

function TaskCard({
  task,
  expanded,
  onToggle,
  onApprove,
  onSkip,
  onCancel,
  onRetry,
  onDelete
}: {
  task: Task;
  expanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onSkip: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onDelete: () => void;
}) {
  const elapsed = task.startedAt
    ? ((task.completedAt ?? Date.now()) - task.startedAt) / 1000
    : 0;

  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
      >
        <span className="text-lg">{STATUS_ICONS[task.status] ?? '📄'}</span>
        <div className="flex-1 min-w-0">
          <p className="text-sm truncate">{task.input.userMessage}</p>
          <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
            <span>{new Date(task.createdAt).toLocaleString('ko-KR')}</span>
            <span className={STATUS_COLORS[task.status]}>{task.status}</span>
            {task.output?.cost != null && (
              <span className="text-green-400">
                {task.output.model === 'claude-code' ? '₩0 (브릿지)' : `₩${Math.round(task.output.cost * 1450).toLocaleString()}`}
              </span>
            )}
            {elapsed > 0 && <span>{elapsed.toFixed(1)}s</span>}
          </div>
        </div>
        <span className={`transition-transform text-gray-500 ${expanded ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
          <div>
            <label className="text-xs text-gray-500 font-mono">ID</label>
            <p className="text-xs font-mono text-gray-400 break-all">{task.id}</p>
          </div>
          <div>
            <label className="text-xs text-gray-500">사용자 메시지</label>
            <p className="text-sm bg-gray-800 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {task.input.userMessage}
            </p>
          </div>
          <div>
            <label className="text-xs text-gray-500">Claude 응답 (발췌)</label>
            <p className="text-sm bg-gray-800 rounded p-2 whitespace-pre-wrap max-h-40 overflow-y-auto">
              {task.input.claudeResponse.slice(0, 1000)}
              {task.input.claudeResponse.length > 1000 && '...'}
            </p>
          </div>

          {task.output && (
            <>
              <div>
                <label className="text-xs text-gray-500">요약</label>
                <p className="text-sm">{task.output.summary}</p>
              </div>
              {task.output.files.length > 0 && (
                <div>
                  <label className="text-xs text-gray-500">생성 파일 ({task.output.files.length})</label>
                  <ul className="text-xs font-mono space-y-0.5 mt-1">
                    {task.output.files.map((f, i) => (
                      <li key={i} className="text-accent-300">
                        {f.action === 'create' ? '+ ' : f.action === 'delete' ? '- ' : '~ '}{f.path}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {task.retryHistory && task.retryHistory.length > 0 && (
            <div>
              <label className="text-xs text-gray-500">재시도 이력 ({task.retryHistory.length})</label>
              <div className="space-y-1 mt-1">
                {task.retryHistory.map((r, i) => (
                  <div key={i} className="text-xs bg-gray-800 rounded p-2 flex justify-between">
                    <span className="text-red-400 truncate max-w-[70%]">#{r.attempt}: {r.error}</span>
                    <span className="text-gray-500 font-mono">model idx {r.model}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            {task.status === 'pending' && (
              <>
                <button onClick={onApprove} className="px-4 py-1.5 bg-green-800 hover:bg-green-700 rounded-lg text-sm transition-colors">
                  승인 실행
                </button>
                <button onClick={onSkip} className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors">
                  스킵
                </button>
              </>
            )}
            {(task.status === 'pending' || task.status === 'queued' || task.status === 'running') && (
              <button onClick={onCancel} className="px-4 py-1.5 bg-red-900/50 hover:bg-red-800 rounded-lg text-sm transition-colors text-red-300">
                취소
              </button>
            )}
            {task.status === 'failed' && (
              <button onClick={onRetry} className="px-4 py-1.5 bg-yellow-800 hover:bg-yellow-700 rounded-lg text-sm transition-colors">
                재시도
              </button>
            )}
            <button
              onClick={() => { if (confirm('이 태스크를 목록에서 삭제하시겠습니까?')) onDelete(); }}
              className="px-4 py-1.5 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition-colors text-gray-300"
            >
              삭제
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
