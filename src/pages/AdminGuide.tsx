import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { ArrowLeft, BookOpen, ExternalLink, Menu, X, Sparkles, AlertCircle, Plus } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import guideMarkdown from '../../docs/ADMIN_GUIDE.md?raw';

const GITHUB_URL = 'https://github.com/InfraWatch68/nepal-infra-watch-react/blob/main/docs/ADMIN_GUIDE.md';

// rehype-slug uses github-slugger; for the TOC we replicate the algorithm
// closely enough that our own anchor hrefs match the IDs it generates.
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')   // strip punctuation (but keep dashes + underscores)
    .replace(/\s+/g, '-')        // spaces → dashes
    .replace(/-+/g, '-')         // collapse repeats
    .replace(/^-|-$/g, '');      // trim
}

// Extract h2 + h3 headings from the markdown source for the TOC sidebar.
// We avoid running react-markdown twice; parsing the raw text is cheaper
// and deterministic.
type TocEntry = { level: 2 | 3; title: string; slug: string };

function buildToc(md: string): TocEntry[] {
  const lines = md.split('\n');
  const entries: TocEntry[] = [];
  let inCodeFence = false;
  for (const line of lines) {
    if (line.startsWith('```')) { inCodeFence = !inCodeFence; continue; }
    if (inCodeFence) continue;
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    if (h2) { entries.push({ level: 2, title: h2[1], slug: slugify(h2[1]) }); continue; }
    // We only show h2s in the TOC for cleanliness; h3 'Previous' / 'Current'
    // would clutter every section. Subsections are visible inline.
  }
  return entries;
}

// Convert react-markdown children into a plain text string so we can match
// against well-known headers ("Previous", "Current", "Fix / Change:").
// react-markdown passes ReactNode children which may be strings, arrays, or
// element nodes — walk recursively.
function childrenToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (typeof node === 'object' && 'props' in (node as Record<string, unknown>)) {
    const props = (node as { props: { children?: unknown } }).props;
    return childrenToText(props.children);
  }
  return '';
}

