import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { ProjectCard } from '@/components/ProjectCard';
import { AdSlot } from '@/components/AdSlot';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card } from '@/components/ui/card';
import { Search } from 'lucide-react';
import { SECTORS, PROVINCES, STATUS_LABELS, districtsFor } from '@/lib/constants';

export default function Browse() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string>('all');
  const [province, setProvince] = useState<string>('all');
  const [district, setDistrict] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');

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

  const filtered = useMemo(() => projects.filter(p => {
    if (sector !== 'all' && p.sector !== sector) return false;
    if (province !== 'all' && p.province !== province) return false;
    if (district !== 'all' && p.district !== district) return false;
    if (status !== 'all' && p.status !== status) return false;
    if (q && !`${p.title} ${p.description ?? ''} ${p.contractor ?? ''} ${p.implementing_agency ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [projects, q, sector, province, district, status]);

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
          <Card className="p-4 mb-6 grid md:grid-cols-3 lg:grid-cols-5 gap-3">
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
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any status</SelectItem>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          </Card>

          {loading ? (
            <div className="grid md:grid-cols-2 gap-6">
              {Array.from({ length: 4 }).map((_, i) => <Card key={i} className="aspect-[16/11] animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">No projects match your filters.</Card>
          ) : (
            <div className="grid md:grid-cols-2 gap-6">
              {filtered.map(p => <ProjectCard key={p.id} p={p} />)}
            </div>
          )}
        </div>
        <aside className="space-y-6">
          <AdSlot slotKey="browse_sidebar" variant="sidebar" />
          <Card className="p-5">
            <h3 className="font-display text-lg font-semibold mb-2">Submit a project</h3>
            <p className="text-sm text-muted-foreground mb-3">Know of a project we're missing? Add it to the public record.</p>
            <a href="/auth?mode=signup" className="text-sm text-accent hover:underline font-medium">Get started →</a>
          </Card>
        </aside>
      </div>

      <SiteFooter />
    </div>
  );
}
