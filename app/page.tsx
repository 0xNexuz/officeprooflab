import { Brand, Icon, KindTile } from '@/components/Bits';

const REPO = 'https://github.com/0xNexuz/officeprooflab';

const KINDS = [
  { kind: 'xlsx' as const, name: 'Spreadsheets', note: '.xlsx, recalculated with Univer', heat: '/art/heat-a.png', checks: ['Stored results that differ from the formula', 'Totals that do not match their rows', 'Formulas that return an error', 'Numbers stored as text', 'Formulas that break the pattern of their neighbours'] },
  { kind: 'docx' as const, name: 'Documents', note: '.docx, read paragraph by paragraph', heat: '/art/heat-b.png', checks: ['Leftover placeholders and template markers', 'Assistant text left in the document', 'Markdown that was not converted', 'Table totals that do not add up', 'Headings and tables compared with the reference'] },
  { kind: 'pptx' as const, name: 'Slides', note: '.pptx, measured box by box', heat: '/art/heat-a.png', checks: ['Content outside the slide', 'Empty slides and empty placeholders', 'Missing pictures', 'Text too small to read', 'Slide count, size and titles compared with the reference'] },
];
const STEPS = [
  ['Write a test case', 'Pick the file kind, add your own rules and, if you have one, an approved reference file.'],
  ['Send a generated file', 'Upload it, or let your pipeline send what the agent just produced.'],
  ['Open what was flagged', 'The file opens in Univer Sheets, Docs or Slides with each flagged cell, paragraph or slide marked.'],
  ['Fix it and rerun', 'The next run shows what is fixed, what is still there and what is new.'],
];
const SCANS = [[73.75, 15.8, 7, 0], [43.5, 34.8, 5.75, 0.9], [74.1, 43.3, 8, 1.8], [15.5, 60.9, 6.5, 2.6], [53.4, 87.4, 5.25, 3.3]];

