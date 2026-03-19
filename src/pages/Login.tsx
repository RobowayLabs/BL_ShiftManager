'use client';

import { useState } from 'react';
import { Shield, Eye, EyeOff, WifiOff, MonitorPlay } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useGuest } from '../context/GuestContext';

export function Login() {
  const { login } = useAuth();
  const { backendOnline, loginAsGuest } = useGuest();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const isOffline  = backendOnline === false;
  const isChecking = backendOnline === null;

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-4">

        {/* Offline warning banner */}
        {isOffline && (
          <div className="flex items-start gap-3 px-4 py-3 bg-yellow-500/10 border border-yellow-500/30 rounded-xl text-yellow-400">
            <WifiOff className="w-5 h-5 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Backend is offline</p>
              <p className="text-xs text-yellow-400/80 mt-0.5">
                The server is not reachable. Continue in Guest Mode to explore the app with demo data.
              </p>
            </div>
          </div>
        )}

        {/* Header */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-accent/10 mb-4">
            <Shield className="w-8 h-8 text-brand-accent" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">NMC AI Monitoring</h1>
          <p className="text-brand-text-muted mt-1">Shift Management System</p>
        </div>

        {/* Login form */}
        <form
          onSubmit={handleSubmit}
          className="bg-brand-card border border-brand-border rounded-xl p-8 space-y-5"
        >
          <div>
            <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-2">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-lg text-slate-100 placeholder-brand-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent disabled:opacity-40"
              placeholder="Enter your username"
              required
              autoFocus
              disabled={isOffline}
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 pr-12 bg-brand-bg border border-brand-border rounded-lg text-slate-100 placeholder-brand-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent disabled:opacity-40"
                placeholder="Enter your password"
                required
                disabled={isOffline}
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-text-muted hover:text-slate-300 transition-colors"
                tabIndex={-1}
              >
                {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 bg-brand-danger/10 border border-brand-danger/30 rounded-lg text-brand-danger text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading || isOffline}
            className="w-full py-3 bg-brand-accent hover:bg-brand-accent/90 text-white font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : isOffline ? 'Server unreachable' : 'Sign In'}
          </button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-brand-border" />
          <span className="text-xs text-brand-text-muted uppercase tracking-widest">or</span>
          <div className="flex-1 h-px bg-brand-border" />
        </div>

        {/* Guest mode button */}
        <button
          type="button"
          onClick={loginAsGuest}
          disabled={isChecking}
          className="w-full py-3 flex items-center justify-center gap-2 border border-brand-border rounded-xl text-slate-300 hover:bg-slate-800/60 hover:border-slate-500 transition-all font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <MonitorPlay className="w-4 h-4 text-brand-accent" />
          {isChecking ? 'Checking server...' : 'Continue as Guest'}
          {isOffline && (
            <span className="ml-1 text-[10px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded-full border border-yellow-500/30 font-semibold">
              OFFLINE MODE
            </span>
          )}
        </button>

        <p className="text-center text-[11px] text-brand-text-muted/60 px-4">
          Guest mode uses demo data only. All changes are temporary and lost on page reload.
        </p>
      </div>
    </div>
  );
}