export default function AdminGuide() {
  const toc = useMemo(() => buildToc(guideMarkdown), []);
  const [activeSlug, setActiveSlug] = useState<string | null>(toc[0]?.slug ?? null);
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Scroll-spy: highlight the TOC entry whose H2 is closest to the top
  // of the viewport. Re-attach observer after the markdown renders.
  useEffect(() => {
    if (toc.length === 0) return;
    const t = setTimeout(() => {
      // Disconnect any prior observer.
      observerRef.current?.disconnect();
      const headings = toc
        .map(e => document.getElementById(e.slug))
        .filter((el): el is HTMLElement => !!el);
      if (headings.length === 0) return;

      const observer = new IntersectionObserver(
        (entries) => {
          // Find the topmost intersecting heading.
          const intersecting = entries.filter(e => e.isIntersecting);
          if (intersecting.length > 0) {
            const top = intersecting.reduce((a, b) =>
              a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
            );
            setActiveSlug(top.target.id);
          }
        },
        // Margin: trigger when the heading is in the top 30% of viewport.
        { rootMargin: '0% 0% -70% 0%', threshold: 0 },
      );
      headings.forEach(h => observer.observe(h));
      observerRef.current = observer;
    }, 100);
    return () => {
      clearTimeout(t);
      observerRef.current?.disconnect();
    };
  }, [toc]);

  // Initial scroll if URL has a hash on load — markdown is rendered async-ish
  // so we wait a tick before scrolling.
  useEffect(() => {
    if (!window.location.hash) return;
    const t = setTimeout(() => {
      const id = window.location.hash.slice(1);
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
    return () => clearTimeout(t);
  }, []);

  // ── Custom markdown renderers ──────────────────────────────────────────────

  // Color-coded H3 for "Previous" / "Current" subsection headers.
  // Renders as a small pill instead of a plain h3 — much easier to scan
  // when every section has both subsections.
  const H3Render = (p: { children?: React.ReactNode }) => {
    const txt = childrenToText(p.children).trim();
    if (txt === 'Previous') {
      return (
        <h3 className="inline-flex items-center gap-1.5 mt-6 mb-2 px-2.5 py-1 rounded-md bg-muted text-muted-foreground text-xs font-mono uppercase tracking-wider not-prose">
          <span className="opacity-50">◌</span> Previous
        </h3>
      );
    }
    if (txt === 'Current') {
      return (
        <h3 className="inline-flex items-center gap-1.5 mt-6 mb-2 px-2.5 py-1 rounded-md bg-success/10 text-success border border-success/30 text-xs font-mono uppercase tracking-wider not-prose">
          <span>●</span> Current
        </h3>
      );
    }
    return <h3 className="mt-8 mb-3 font-display text-lg font-semibold">{p.children}</h3>;
  };

  // Paragraphs starting with "Fix / Change:" or "Where to find it:" become
  // callout blocks instead of plain text.
  const PRender = (p: { children?: React.ReactNode }) => {
    const txt = childrenToText(p.children).trim();
    if (txt.startsWith('Fix / Change:')) {
      return (
        <div className="not-prose my-4 border-l-4 border-accent bg-accent/5 rounded-r px-4 py-3 text-sm flex gap-3 items-start">
          <AlertCircle className="h-4 w-4 text-accent shrink-0 mt-0.5" />
          <div>{p.children}</div>
        </div>
      );
    }
    if (txt.startsWith('Where to find it:')) {
      return (
        <div className="not-prose my-3 border border-info/30 bg-info/5 rounded-md px-3 py-2 text-xs font-mono flex gap-2 items-start text-info">
          <span className="shrink-0">📍</span>
          <div>{p.children}</div>
        </div>
      );
    }
    return <p>{p.children}</p>;
  };

  // List items starting with "+" or "+ (added ...)" get an accent marker
  // so additions stand out from baseline behaviour.
  const LIRender = (p: { children?: React.ReactNode }) => {
    const txt = childrenToText(p.children).trim();
    const isAddition = txt.startsWith('+') || txt.startsWith('+ ');
    if (isAddition) {
      return (
        <li className="not-prose flex gap-2 items-start my-1.5 pl-0 list-none">
          <Plus className="h-3.5 w-3.5 text-success shrink-0 mt-1" />
          <div className="text-sm">{p.children}</div>
        </li>
      );
    }
    return <li>{p.children}</li>;
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      {/* Hero strip — title + GitHub link + mobile TOC trigger */}
      <section className="border-b bg-gradient-to-br from-secondary/50 via-secondary/30 to-background">
        <div className="container py-6 sm:py-10">
          <Link
            to="/admin"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3 font-mono"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Admin
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Admin reference</p>
              <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold flex items-center gap-3">
                <BookOpen className="h-7 w-7 sm:h-9 sm:w-9 text-accent shrink-0" /> Admin Guide
              </h1>
              <p className="text-sm sm:text-base text-muted-foreground mt-3 max-w-2xl">
                Every administrative capability on the platform, with{' '}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono text-[10px]">◌ Previous</span>{' '}
                and{' '}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-success/10 text-success border border-success/30 font-mono text-[10px]">● Current</span>{' '}
                under each section so you can see how each area has evolved.
              </p>
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-mono shrink-0 px-3 py-1.5 rounded-md border border-accent/30 bg-accent/5 hover:bg-accent/10 transition-colors"
            >
              View on GitHub <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>

      {/* Mobile TOC trigger — sticky just under the hero on small viewports */}
      <div className="md:hidden sticky top-0 z-30 bg-background/95 backdrop-blur border-b">
        <Button
          variant="ghost"
          className="w-full justify-between rounded-none h-12 px-4"
          onClick={() => setMobileTocOpen(o => !o)}
        >
          <span className="inline-flex items-center gap-2 text-sm font-mono">
            {mobileTocOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            {mobileTocOpen ? 'Close contents' : 'Contents'}
          </span>
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[55%]">
            {toc.find(e => e.slug === activeSlug)?.title ?? toc[0]?.title}
          </span>
        </Button>
        {mobileTocOpen && (
          <nav className="border-t bg-background max-h-[60vh] overflow-y-auto">
            <ul className="py-2">
              {toc.map(e => (
                <li key={e.slug}>
                  <a
                    href={`#${e.slug}`}
                    onClick={() => setMobileTocOpen(false)}
                    className={cn(
                      'block px-4 py-2 text-sm border-l-2 transition-colors',
                      activeSlug === e.slug
                        ? 'border-accent bg-accent/5 text-foreground font-medium'
                        : 'border-transparent text-muted-foreground hover:bg-muted/30',
                    )}
                  >
                    {e.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </div>

      <div className="container py-6 md:py-10">
        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] lg:grid-cols-[260px_1fr] gap-6 lg:gap-10">
          {/* Desktop sticky TOC. Hidden on mobile (controlled by the
              disclosure above). Sticky at the top of the viewport beneath
              the site header (which is ~64px tall). */}
          <aside className="hidden md:block">
            <nav className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto pr-2 border-l border-border">
              <div className="text-xs uppercase tracking-wider font-mono text-muted-foreground px-3 mb-2">
                Contents
              </div>
              <ul className="space-y-px">
                {toc.map(e => (
                  <li key={e.slug}>
                    <a
                      href={`#${e.slug}`}
                      className={cn(
                        'block px-3 py-1.5 text-xs leading-snug border-l-2 -ml-px transition-colors rounded-r',
                        activeSlug === e.slug
                          ? 'border-accent bg-accent/5 text-foreground font-medium'
                          : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30',
                      )}
                    >
                      {e.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>

          {/* Article. prose-zinc theme keeps headings serifed (matches the
              site's font-display) and bumps spacing. not-prose escape hatch
              is used inside H3Render / PRender / LIRender so they can stand
              out from the surrounding prose flow. */}
          <article className={cn(
            'prose prose-sm sm:prose-base max-w-none min-w-0',
            'prose-headings:font-display prose-headings:scroll-mt-24',
            'prose-h1:text-3xl prose-h1:mb-4',
            'prose-h2:text-2xl prose-h2:mt-14 prose-h2:mb-4 prose-h2:pb-3 prose-h2:border-b prose-h2:border-border',
            'prose-p:leading-relaxed',
            'prose-a:text-accent prose-a:no-underline hover:prose-a:underline',
            'prose-code:font-mono prose-code:text-[0.85em] prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:border prose-code:border-border/60 prose-code:before:content-none prose-code:after:content-none',
            'prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:text-xs',
            'prose-blockquote:border-l-accent prose-blockquote:bg-muted/30 prose-blockquote:py-2 prose-blockquote:not-italic',
            'prose-table:text-xs sm:prose-table:text-sm prose-table:border prose-table:border-border prose-table:rounded prose-table:overflow-hidden',
            'prose-th:bg-muted prose-th:font-mono prose-th:text-xs prose-th:uppercase prose-th:tracking-wider',
            'prose-hr:my-12 prose-hr:border-border',
            'prose-strong:text-foreground',
            'dark:prose-invert',
          )}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeSlug]}
              components={{
                h3: H3Render,
                p: PRender,
                li: LIRender,
              }}
            >
              {guideMarkdown}
            </ReactMarkdown>
          </article>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
