'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { I18nProvider } from '@/i18n';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
        },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <I18nProvider>{children}</I18nProvider>
    </QueryClientProvider>
  );
}
