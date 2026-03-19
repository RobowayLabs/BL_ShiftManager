'use client';

import { Bell, Search, User } from "lucide-react";
import { Button } from "./Button";

interface HeaderProps {
  title: string;
  userName?: string;
  userRole?: string;
}

export const Header = ({ title, userName, userRole }: HeaderProps) => {
  return (
    <header className="h-16 border-b border-brand-border bg-brand-card/50 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-10">
      <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
      
      <div className="flex items-center gap-4">
        <div className="relative hidden md:block">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-text-muted" />
          <input 
            type="text" 
            placeholder="Search system..." 
            className="bg-slate-800 border border-brand-border rounded-md pl-10 pr-4 py-1.5 text-sm text-slate-100 focus:outline-none focus:ring-1 focus:ring-brand-accent w-64"
          />
        </div>
        
        <Button variant="ghost" size="sm" className="relative p-2">
          <Bell className="w-5 h-5 text-brand-text-muted" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-brand-danger rounded-full border-2 border-brand-card" />
        </Button>
        
        <div className="h-8 w-px bg-brand-border mx-2" />
        
        <div className="flex items-center gap-3 pl-2">
          <div className="text-right hidden sm:block">
            <p className="text-sm font-medium text-slate-100">{userName || 'Admin User'}</p>
            <p className="text-[10px] text-brand-text-muted uppercase tracking-wider">
              {userRole === 'super_admin' ? 'Super Admin' : userRole === 'manager' ? 'Manager' : userRole === 'guest' ? 'Guest Mode' : 'User'}
            </p>
          </div>
          <div className="w-9 h-9 rounded-full bg-brand-accent/20 border border-brand-accent/30 flex items-center justify-center">
            <User className="w-5 h-5 text-brand-accent" />
          </div>
        </div>
      </div>
    </header>
  );
};
