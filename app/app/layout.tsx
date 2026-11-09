import Shell from '@/components/Shell';

export const metadata = { title: 'OfficeProof Lab' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <Shell>{children}</Shell>;
}
