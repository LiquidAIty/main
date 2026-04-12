import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';

const C = {
  primary: "#4FA2AD",
  bg: "#1F1F1F",
  panel: "#2B2B2B",
  border: "#3A3A3A",
  text: "#FFFFFF",
  neutral: "#9CA3AF",
  warn: "#D98458",
};

export default function Signup() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, name: name || undefined }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Signup failed');
      }

      navigate('/');
    } catch (err: any) {
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}>
      <div className="p-8 rounded-lg w-full max-w-md" style={{ background: C.panel, border: `1px solid ${C.border}` }}>
        <div className="flex items-center gap-3 mb-6">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: `radial-gradient(circle at 35% 30%, #7ED1DB 0%, ${C.primary} 55%, #2E6C75 100%)`,
              boxShadow: "0 0 0 2px #000 inset",
            }}
          />
          <h1 className="text-2xl font-bold" style={{ color: C.text }}>Create Account</h1>
        </div>
        
        {error && (
          <div className="px-4 py-3 rounded mb-4" style={{ background: "rgba(217,132,88,0.08)", border: `1px solid rgba(217,132,88,0.35)`, color: C.warn }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSignup} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: C.neutral }}>
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-4 py-3 rounded focus:outline-none"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label htmlFor="name" className="block text-sm font-medium mb-2" style={{ color: C.neutral }}>
              Name (optional)
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-3 rounded focus:outline-none"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
              placeholder="Your name"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm font-medium mb-2" style={{ color: C.neutral }}>
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-4 py-3 rounded focus:outline-none"
              style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
              placeholder="At least 8 characters"
            />
            <p className="mt-1 text-xs" style={{ color: C.neutral }}>Must be at least 8 characters</p>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full font-semibold py-3 px-4 rounded transition-colors"
            style={{
              background: loading ? C.panel : `rgba(79,162,173,0.18)`,
              border: `1px solid ${loading ? C.border : C.primary}`,
              color: C.text,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Creating account...' : 'Sign Up'}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm" style={{ color: C.neutral }}>
            Already have an account?{' '}
            <Link to="/login" style={{ color: C.primary }} className="hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
