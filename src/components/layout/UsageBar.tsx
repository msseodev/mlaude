'use client';

import { useState, useEffect } from 'react';

interface UsageData {
  configured: boolean;
  utilization?: number;
  resetsAt?: string | null;
  error?: string;
}

export function UsageBar() {
  const [usage, setUsage] = useState<UsageData | null>(null);

  useEffect(() => {
    const fetchUsage = () => {
      fetch('/api/usage')
        .then(res => res.json())
        .then(setUsage)
        .catch(() => setUsage(null));
    };
    fetchUsage();
    const interval = setInterval(fetchUsage, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (!usage?.configured || usage.utilization === undefined) return null;

  const pct = usage.utilization;
  const barColor = pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-orange-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-green-500';
  const textColor = pct >= 90 ? 'text-red-700' : pct >= 75 ? 'text-orange-700' : pct >= 50 ? 'text-yellow-700' : 'text-green-700';

  let resetText = '';
  if (usage.resetsAt) {
    const d = new Date(usage.resetsAt);
    resetText = `Reset: ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  }

  return (
    <div className="flex h-8 items-center gap-3 border-t border-gray-200 bg-white px-4 text-xs">
      <span className={`font-medium ${textColor}`}>Usage: {pct}%</span>
      <div className="h-2 w-32 overflow-hidden rounded-full bg-gray-200">
        <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {resetText && <span className="text-gray-500">{resetText}</span>}
    </div>
  );
}
