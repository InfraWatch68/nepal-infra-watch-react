import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { ProjectCard } from '@/components/ProjectCard';
import { AdSlot } from '@/components/AdSlot';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Search, Star } from 'lucide-react';
import { SECTORS, PROVINCES, STATUS_LABELS, districtsFor } from '@/lib/constants';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { v: 'newest', label: 'Newest first' },
  { v: 'oldest', label: 'Oldest first' },
  { v: 'name', label: 'Name (A–Z)' },
  { v: 'budget_desc', label: 'Budget (high–low)' },
  { v: 'budget_asc', label: 'Budget (low–high)' },
  { v: 'remaining', label: 'Most work remaining' },
  { v: 'progress_desc', label: 'Most progress' },
  { v: 'pride_first', label: 'National Pride first' },
  { v: 'recently_updated', label: 'Recently analysed' },
] as const;
type SortKey = typeof SORT_OPTIONS[number]['v'];

export default function Browse() {
  const { user } = useAuth();
  const submitHref = user ? '/dashboard/submit' : '/auth?mode=signup&next=/dashboard/submit';
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string>('all');
  const [province, setProvince] = useState<string>('all');
  const [district, setDistrict] = useState<string>('all');
  const [municipality, setMunicipality] = useState<string>('');
  const [status, setStatus] = useState<string>('all');
  const [sort, setSort] = useState<SortKey>('newest');
  const [page, setPage] = useState(1);
  const [rastraOnly, setRastraOnly] = useState(false);

  const districtOptions = useMemo(
    () => districtsFor(province === 'all' ? null : province),
    [province],
  );

  useEffect(() => {
    setLoading(true);
    supabase.from('projects').select('*').eq('approval_status', 'approved')
      .order('created_at', { ascending: false })
      .then(({ data }) => { setProjects(data ?? []); setLoading(false); });
  }, []);

  const filtered = useMemo(() => {
    const list = projects.filter(p => {
      if (sector !== 'all' && p.sector !== sector) return false;
      if (province !== 'all' && p.province !== province) return false;
      if (district !== 'all' && p.district !== district) return false;
      if (municipality && !(p.municipality ?? '').toLowerCase().includes(municipality.toLowerCase())) return false;
      // The Rastra Gaurav column on `projects` is `national_pride` (see
      // migration 20260513170000_projects_national_pride.sql). Keep
      // `is_rastra_gaurav` as a fallback in case future code lands either.
      if (rastraOnly && !(p.national_pride ?? p.is_rastra_gaurav)) return false;
      if (status !== 'all' && p.status !== status) return false;
      if (q && !`${p.title} ${p.description ?? ''} ${p.contractor ?? ''} ${p.implementing_agency ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
    const sorted = [...list];
    const np = (p: any) => !!(p?.national_pride ?? p?.is_rastra_gaurav);
    const ts = (s: string | null | undefined) => s ? new Date(s).getTime() : 0;
    switch (sort) {
      case 'oldest':       sorted.sort((a, b) => ts(a.created_at) - ts(b.created_at)); break;
      case 'name':         sorted.sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')); break;
      case 'budget_desc':  sorted.sort((a, b) => (b.budget_npr ?? 0) - (a.budget_npr ?? 0)); break;
      case 'budget_asc':   sorted.sort((a, b) => (a.budget_npr ?? 0) - (b.budget_npr ?? 0)); break;
      case 'remaining':    sorted.sort((a, b) => (a.progress_percent ?? 0) - (b.progress_percent ?? 0)); break;
      case 'progress_desc':sorted.sort((a, b) => (b.progress_percent ?? 0) - (a.progress_percent ?? 0)); break;
      case 'pride_first':  sorted.sort((a, b) => (Number(np(b)) - Number(np(a))) || (ts(b.created_at) - ts(a.created_at))); break;
      case 'recently_analysed':
      case 'recently_updated':
                           sorted.sort((a, b) => ts(b.last_comprehensive_analysis_at) - ts(a.last_comprehensive_analysis_at) || ts(b.created_at) - ts(a.created_at)); break;
      case 'newest':
      default:             sorted.sort((a, b) => ts(b.created_at) - ts(a.created_at)); break;
    }
    return sorted;
  }, [projects, q, sector, province, district, municipality, status, sort, rastraOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 whenever the filter set changes.
  useEffect(() => { setPage(1); }, [q, sector, province, district, municipality, status, sort, rastraOnly]);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-10">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Public Database</p>
          <h1 className="font-display text-4xl font-bold mb-2">Browse projects</h1>
          <p className="text-muted-foreground">{filtered.length} of {projects.length} projects</p>
        </div>
      </section>

      <div className="container py-8 grid lg:grid-cols-[1fr_280px] gap-8">
        <div>
          <Card className="p-4 mb-6 grid md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="md:col-span-3 lg:col-span-2 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search title, contractor, agency..." className="pl-9" />
            </div>
            <Select value={sector} onValueChange={setSector}>
              <SelectTrigger><SelectValue placeholder="Sector" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sectors</SelectItem>
                {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={province} onValueChange={v => { setProvince(v); setDistrict('all'); }}>
              <SelectTrigger><SelectValue placeholder="Province" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All provinces</SelectItem>
                {PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={district} onValueChange={setDistrict}>
              <SelectTrigger><SelectValue placeholder="District" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{province === 'all' ? 'All districts' : `All in ${province}`}</SelectItem>
                {districtOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input
              value={municipality}
              onChange={e => setMunicipality(e.target.value)}
              placeholder="Municipality / RM"
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger><SelectValue placeholder="Sort" /></SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map(o => <SelectItem key={o.v} value={o.v}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <button
              type="button"
              onClick={() => setRastraOnly(v => !v)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition lg:col-span-1 md:col-span-3",
                rastraOnly ? "bg-accent text-accent-foreground border-accent" : "hover:bg-muted"
              )}
              title="Show only Rastra Gaurav (national-pride) projects"
            >
              <Star className={cn("h-4 w-4", rastraOnly && "fill-current")} />
              <span className="font-mono uppercase text-xs tracking-wider">Rastra Gaurav</span>
            </button>
          </Card>

          {loading ? (
            <div className="grid md:grid-cols-2 gap-6">
              {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="aspect-[16/11] animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">No projects match your filters.</Card>
          ) : (
            <>
              <div className="grid md:grid-cols-2 gap-6">
                {paged.map(p => <ProjectCard key={p.id} p={p} />)}
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-8 text-sm">
                  <span className="text-muted-foreground font-mono">
                    Showing {((safePage - 1) * PAGE_SIZE) + 1}–{Math.min(safePage * PAGE_SIZE, filtered.length)} of {filtered.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      className="px-3 py-1.5 rounded-md border text-sm hover:bg-muted disabled:opacity-40"
                      onClick={() => setPage(p => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                    >Previous</button>
                    <span className="font-mono text-xs">page {safePage} / {totalPages}</span>
                    <button
                      className="px-3 py-1.5 rounded-md border text-sm hover:bg-muted disabled:opacity-40"
                      onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                    >Next</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        <aside className="space-y-6">
          <AdSlot slotKey="browse_sidebar" variant="sidebar" />
          <Card className="p-5">
            <h3 className="font-display text-lg font-semibold mb-2">Submit a project</h3>
            <p className="text-sm text-muted-foreground mb-3">Know of a project we're missing? Add it to the public record.</p>
            <Link to={submitHref} className="text-sm text-accent hover:underline font-medium">Get started →</Link>
          </Card>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}
