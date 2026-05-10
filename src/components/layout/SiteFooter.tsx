import { Link } from 'react-router-dom';
import { Mountain } from 'lucide-react';

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-primary text-primary-foreground mt-24">
      <div className="container py-12 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <div className="h-8 w-8 rounded-md bg-accent flex items-center justify-center">
              <Mountain className="h-4 w-4 text-accent-foreground" />
            </div>
            <span className="font-display text-xl font-bold">Nepal Infra Watch</span>
          </div>
          <p className="text-sm text-primary-foreground/70 max-w-md leading-relaxed">
            An independent civic-tech platform tracking infrastructure projects across Nepal — from federal highways to provincial irrigation. Open data, verified sources, citizen-powered.
          </p>
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm">Explore</h4>
          <ul className="space-y-2 text-sm text-primary-foreground/70">
            <li><Link to="/projects" className="hover:text-accent">Browse projects</Link></li>
            <li><Link to="/map" className="hover:text-accent">Project map</Link></li>
            <li><Link to="/analytics" className="hover:text-accent">Analytics</Link></li>
            <li><Link to="/compare" className="hover:text-accent">Compare</Link></li>
          </ul>
        </div>
        <div>
          <h4 className="font-semibold mb-3 text-sm">Participate</h4>
          <ul className="space-y-2 text-sm text-primary-foreground/70">
            <li><Link to="/auth?mode=signup" className="hover:text-accent">Submit a project</Link></li>
            <li><Link to="/dashboard" className="hover:text-accent">Your dashboard</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-primary-foreground/10">
        <div className="container py-5 flex flex-col md:flex-row items-center justify-between gap-3 text-xs text-primary-foreground/60">
          <span>© {new Date().getFullYear()} Nepal Infra Watch. Built for transparency.</span>
          <span className="font-mono">v0.1 · Public Beta</span>
        </div>
      </div>
    </footer>
  );
}
