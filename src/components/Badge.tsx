import * as React from "react";
import { cn } from "../lib/utils";

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  className?: string;
}

export const Badge = ({ children, variant = 'neutral', className }: BadgeProps) => {
  const variants = {
    success: 'bg-brand-success/10 text-brand-success border-brand-success/20',
    warning: 'bg-brand-warning/10 text-brand-warning border-brand-warning/20',
    danger: 'bg-brand-danger/10 text-brand-danger border-brand-danger/20',
    info: 'bg-brand-accent/10 text-brand-accent border-brand-accent/20',
    neutral: 'bg-slate-700/50 text-slate-400 border-slate-600/50',
  };

  return (
    <span className={cn(
      'px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider border',
      variants[variant],
      className
    )}>
      {children}
    </span>
  );
};