export default function Landing() {
  return (
    <div style={{ overflowX: 'hidden' }}>
      <header className="wrap l-head">
        <Brand />
        <nav className="l-nav" aria-label="Site">
          <a className="op-link" href="#checks">What it checks</a>
          <a className="op-link" href="#labels">Labels</a>
          <a className="op-link" href="#ci">CI</a>
          <a className="op-link" href={REPO}>GitHub</a>
          <a className="op-link" href="/signin">Sign in</a>
          <a className="op-btn op-btn--sm op-btn--ink" href="/signin?new=1">Start testing</a>
        </nav>
      </header>

      <section className="wrap l-hero">
        <div className="l-hero-copy">
          <h1 className="op-rise">Test the Office files your AI writes, before a customer opens them.</h1>
          <p className="lede op-rise op-rise--2">OfficeProof Lab recalculates every formula, compares documents and decks with your approved examples, and names the exact cell, page or slide that is wrong. Run it in the browser or in CI.</p>
          <div className="l-cta op-rise op-rise--3">
            <a className="op-btn" href="/signin?new=1">Start testing <Icon.arrow /></a>
            <a className="op-link" href="#ci">See how it runs in CI</a>
          </div>
          <p className="tiny op-rise op-rise--4" style={{ fontSize: 13 }}>.xlsx, .docx and .pptx. Built on the Univer SDK.</p>
        </div>
        <div className="l-art-col">
          <div className="l-art-size op-rise op-rise--2">
            <div className="l-art op-art">
              <div className="l-art-frame">
                <img src="/art/hero-base.webp" width={1600} height={2000} alt="A tipped laptop pours spreadsheet, document and slide tiles onto a crowd of ink-black files. One white file is circled in red." />
                {SCANS.map(([left, top, width, delay]) => <span key={left} className="op-scan" style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, aspectRatio: '1', animationDelay: `${delay}s` }} />)}
                <p className="l-art-cap" style={{ left: '6.9%', top: '27.5%' }}>CHECKED,<br />NOT GUESSED.</p>
                <p className="l-art-cap" style={{ right: '5.6%', top: '51.6%' }}>XLSX × DOCX × PPTX</p>
              </div>
              <div className="l-inspector">
                <div className="op-pop"><div className="op-float">
                  <img className="op-sniff" src="/art/inspector.png" width={784} height={664} alt="The OfficeProof inspector: a pixel-art Labrador in a red cap holding a magnifying glass" />
                </div></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="checks" className="l-band l-band--alt">
        <div className="wrap l-band-inner">
          <div className="l-intro">
            <h2 className="l-h2">What a run looks for</h2>
            <p>Deterministic checks for the three files agents generate most. Every finding points at one cell, one paragraph or one slide.</p>
          </div>
          <div className="l-kinds">
            {KINDS.map(item => (
              <article key={item.kind} className="op-card op-card--lift l-kind">
                <img className="op-heat" src={item.heat} alt="" width={52} height={52} />
                <div className="l-kind-head">
                  <KindTile kind={item.kind} />
                  <div><h3>{item.name}</h3><span className="tiny" style={{ fontSize: 13 }}>{item.note}</span></div>
                </div>
                <ul>{item.checks.map(check => <li key={check}>{check}</li>)}</ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="labels" className="l-band">
        <div className="wrap l-band-inner">
          <div className="l-intro">
            <h2 className="l-h2">Three labels, never mixed</h2>
            <p>Every finding says how sure it is. Only a confirmed failure fails a run or a build.</p>
          </div>
          <div className="l-labels">
            <div className="l-label l-label--ink">
              <span className="op-chip">Confirmed</span>
              <h3>A test result</h3>
              <p>Deterministic. The same file, reference and rules always give the same findings. Formulas are recalculated with Univer&apos;s formula engine, not read from the stored values.</p>
            </div>
            <div className="l-label">
              <span className="op-chip op-chip--visual">Visual</span>
              <h3>A comparison</h3>
              <p>How each slide&apos;s boxes line up with your reference, and whether text is likely to fit. Apps render differently, so these are reported and never fail a build.</p>
            </div>
            <div className="l-label">
              <span className="op-chip op-chip--ai">AI-assisted</span>
              <h3>An observation</h3>
              <p>Notes from Ling 3.2 Flash on a file&apos;s text, each tied to a quote that must be found in the file. Run on request, and never part of the verdict.</p>
            </div>
          </div>
          <p className="l-note"><span className="op-chip op-chip--skip">Not verified</span> Anything the engine could not check is reported as not verified. It is never counted as a pass.</p>
        </div>
      </section>

      <section className="l-band l-band--alt">
        <div className="wrap l-band-inner" style={{ gap: 44 }}>
          <h2 className="l-h2">How a run goes</h2>
          <ol className="l-steps">
            {STEPS.map(([title, text], index) => (
              <li key={title} className="op-card op-card--lift"><span className="pixel-num">{index + 1}</span><h3>{title}</h3><p>{text}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section id="ci" className="l-band">
        <div className="wrap l-band-inner l-ci">
          <div className="l-ci-copy">
            <h2 className="l-h2">The same checks in your pipeline</h2>
            <p>The engine runs headless, so a pull request can be stopped by a wrong total the same way it is stopped by a failing unit test.</p>
            <ul className="ticks">
              <li><Icon.check size={20} />The build fails only on a confirmed failure.</li>
              <li><Icon.check size={20} />Reports come out as JSON, Markdown, JUnit and HTML.</li>
              <li><Icon.check size={20} />A project token sends each run to your dashboard. Tokens are stored hashed.</li>
            </ul>
            <a className="op-link" href={`${REPO}/blob/main/docs/INTEGRATION.md`} style={{ fontWeight: 700, minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>Read the integration guide</a>
          </div>
          <div className="l-ci-code">
            <pre className="op-code"><span className="c"># officeproof.json lists your test cases, rules and reference files</span>{'\n'}node dist/officeproof.cjs check <span className="k">--config</span> officeproof.json</pre>
            <pre className="op-code"><span className="c"># .github/workflows/officeproof.yml</span>{'\n'}- <span className="k">uses</span>: 0xNexuz/officeprooflab@main{'\n'}  <span className="k">with</span>:{'\n'}    <span className="k">config</span>: officeproof.json{'\n'}    <span className="k">url</span>: https://your-dashboard.example{'\n'}    <span className="k">token</span>: <span className="s">{'${{ secrets.OFFICEPROOF_TOKEN }}'}</span></pre>
          </div>
        </div>
      </section>

      <section className="l-band l-band--alt">
        <div className="wrap l-band-inner l-two">
          <div>
            <h2>Made for the people who ship the generator</h2>
            <ul className="l-who"><li>AI-agent builders</li><li>SaaS teams</li><li>Document-automation developers</li><li>QA engineers</li></ul>
          </div>
          <div>
            <h2>Built on Univer</h2>
            <p className="muted" style={{ fontSize: 17, lineHeight: 1.55 }}>Univer is the Office content engine underneath. Its formula engine recalculates workbooks without an editor, in Node and in CI. Univer Sheets, Docs and Slides open the file when you inspect a finding. OfficeProof Lab adds the test cases, comparison rules, CI integration and the results dashboard.</p>
          </div>
        </div>
      </section>

      <section className="l-band l-foot op-foot">
        <div className="wrap l-foot-inner">
          <h2>Find the odd one out before your customer does.</h2>
          <a className="op-btn" href="/signin?new=1">Start testing <Icon.arrow /></a>
          <img className="op-crowd" src="/art/crowd.png" width={1600} height={520} alt="A row of ink-black files with one white file in the middle" />
        </div>
      </section>

      <footer className="l-bar">
        <div className="wrap l-bar-inner">
          <span className="mono" style={{ color: '#dcdad4' }}>OfficeProof Lab. Sample files are synthetic.</span>
          <nav aria-label="Footer">
            <a className="op-link" href={REPO}>GitHub</a>
            <a className="op-link" href={`${REPO}/blob/main/docs/INTEGRATION.md`}>Integration guide</a>
            <a className="op-link" href="/signin">Sign in</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
