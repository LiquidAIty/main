import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function login() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStartDemo = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/auth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // If successful, navigate to the main app
      navigate('/agent-manager');
    } catch (err: any) {
      setError(err.message || 'Failed to start demo');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div>
          <h1 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Welcome to LiquidAIty</h1>
          <p className="mt-2 text-center text-sm text-gray-600">Click below to start your demo session</p>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded" role="alert">
            <span className="block sm:inline">{error}</span>
          </div>
        )}

        <div>
          <button
            onClick={handleStartDemo}
            disabled={loading}
            className="group relative w-full flex justify-center py-2 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {loading ? 'Starting...' : 'Start Demo'}
          </button>
        </div>
      </div>
    </div>
  );
}
