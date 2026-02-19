import { useState, useEffect } from 'react';
import { useDashboardStore } from '../store';
import { MODEL_TIERS, type OmniCoderSettings } from '@/types';

type LocalSettings = Omit<Partial<OmniCoderSettings>, 'selectorOverrides'> & {
  selectorOverrides?: Record<string, string> | string;
};

export default function SettingsPanel() {
  const { settings, saveSettings, testApi, exportData, importData, clearData } = useDashboardStore();
  const [localSettings, setLocalSettings] = useState<LocalSettings>(() => ({
    ...settings,
    selectorOverrides:
      typeof settings.selectorOverrides === 'object'
        ? JSON.stringify(settings.selectorOverrides, null, 2)
        : (settings.selectorOverrides as string) || '',
  }));
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [bridgeTestResult, setBridgeTestResult] = useState<string | null>(null);
  const [importText, setImportText] = useState('');

  useEffect(() => {
    setLocalSettings({
      ...settings,
      selectorOverrides:
        typeof settings.selectorOverrides === 'object'
          ? JSON.stringify(settings.selectorOverrides, null, 2)
          : '',
    } as LocalSettings);
  }, [settings]);

  const handleSave = async () => {
    const toSave = { ...localSettings } as Partial<OmniCoderSettings>;
    const raw = localSettings.selectorOverrides;
    if (typeof raw === 'string') {
      try {
        toSave.selectorOverrides = raw.trim() ? (JSON.parse(raw) as Record<string, string>) : {};
      } catch {
        toSave.selectorOverrides = {};
      }
    }
    await saveSettings(toSave);
    alert('✅ 설정이 저장되었습니다.');
  };

  const handleTestApi = async () => {
    setTestResult('테스트 중...');
    try {
      const result = await testApi(localSettings.apiKey);
      setTestResult(result.success ? '✅ API 연결 성공!' : `❌ ${result.message || 'API 연결 실패'}`);
    } catch {
      setTestResult('❌ API 테스트 오류');
    }
  };

  const handleBridgeTest = async () => {
    setBridgeTestResult('연결 중...');
    try {
      const url = localSettings.bridgeUrl || 'http://127.0.0.1:7842';
      const res = await fetch(`${url}/status`);
      const data = await res.json();
      if (data.success) {
        setBridgeTestResult(`✅ 연결 성공! 프로젝트: ${data.directory} | 에이전트: ${data.agents?.length || 0}개`);
      } else {
        setBridgeTestResult('❌ 서버 응답 오류');
      }
    } catch {
      setBridgeTestResult('❌ 연결 실패 — bridge-server.cjs가 실행 중인지 확인하세요');
    }
  };

  const handleExport = async () => {
    try {
      const data = await exportData();
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `omnicoder-backup-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      alert('백업 실패');
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) return;
    try {
      await importData(importText);
      alert('✅ 가져오기 완료');
      setImportText('');
    } catch {
      alert('❌ 가져오기 실패');
    }
  };

  const handleReset = async () => {
    if (!confirm('정말 모든 데이터를 삭제하시겠습니까?')) return;
    await clearData();
    alert('초기화 완료');
    window.location.reload();
  };

  const krwRate = 1450;
  const selectorOverridesStr =
    typeof localSettings.selectorOverrides === 'string'
      ? localSettings.selectorOverrides
      : typeof localSettings.selectorOverrides === 'object' && localSettings.selectorOverrides !== null
        ? JSON.stringify(localSettings.selectorOverrides, null, 2)
        : '';

  return (
    <div className="space-y-4 p-4 max-w-2xl mx-auto">

      {/* ====== 브릿지 모드 (최상단) ====== */}
      <div className="bg-purple-900/30 border border-purple-500/50 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-2 text-purple-400">
          🌉 브릿지 모드 (Genspark 두뇌 + Claude Code 실행기)
        </h3>
        <p className="text-sm text-gray-400 mb-3">
          Genspark(무료 Opus)이 설계·판단하고, Claude Code가 단순 실행만 합니다.
          <br />bridge-server.cjs가 실행 중이어야 합니다.
        </p>
        <label className="flex items-center gap-3 mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={localSettings.useBridge || false}
            onChange={(e) => setLocalSettings({ ...localSettings, useBridge: e.target.checked })}
            className="w-5 h-5 rounded accent-purple-500"
          />
          <span className="font-medium">브릿지 모드 사용</span>
        </label>
        {localSettings.useBridge && (
          <div className="space-y-3 mt-2">
            <div>
              <label className="block text-sm text-gray-400 mb-1">브릿지 서버 URL</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={localSettings.bridgeUrl || 'http://127.0.0.1:7842'}
                  onChange={(e) => setLocalSettings({ ...localSettings, bridgeUrl: e.target.value })}
                  className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm border border-gray-600 focus:border-purple-500 outline-none"
                />
                <button
                  onClick={handleBridgeTest}
                  className="bg-purple-600 hover:bg-purple-500 px-4 py-2 rounded text-sm font-medium whitespace-nowrap"
                >
                  연결 테스트
                </button>
              </div>
            </div>
            {bridgeTestResult && (
              <p
                className={`text-sm ${
                  bridgeTestResult.startsWith('✅')
                    ? 'text-green-400'
                    : bridgeTestResult.startsWith('❌')
                      ? 'text-red-400'
                      : 'text-yellow-400'
                }`}
              >
                {bridgeTestResult}
              </p>
            )}
            <div className="bg-gray-800/50 rounded p-3 text-xs text-gray-500">
              <p>
                사용법: 터미널에서 <code className="bg-gray-700 px-1 rounded">node bridge-server.cjs &quot;프로젝트경로&quot;</code> 실행
              </p>
              <p className="mt-1">
                브릿지 모드 ON → Genspark 대화 감지 → Claude Code가 파일 생성/수정 → 오류 시 Genspark에 자동 보고
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ====== Anthropic API ====== */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3">Anthropic API</h3>
        <div className="flex gap-2 mb-2">
          <input
            type={showKey ? 'text' : 'password'}
            value={localSettings.apiKey || ''}
            onChange={(e) => setLocalSettings({ ...localSettings, apiKey: e.target.value })}
            placeholder="sk-ant-api03-..."
            className="flex-1 bg-gray-700 rounded px-3 py-2 text-sm border border-gray-600 focus:border-blue-500 outline-none"
          />
          <button onClick={() => setShowKey(!showKey)} className="bg-gray-600 hover:bg-gray-500 px-3 py-2 rounded text-sm">
            {showKey ? '숨기기' : '보기'}
          </button>
          <button onClick={handleTestApi} className="bg-blue-600 hover:bg-blue-500 px-3 py-2 rounded text-sm">
            테스트
          </button>
        </div>
        {testResult && (
          <p
            className={`text-sm ${
              testResult.startsWith('✅') ? 'text-green-400' : testResult.startsWith('❌') ? 'text-red-400' : 'text-yellow-400'
            }`}
          >
            {testResult}
          </p>
        )}
      </div>

      {/* ====== 실행 설정 ====== */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3">실행 설정</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">실행 모드</label>
            <select
              value={localSettings.executionMode || 'manual'}
              onChange={(e) =>
                setLocalSettings({ ...localSettings, executionMode: e.target.value as OmniCoderSettings['executionMode'] })
              }
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm border border-gray-600"
            >
              <option value="manual">수동 승인</option>
              <option value="semi_auto">반자동</option>
              <option value="full_auto">완전 자동</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">기본 AI 모델</label>
            <select
              value={localSettings.defaultModelIndex ?? 0}
              onChange={(e) => setLocalSettings({ ...localSettings, defaultModelIndex: Number(e.target.value) })}
              className="w-full bg-gray-700 rounded px-3 py-2 text-sm border border-gray-600"
            >
              {MODEL_TIERS.map((m, i) => (
                <option key={m.id} value={i}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <label className="flex items-center gap-2 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={localSettings.notificationsEnabled ?? true}
            onChange={(e) => setLocalSettings({ ...localSettings, notificationsEnabled: e.target.checked })}
            className="w-4 h-4 rounded"
          />
          <span className="text-sm">알림 사용</span>
        </label>
        <div className="mt-3">
          <label className="block text-sm text-gray-400 mb-1">월 예산 (₩)</label>
          <input
            type="number"
            value={localSettings.budgetLimit ?? 15000}
            onChange={(e) => setLocalSettings({ ...localSettings, budgetLimit: Number(e.target.value) })}
            className="w-32 bg-gray-700 rounded px-3 py-2 text-sm border border-gray-600"
          />
          <span className="text-xs text-gray-500 ml-2">
            ≈ ${((localSettings.budgetLimit ?? 15000) / krwRate).toFixed(1)} USD
          </span>
        </div>
      </div>

      {/* ====== 프로젝트 ====== */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3">프로젝트</h3>
        <div className="mb-3">
          <label className="block text-sm text-gray-400 mb-1">프로젝트 이름</label>
          <input
            type="text"
            value={localSettings.projectName || ''}
            onChange={(e) => setLocalSettings({ ...localSettings, projectName: e.target.value })}
            className="w-full bg-gray-700 rounded px-3 py-2 text-sm border border-gray-600"
          />
        </div>
        <div className="mb-3">
          <label className="block text-sm text-gray-400 mb-1">최대 재시도 횟수: {localSettings.maxRetries ?? 5}</label>
          <input
            type="range"
            min={1}
            max={10}
            value={localSettings.maxRetries ?? 5}
            onChange={(e) => setLocalSettings({ ...localSettings, maxRetries: Number(e.target.value) })}
            className="w-full"
          />
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.autoUpgrade ?? true}
              onChange={(e) => setLocalSettings({ ...localSettings, autoUpgrade: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">실패 시 자동 모델 업그레이드</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={localSettings.gitAutoCommit ?? false}
              onChange={(e) => setLocalSettings({ ...localSettings, gitAutoCommit: e.target.checked })}
              className="w-4 h-4 rounded"
            />
            <span className="text-sm">Git 자동 커밋</span>
          </label>
        </div>
      </div>

      {/* ====== Genspark 로그인 ====== */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3">Genspark 자동 로그인</h3>
        <div>
          <label className="block text-sm text-gray-400 mb-1">쿠키 JSON (배열)</label>
          <textarea
            value={localSettings.gensparkCookies || ''}
            onChange={(e) => setLocalSettings({ ...localSettings, gensparkCookies: e.target.value })}
            placeholder='[{"name":"session_token","value":"...","domain":".genspark.ai"}]'
            className="w-full bg-gray-700 rounded px-3 py-2 text-sm h-20 border border-gray-600 font-mono"
          />
        </div>
      </div>

      {/* ====== 셀렉터 ====== */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3">DOM 셀렉터 (고급)</h3>
        <div>
          <label className="block text-sm text-gray-400 mb-1">셀렉터 오버라이드 JSON</label>
          <textarea
            value={selectorOverridesStr}
            onChange={(e) =>
              setLocalSettings({ ...localSettings, selectorOverrides: e.target.value })
            }
            placeholder='{"userMessage":".custom-user","assistantMessage":".custom-assistant"}'
            className="w-full bg-gray-700 rounded px-3 py-2 text-sm h-20 border border-gray-600 font-mono"
          />
          <p className="text-xs text-gray-500 mt-1">Genspark UI 변경 시 디버그 탭에서 셀렉터 테스트 후 여기에 입력하세요.</p>
        </div>
      </div>

      {/* ====== 저장 버튼 ====== */}
      <button
        onClick={handleSave}
        className="w-full bg-blue-600 hover:bg-blue-500 py-3 rounded-lg font-semibold text-lg"
      >
        설정 저장
      </button>

      {/* ====== 데이터 관리 ====== */}
      <div className="bg-gray-800 rounded-lg p-4">
        <h3 className="text-lg font-semibold mb-3">데이터 관리</h3>
        <div className="flex gap-2 mb-3">
          <button onClick={handleExport} className="bg-gray-600 hover:bg-gray-500 px-4 py-2 rounded text-sm">
            전체 백업 (JSON)
          </button>
          <button onClick={handleReset} className="bg-red-700 hover:bg-red-600 px-4 py-2 rounded text-sm">
            전체 초기화
          </button>
        </div>
        <div>
          <label className="block text-sm text-gray-400 mb-1">데이터 가져오기</label>
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="백업 JSON을 여기에 붙여넣기..."
            className="w-full bg-gray-700 rounded px-3 py-2 text-sm h-20 border border-gray-600 font-mono mb-2"
          />
          <button onClick={handleImport} className="bg-green-700 hover:bg-green-600 px-4 py-2 rounded text-sm">
            가져오기 실행
          </button>
        </div>
      </div>
    </div>
  );
}
