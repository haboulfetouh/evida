'use client';
import { useQuery } from '@tanstack/react-query';
import { get } from './api';

export interface Me {
  id: string;
  name: string;
  email: string;
  roles: string[];
  permissions: string[];
  organization: { id: string; name: string; slug: string; locale: 'en' | 'ar'; blindReviewEnabled: boolean; recordingEnabled: boolean };
}
export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/auth/me'), staleTime: 60_000, retry: false });
}
export function useCan() {
  const { data } = useMe();
  return (p: string) => Boolean(data?.permissions.includes(p));
}
