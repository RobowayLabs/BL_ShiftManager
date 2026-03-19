'use client';

import {
  Users,
  Clock,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { StatCard } from "../components/StatCard";
import { Badge } from "../components/Badge";
import { useDashboard } from "../hooks/useDashboard";
import { useAlerts } from "../hooks/useAlerts";

export const Dashboard = () => {
  const { stats, trendData, distributionData, loading } = useDashboard(30000);
  const { alerts } = useAlerts({ limit: '10' });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-brand-text-muted">Loading dashboard...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Total Employees"
          value={String(stats?.totalEmployees || 0)}
          icon={Users}
        />
        <StatCard
          title="Active Shifts"
          value={String(stats?.activeShifts || 0)}
          icon={Clock}
        />
        <StatCard
          title="Alerts Today"
          value={String(stats?.alertsToday || 0)}
          icon={AlertTriangle}
        />
        <StatCard
          title="Critical Alerts"
          value={String(stats?.criticalAlerts || 0)}
          icon={ShieldAlert}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-brand-card border border-brand-border rounded-lg p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-slate-100">Alert Trends (24h)</h3>
            <Badge variant="info">Real-time</Badge>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} itemStyle={{ color: '#06b6d4' }} />
                <Line type="monotone" dataKey="alerts" stroke="#06b6d4" strokeWidth={3} dot={{ r: 4, fill: '#06b6d4' }} activeDot={{ r: 6 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-brand-card border border-brand-border rounded-lg p-6">
          <h3 className="text-lg font-semibold text-slate-100 mb-6">Alert Distribution</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={distributionData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                  {distributionData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: '8px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-col gap-2 mt-4">
            {distributionData.map((item) => (
              <div key={item.name} className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.fill }} />
                  <span className="text-brand-text-muted">{item.name}</span>
                </div>
                <span className="font-medium text-slate-100">{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-brand-card border border-brand-border rounded-lg overflow-hidden">
        <div className="p-6 border-b border-brand-border flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-100">Recent System Alerts</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-slate-800/50 text-brand-text-muted text-xs uppercase tracking-wider">
                <th className="px-6 py-4 font-semibold">ID</th>
                <th className="px-6 py-4 font-semibold">Timestamp</th>
                <th className="px-6 py-4 font-semibold">Type</th>
                <th className="px-6 py-4 font-semibold">Message</th>
                <th className="px-6 py-4 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-brand-border">
              {alerts.map((alert) => (
                <tr key={alert.id} className="hover:bg-slate-800/30 transition-colors">
                  <td className="px-6 py-4 text-sm font-mono text-brand-accent">{alert.id}</td>
                  <td className="px-6 py-4 text-sm text-brand-text-muted">{format(new Date(alert.timestamp), 'MMM d, yyyy h:mm a')}</td>
                  <td className="px-6 py-4">
                    <Badge variant={alert.type === 'Critical' ? 'danger' : alert.type === 'Warning' ? 'warning' : 'info'}>
                      {alert.type}
                    </Badge>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-200">{alert.message}</td>
                  <td className="px-6 py-4 text-sm text-brand-text-muted">{alert.source}</td>
                </tr>
              ))}
              {alerts.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-brand-text-muted">No alerts found</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
