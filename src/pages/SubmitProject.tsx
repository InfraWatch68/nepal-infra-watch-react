import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SECTORS, PROVINCES, districtsFor } from '@/lib/constants';
import { useMemo } from 'react';
import { parseCoordinates } from '@/lib/parseCoords';
import { toast } from 'sonner';
import { z } from 'zod';

const PROJECT_TYPES = ['Road','Bridge','Hydropower','Solar','Irrigation','Drinking water','Sewerage','School','Hospital','Airport','Railway','Tunnel','Cable car','Building','Telecom','Other'];
const ESIA_OPTIONS = ['not_started','in_progress','iee_approved','eia_approved','rejected','exempt'];
const PROCUREMENT_METHODS = ['ICB (international)','NCB (national)','Limited','Direct','Framework','PPP','Two-stage','Single-source','Other'];

const schema = z.object({
  title: z.string().trim().min(4).max(200),
  description: z.string().trim().max(5000).optional(),
  sector: z.string().min(1),
  province: z.string().optional(),
  district: z.string().max(120).optional(),
  municipality: z.string().max(120).optional(),
  ward: z.coerce.number().int().min(0).max(99).optional(),
  location_text: z.string().max(300).optional(),
  project_type: z.string().max(60).optional(),
  budget_npr: z.coerce.number().nonnegative().optional(),
  funding_committed_npr: z.coerce.number().nonnegative().optional(),
  estimated_beneficiaries: z.coerce.number().int().nonnegative().optional(),
  procurement_method: z.string().max(60).optional(),
  esia_status: z.string().max(40).optional(),
  contractor: z.string().max(200).optional(),
  implementing_agency: z.string().max(200).optional(),
  start_date: z.string().optional(),
  expected_completion: z.string().optional(),
  cover_image_url: z.string().url().optional().or(z.literal('')),
  coords: z.string().optional(),
});

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) + '-' + Math.random().toString(36).slice(2, 6);

export default function SubmitProject() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<any>({ sector: SECTORS[0] });
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const districtOptions = useMemo(() => districtsFor(form.province), [form.province]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return toast.error('Sign in first');
    const parsed = schema.safeParse(form);
    if (!parsed.success) return toast.error(parsed.error.issues[0].message);

    let lat: number | null = null, lng: number | null = null;
    if (form.coords) {
      const c = parseCoordinates(form.coords);
      if (!c) return toast.error('Could not parse coordinates. Try "27.7172, 85.3240" or "27.7172° N, 85.3240° E".');
      lat = c.lat; lng = c.lng;
    }

    setLoading(true);
    const { coords, ...payload } = parsed.data as any;
    const { error } = await supabase.from('projects').insert({
      ...payload,
      slug: slugify(payload.title),
      latitude: lat, longitude: lng,
      submitted_by: user.id,
      cover_image_url: payload.cover_image_url || null,
    });
    setLoading(false);
    if (error) return toast.error(error.message);
    toast.success('Submitted! Reviewers will look at it shortly.');
    nav('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Contribute</p>
          <h1 className="font-display text-4xl font-bold">Submit a project</h1>
          <p className="text-muted-foreground mt-2">Provide what you know — sources can be added after approval.</p>
        </div>
      </section>

      <div className="container py-8 max-w-3xl">
        <Card className="p-6">
          <form onSubmit={submit} className="space-y-5">
            <Field label="Project title *"><Input maxLength={200} required onChange={e => set('title', e.target.value)} /></Field>
            <Field label="Description"><Textarea rows={4} maxLength={5000} onChange={e => set('description', e.target.value)} /></Field>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Sector *">
                <Select value={form.sector} onValueChange={v => set('sector', v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Province">
                <Select value={form.province ?? ''} onValueChange={v => { set('province', v); set('district', undefined); }}>
                  <SelectTrigger><SelectValue placeholder="Select province" /></SelectTrigger>
                  <SelectContent>{PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="District" hint={form.province ? undefined : 'Pick a province to narrow this list.'}>
                <Select value={form.district ?? ''} onValueChange={v => set('district', v)}>
                  <SelectTrigger><SelectValue placeholder="Select district" /></SelectTrigger>
                  <SelectContent>
                    {districtOptions.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Municipality / VDC"><Input maxLength={120} onChange={e => set('municipality', e.target.value)} /></Field>
              <Field label="Ward no."><Input type="number" min="0" max="99" onChange={e => set('ward', e.target.value)} /></Field>
              <Field label="Location description"><Input maxLength={300} placeholder="e.g. Kalanki–Naubise section" onChange={e => set('location_text', e.target.value)} /></Field>
              <Field label="Coordinates" hint='Paste any format. e.g. "27.7172, 85.3240"'>
                <Input placeholder='27.7172° N, 85.3240° E' onChange={e => set('coords', e.target.value)} />
              </Field>
              <Field label="Project type">
                <Select value={form.project_type ?? ''} onValueChange={v => set('project_type', v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>{PROJECT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Budget (NPR)"><Input type="number" min="0" onChange={e => set('budget_npr', e.target.value)} /></Field>
              <Field label="Funding committed (NPR)" hint="Total of all funding sources committed."><Input type="number" min="0" onChange={e => set('funding_committed_npr', e.target.value)} /></Field>
              <Field label="Estimated beneficiaries"><Input type="number" min="0" onChange={e => set('estimated_beneficiaries', e.target.value)} /></Field>
              <Field label="Implementing agency"><Input maxLength={200} onChange={e => set('implementing_agency', e.target.value)} /></Field>
              <Field label="Contractor"><Input maxLength={200} onChange={e => set('contractor', e.target.value)} /></Field>
              <Field label="Procurement method">
                <Select value={form.procurement_method ?? ''} onValueChange={v => set('procurement_method', v)}>
                  <SelectTrigger><SelectValue placeholder="Select method" /></SelectTrigger>
                  <SelectContent>{PROCUREMENT_METHODS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="ESIA / EIA status">
                <Select value={form.esia_status ?? ''} onValueChange={v => set('esia_status', v)}>
                  <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                  <SelectContent>{ESIA_OPTIONS.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Start date"><Input type="date" onChange={e => set('start_date', e.target.value)} /></Field>
              <Field label="Expected completion"><Input type="date" onChange={e => set('expected_completion', e.target.value)} /></Field>
            </div>

            <Field label="Cover image URL"><Input type="url" onChange={e => set('cover_image_url', e.target.value)} /></Field>

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={loading} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {loading ? 'Submitting...' : 'Submit for review'}
              </Button>
              <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
            </div>
          </form>
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}

function Field({ label, hint, children }: any) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
