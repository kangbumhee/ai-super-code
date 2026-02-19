import { useMemo, useState } from 'react';
import { useDashboardStore } from '../store';

export default function CostDashboard() {
  const { costs, state, settings, saveSettings } = useDashboardStore();
  const [budgetInput, setBudgetInput] = useState(String(settings.budgetLimit ?? 15000));

  const dailyCosts = useMemo(() => {
    const days: Record<string, number> = {};
    const now = Date.now();
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now - i * 86400000).toISOString().slice(0, 10);
      days[d] = 0;
    }
    for (const c of costs) {
      const d = new Date(c.timestamp).toISOString().slice(0, 10);
      if (d in days) days[d] += c.cost;
    }
    return Object.entries(days).map(([date, cost]) => ({ date, cost }));
  }, [costs]);

  const maxDailyCost = Math.max(...dailyCosts.map((d) => d.cost), 0.001);

  const modelCosts = useMemo(() => {
    const map: Record<string, { count: number; cost: number; input: number; output: number }> = {};
    for (const c of costs) {
      if (!map[c.model]) map[c.model] = { count: 0, cost: 0, input: 0, output: 0 };
      map[c.model].count++;
      map[c.model].cost += c.cost;
      map[c.model].input += c.inputTokens;
      map[c.model].output += c.outputTokens;
    }
    return Object.entries(map).sort((a, b) => b[1].cost - a[1].cost);
  }, [costs]);

  const avgCostPerTask = costs.length > 0 ? costs.reduce((s, c) => s + c.cost, 0) / costs.length : 0;
  const budgetUsed = state
    ? ((state.totalCost * 1450) / (settings.budgetLimit ?? 15000)) * 100
    : 0;

  const handleBudgetSave = () => {
    const val = parseFloat(budgetInput);
    if (!isNaN(val) && val > 0) saveSettings({ budgetLimit: val });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard
          label="총 비용"
          value={`₩${Math.round((state?.totalCost ?? 0) * 1450).toLocaleString()}`}
          sub={`$${(state?.totalCost ?? 0).toFixed(4)}`}
          color="text-green-400"
        />
        <SummaryCard
          label="오늘"
          value={`₩${Math.round((state?.todayCost ?? 0) * 1450).toLocaleString()}`}
          sub={`$${(state?.todayCost ?? 0).toFixed(4)}`}
          color="text-blue-400"
        />
        <SummaryCard
          label="태스크당 평균"
          value={`₩${Math.round(avgCostPerTask * 1450).toLocaleString()}`}
          sub={`$${avgCostPerTask.toFixed(4)}`}
          color="text-yellow-400"
        />
        <SummaryCard
          label="완료 태스크"
          value={String(state?.tasksCompleted ?? 0)}
          sub={`실패 ${state?.tasksFailed ?? 0}`}
          color="text-accent-400"
        />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-3">예산 관리</h3>
        <div className="flex items-center gap-3 mb-3">
          <span className="text-sm text-gray-400">월 예산 (원):</span>
          <input
            type="number"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            className="w-32 bg-gray-800 border border-gray-700 rounded px-2 py-1 text-sm"
            step="1000"
            min="1000"
          />
          <span className="text-sm text-gray-400">원</span>
          <button
            onClick={handleBudgetSave}
            className="px-3 py-1 bg-gray-800 hover:bg-gray-700 rounded text-sm transition-colors"
          >
            저장
          </button>
        </div>
        <div className="w-full bg-gray-800 rounded-full h-4 relative">
          <div
            className={`h-4 rounded-full transition-all ${
              budgetUsed > 90 ? 'bg-red-500' : budgetUsed > 70 ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(100, budgetUsed)}%` }}
          />
          <span className="absolute inset-0 flex items-center justify-center text-xs font-bold">
            {budgetUsed.toFixed(1)}%
          </span>
        </div>
        {budgetUsed > 80 && (
          <p className="text-xs text-yellow-400 mt-2">
            예산의 {budgetUsed.toFixed(0)}%를 사용했습니다.
          </p>
        )}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-4">일별 비용 (최근 14일)</h3>
        <div className="flex items-end gap-1 h-40">
          {dailyCosts.map((d) => (
            <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full">
              <div
                className="w-full bg-accent-600 rounded-t transition-all hover:bg-accent-500 min-h-[2px]"
                style={{ height: `${Math.max(2, (d.cost / maxDailyCost) * 100)}%` }}
                title={`${d.date}: $${d.cost.toFixed(4)}`}
              />
              <span className="text-[9px] text-gray-600 mt-1 -rotate-45 origin-top-left whitespace-nowrap">
                {d.date.slice(5)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-4">
        <h3 className="font-bold text-sm mb-3">모델별 비용</h3>
        {modelCosts.length === 0 ? (
          <p className="text-sm text-gray-500">데이터 없음</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-500 text-xs border-b border-gray-800">
                <th className="text-left py-2">모델</th>
                <th className="text-right py-2">요청 수</th>
                <th className="text-right py-2">입력 토큰</th>
                <th className="text-right py-2">출력 토큰</th>
                <th className="text-right py-2">비용</th>
              </tr>
            </thead>
            <tbody>
              {modelCosts.map(([model, data]) => (
                <tr key={model} className="border-b border-gray-800/50">
                  <td className="py-2 font-mono text-xs">{model}</td>
                  <td className="py-2 text-right">{data.count}</td>
                  <td className="py-2 text-right text-gray-400">{(data.input / 1000).toFixed(1)}K</td>
                  <td className="py-2 text-right text-gray-400">{(data.output / 1000).toFixed(1)}K</td>
                  <td className="py-2 text-right text-green-400">
                  ₩{Math.round(data.cost * 1450).toLocaleString()}
                </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  color
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-4 text-center">
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      <div className="text-[10px] text-gray-600 mt-0.5">{sub}</div>
    </div>
  );
}
