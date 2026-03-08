'use client';

import { usePathname } from 'next/navigation';
import { AppLayout } from './AppLayout';

const NO_LAYOUT_ROUTES = ['/login'];

export function ConditionalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const skipLayout = NO_LAYOUT_ROUTES.some((route) => pathname.startsWith(route));

  if (skipLayout) {
    return <>{children}</>;
  }

  return <AppLayout>{children}</AppLayout>;
}
