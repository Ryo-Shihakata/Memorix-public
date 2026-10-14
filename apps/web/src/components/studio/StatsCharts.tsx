import type { QuizStats } from '@memorix/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// §12.3: グラフは Recharts。呼び出し側(StudioStats.tsx)で動的 import する。
const HISTOGRAM_LABELS = ['0-19%', '20-39%', '40-59%', '60-79%', '80-100%'];

export default function StatsCharts({ stats }: { stats: QuizStats }) {
  const histogramData = stats.scoreHistogram.map((count, i) => ({
    range: HISTOGRAM_LABELS[i] ?? '',
    count,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">スコア分布</h2>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={histogramData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="range" fontSize={12} />
            <YAxis allowDecimals={false} fontSize={12} />
            <Tooltip />
            <Bar dataKey="count" fill="#4f46e5" name="件数" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h2 className="mb-2 text-sm font-semibold text-gray-700">日別プレイ数（直近30日）</h2>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={stats.dailyPlays}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" fontSize={10} tickFormatter={(d: string) => d.slice(5)} />
            <YAxis allowDecimals={false} fontSize={12} />
            <Tooltip />
            <Line type="monotone" dataKey="count" stroke="#4f46e5" name="プレイ数" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
