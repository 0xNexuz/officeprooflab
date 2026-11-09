'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useShell } from '@/components/Shell';

/** There is always at least one project, so this page only forwards to it. */
export default function AppHome() {
  const { projects } = useShell();
  const router = useRouter();
  useEffect(() => { if (projects[0]) router.replace(`/app/p/${projects[0].id}`); }, [projects, router]);
  return <div className="loading">Opening your project<span className="busy-dots" /></div>;
}
