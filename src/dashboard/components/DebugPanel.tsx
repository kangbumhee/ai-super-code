import { useState } from 'react';
import { useDashboardStore } from '../store';

export default function DebugPanel() {
  const { state, sendMessage, isConnected } = useDashboardStore();
  const [selectorResult, setSelectorResult] = useState<string | null>(null);
  const [customMsg, setCustomMsg] = useState('{"type":"GET_STATE"}');
  const [customResult, setCustomResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const handleSelectorTest = async () => {
    setIsTesting(true);
    setSelectorResult(null);
    const res = (await sendMessage({ type: 'RUN_SELECTOR_TEST' })) as {
      success: boolean;
      results?: unknown;
      error?: string;
    };
    if (res.success) {
      setSelectorResult(JSON.stringify(res.results, null, 2));
    } else {
      setSelectorResult(`오류: ${res.error ?? 'Unknown error'}`);
    }
    setIsTesting(false);
  };

  const handleCustomMessage = async () => {
    try {
      const parsed = JSON.parse(customMsg);
      const res = await sendMessage(parsed);
      setCustomResult(JSON.stringify(res, null, 2));
    } catch (err) {
      setCustomResult(`JSON 파싱 오류: ${err}`);
    }
  };

  const connections = [
    { name: 'Background', ok: isConnected },
    { name: 'Storage', ok: !!state },
    { name: 'API', ok: state?.currentModelIndex != null }
  ];

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-3">연결 상태</h3>
        <div className="flex gap-4">
          {connections.map((c) => (
            <div key={c.name} className="flex items-center gap-2">
              <span className={`w-3 h-3 rounded-full ${c.ok ? 'bg-green-500' : 'bg-red-500'}`} />
              <span className="text-sm">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-3">DOM 셀렉터 테스트</h3>
        <p className="text-xs text-gray-400 mb-3">
          Claude.ai 탭이 열려 있어야 합니다.
        </p>
        <button
          onClick={handleSelectorTest}
          disabled={isTesting}
          className="px-4 py-2 bg-accent-800 hover:bg-accent-700 rounded-lg text-sm transition-colors disabled:opacity-50"
        >
          {isTesting ? '테스트 중...' : '셀렉터 테스트 실행'}
        </button>
        {selectorResult && (
          <pre className="mt-3 bg-gray-800 rounded p-3 text-xs font-mono max-h-60 overflow-auto whitespace-pre-wrap">
            {selectorResult}
          </pre>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-3">커스텀 메시지</h3>
        <div className="flex gap-2">
          <textarea
            value={customMsg}
            onChange={(e) => setCustomMsg(e.target.value)}
            rows={3}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono resize-y"
          />
          <button
            onClick={handleCustomMessage}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-sm transition-colors self-start"
          >
            전송
          </button>
        </div>
        {customResult && (
          <pre className="mt-3 bg-gray-800 rounded p-3 text-xs font-mono max-h-60 overflow-auto whitespace-pre-wrap">
            {customResult}
          </pre>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-3">현재 상태 (Raw)</h3>
        <pre className="bg-gray-800 rounded p-3 text-xs font-mono max-h-80 overflow-auto whitespace-pre-wrap">
          {JSON.stringify(state, null, 2)}
        </pre>
      </div>
    </div>
  );
}
