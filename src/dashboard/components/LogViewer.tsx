import { useState } from 'react';
import { useDashboardStore } from '../store';

export default function LogViewer() {
  const { logs } = useDashboardStore();
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = logs
    .filter(
      (l) =>
        search === '' ||
        l.userMessage.toLowerCase().includes(search.toLowerCase()) ||
        l.claudeResponse.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const handleExportLogs = () => {
    const text = filtered
      .map(
        (l) =>
          `[${l.timestamp}] (${l.status})\n👤 ${l.userMessage}\n🧠 ${l.claudeResponse}\n${'─'.repeat(60)}`
      )
      .join('\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `omnicoder-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex gap-3 items-center">
        <input
          type="text"
          placeholder="대화 내용 검색..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm"
        />
        <button
          onClick={handleExportLogs}
          className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm whitespace-nowrap"
        >
          로그 내보내기
        </button>
        <span className="text-sm text-gray-500">{filtered.length}개</span>
      </div>

      {filtered.length === 0 ? (
        <div className="text-center text-gray-500 py-12">대화 로그가 없습니다</div>
      ) : (
        <div className="space-y-2">
          {filtered.map((log) => (
            <div key={log.id} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
              <button
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors text-left"
              >
                <span
                  className={`text-xs mt-0.5 px-1.5 py-0.5 rounded ${
                    log.status === 'completed'
                      ? 'bg-green-900 text-green-300'
                      : log.status === 'executing'
                        ? 'bg-blue-900 text-blue-300'
                        : log.status === 'failed'
                          ? 'bg-red-900 text-red-300'
                          : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {log.status}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    <span className="text-gray-500">나:</span> {log.userMessage.slice(0, 120)}
                  </p>
                  <p className="text-xs text-gray-500 truncate mt-0.5">
                    <span className="text-gray-600">AI:</span> {log.claudeResponse.slice(0, 150)}
                  </p>
                </div>
                <span className="text-xs text-gray-600 whitespace-nowrap">
                  {new Date(log.timestamp).toLocaleString('ko-KR', {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </span>
              </button>

              {expandedId === log.id && (
                <div className="px-4 pb-4 border-t border-gray-800 pt-3 space-y-3">
                  <div>
                    <label className="text-xs text-gray-500">사용자 메시지 (전문)</label>
                    <div className="bg-gray-800 rounded p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto mt-1">
                      {log.userMessage}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Claude 응답 (전문)</label>
                    <div className="bg-gray-800 rounded p-3 text-sm whitespace-pre-wrap max-h-60 overflow-y-auto mt-1">
                      {log.claudeResponse}
                    </div>
                  </div>
                  {log.taskId && (
                    <div className="text-xs text-gray-500">
                      연결 태스크: <span className="font-mono">{log.taskId}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
