'use client';

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './Sidebar';
import { ToastProvider } from '@/components/ui/Toast';

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);

  useEffect(() => {
    fetch('/api/auth/check')
      .then((res) => res.json())
      .then((data) => {
        setAuthEnabled(data.authEnabled === true);
      })
      .catch(() => {
        // If check fails, assume auth is not enabled
      });
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // Continue with redirect even if the request fails
    }
    window.location.href = '/login';
  }, []);

  return (
    <ToastProvider>
      <div className="flex h-screen bg-gray-50">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          authEnabled={authEnabled}
          onLogout={handleLogout}
        />

        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Mobile header */}
          <header className="flex h-16 items-center border-b border-gray-200 bg-white px-4 lg:hidden">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-gray-600 hover:text-gray-900"
              aria-label="Open navigation menu"
            >
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <span className="ml-3 text-lg font-bold text-gray-900">mclaude</span>
          </header>

          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
