import { Brand } from '@/components/Bits';

export default function NotFound() {
  return (
    <main className="wrap" style={{ padding: '28px 32px 96px', display: 'flex', flexDirection: 'column', gap: 40, alignItems: 'flex-start' }}>
      <Brand />
      <img src="/art/odd.png" alt="" width={160} height={198} style={{ marginTop: 24 }} />
      <h1 style={{ fontSize: 'clamp(36px, 5vw, 64px)', lineHeight: 1, fontWeight: 800, letterSpacing: '-0.035em' }}>This page is not here.</h1>
      <p className="lede">The address may be mistyped, or the run or project may belong to another account.</p>
      <a className="op-btn" href="/app">Go to your projects</a>
    </main>
  );
}
