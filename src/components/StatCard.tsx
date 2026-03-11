import { cn } from "../lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  className?: string;
}

export const StatCard = ({ title, value, icon: Icon, trend, className }: StatCardProps) => {
  return (
    <div className={cn("bg-brand-card border border-brand-border p-5 rounded-lg shadow-sm", className)}>
      <div className="flex items-center justify-between mb-4">
        <div className="p-2 bg-slate-700/50 rounded-md">
          <Icon className="w-5 h-5 text-brand-accent" />
        </div>
        {trend && (
          <span className={cn(
            "text-xs font-medium px-2 py-0.5 rounded-full",
            trend.isPositive ? "bg-brand-success/10 text-brand-success" : "bg-brand-danger/10 text-brand-danger"
          )}>
            {trend.value}
          </span>
        )}
      </div>
      <div>
        <p className="text-brand-text-muted text-sm font-medium mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-slate-100">{value}</h3>
      </div>
    </div>
  );
};
