import { Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { ArrowLeft, BookOpen, ExternalLink } from 'lucide-react';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
// Vite ?raw import bundles the markdown text at build time. The single
// source of truth stays in docs/ADMIN_GUIDE.md (also viewable on GitHub);
// this page renders the same content with prose typography.
import guideMarkdown from '../../docs/ADMIN_GUIDE.md?raw';

const GITHUB_URL = 'https://github.com/InfraWatch68/nepal-infra-watch-react/blob/main/docs/ADMIN_GUIDE.md';

export default function AdminGuide() {
  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />

      <section className="border-b bg-secondary/30">
        <div className="container py-6 sm:py-8">
          <Link
            to="/admin"
            className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 mb-3 font-mono"
          >
            <ArrowLeft className="h-3 w-3" /> Back to Admin
          </Link>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Admin reference</p>
              <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold flex items-center gap-3">
                <BookOpen className="h-6 w-6 sm:h-7 sm:w-7 text-accent" /> Admin Guide
              </h1>
              <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                Every administrative capability on the platform, with Previous / Current under each section so
                you can see how each area has evolved. After every commit that touches admin behaviour, the
                Current is promoted to Previous and a new Current is written.
              </p>
            </div>
            <a
              href={GITHUB_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-accent hover:underline inline-flex items-center gap-1 font-mono shrink-0"
            >
              View on GitHub <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>

      <div className="container py-6 sm:py-10 max-w-4xl">
        {/* prose styles via @tailwindcss/typography (already in deps).
            prose-sm on mobile to keep line-length comfortable on a phone;
            prose-base on sm: and up. dark:prose-invert mirrors the rest of
            the site's theme behaviour. */}
        <article className="prose prose-sm sm:prose-base dark:prose-invert max-w-none
          prose-headings:font-display prose-headings:scroll-mt-20
          prose-h1:text-2xl sm:prose-h1:text-3xl
          prose-h2:border-b prose-h2:border-border prose-h2:pb-2 prose-h2:mt-12
          prose-h3:mt-8
          prose-table:text-xs sm:prose-table:text-sm
          prose-code:font-mono prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded
          prose-code:before:content-none prose-code:after:content-none
          prose-pre:bg-muted prose-pre:text-xs
          prose-a:text-accent prose-a:no-underline hover:prose-a:underline">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug]}
          >
            {guideMarkdown}
          </ReactMarkdown>
        </article>
      </div>

      <SiteFooter />
    </div>
  );
}
