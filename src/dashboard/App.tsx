import { useEffect } from 'react';
import { useDashboardStore } from './store';
import ControlPanel from './components/ControlPanel';
import TaskManager from './components/TaskManager';
import LogViewer from './components/LogViewer';
import FileExplorer from './components/FileExplorer';
import CostDashboard from './components/CostDashboard';
import DebugPanel from './components/DebugPanel';
import SettingsPanel from './components/SettingsPanel';
import { MODEL_TIERS, type AppState } from '@/types';

const TABS = [
  { id: 'control', label: '컨트롤', icon: '🎛️' },
  { id: 'tasks', label: '태스크', icon: '📋' },
  { id: 'logs', label: '로그', icon: '💬' },
  { id: 'files', label: '파일', icon: '📁' },
  { id: 'costs', label: '비용', icon: '💰' },
  { id: 'debug', label: '디버그', icon: '🔧' },
  { id: 'settings', label: '설정', icon: '⚙️' }
];

export default function App() {
  const {
    activeTab,
    setActiveTab,
    state,
    loadAllData,
    setProgress,
    setState,
    isConnected
  } = useDashboardStore();

  useEffect(() => {
    loadAllData();
    const interval = setInterval(loadAllData, 5000);
    return () => clearInterval(interval);
  }, [loadAllData]);

  useEffect(() => {
    const listener = (msg: { type: string; data: unknown }) => {
      if (msg.type === 'STATE_UPDATE') {
        const p = msg.data as { state?: AppState };
        if (p?.state) setState(p.state);
      }
      if (msg.type === 'PROGRESS_UPDATE') {
        setProgress(msg.data as Parameters<typeof setProgress>[0]);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [setState, setProgress]);

  const renderTab = () => {
    switch (activeTab) {
      case 'control':
        return <ControlPanel />;
      case 'tasks':
        return <TaskManager />;
      case 'logs':
        return <LogViewer />;
      case 'files':
        return <FileExplorer />;
      case 'costs':
        return <CostDashboard />;
      case 'debug':
        return <DebugPanel />;
      case 'settings':
        return <SettingsPanel />;
      default:
        return <ControlPanel />;
    }
  };

  const modelName = state
    ? MODEL_TIERS[state.currentModelIndex]?.name || 'Unknown'
    : '-';

  return (
    <div className="flex flex-col h-screen bg-gray-950">
      <header className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold text-white">
            OmniCoder <span className="text-accent-400 text-sm">v2.0</span>
          </h1>
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              !isConnected ? 'bg-red-500' : state?.isMonitoring ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'
            }`}
            title={!isConnected ? '연결 끊김' : state?.isMonitoring ? '감시 중' : '대기 중'}
          />
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          {state && (
            <>
              <span>모델: <span className="text-accent-300 font-mono">{modelName}</span></span>
              <span>비용: <span className="text-green-400">₩{Math.round((state.totalCost || 0) * 1450).toLocaleString()}</span></span>
              <span>완료: <span className="text-blue-400">{state.tasksCompleted ?? 0}</span></span>
            </>
          )}
        </div>
      </header>

      <nav className="flex bg-gray-900 border-b border-gray-800 px-2 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.id
                ? 'border-accent-400 text-accent-300 bg-gray-800/50'
                : 'border-transparent text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      <main className="flex-1 overflow-y-auto p-4">{renderTab()}</main>
    </div>
  );
}
