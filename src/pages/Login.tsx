import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Shield } from 'lucide-react';

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-accent/10 mb-4">
            <Shield className="w-8 h-8 text-brand-accent" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100">NMC AI Monitoring</h1>
          <p className="text-brand-text-muted mt-1">Shift Management System</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-brand-card border border-brand-border rounded-xl p-8 space-y-6"
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
              className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-lg text-slate-100 placeholder-brand-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
              placeholder="Enter your username"
              required
              autoFocus
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-2">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-brand-bg border border-brand-border rounded-lg text-slate-100 placeholder-brand-text-muted focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-transparent"
              placeholder="Enter your password"
              required
            />
          </div>

          {error && (
            <div className="px-4 py-3 bg-brand-danger/10 border border-brand-danger/30 rounded-lg text-brand-danger text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-brand-accent hover:bg-brand-accent/90 text-white font-semibold rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
