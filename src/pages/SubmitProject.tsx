import { useEffect, useState } from 'react';
import { useNavigate, Navigate, useSearchParams } from 'react-router-dom';
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
import { SECTORS, PROJECT_TYPES, PROVINCES, districtsFor } from '@/lib/constants';
import { useMemo } from 'react';
import { parseCoordinates } from '@/lib/parseCoords';
import { CoordPickerDialog } from '@/components/CoordPickerDialog';
import { ImageDropzone } from '@/components/ImageDropzone';
import { SubmitDetailsSection, emptyDetails, detailsForInsert, type DetailsState } from '@/components/SubmitDetailsSection';
import { toast } from 'sonner';
import { z } from 'zod';

// Maps the in-memory bucket key to its real DB table.
const DETAIL_TABLES: Record<keyof DetailsState, string> = {
  funding:      'project_funding',
  documents:    'project_documents',
  stakeholders: 'project_stakeholders',
  risks:        'project_risks',
  impact:       'project_impact',
  procurement:  'project_procurement',
  compliance:   'project_compliance',
};

const ESIA_OPTIONS = ['not_started','in_progress','iee_approved','eia_approved','rejected','exempt'];
const PROCUREMENT_METHODS = ['ICB (international)','NCB (national)','Limited','Direct','Framework','PPP','Two-stage','Single-source','Other'];
const SOURCE_TYPES = ['article','government','report','social_media','blog','official_document','other'];

type SourceRow = { url: string; title: string; source_type: string };

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
  // Manually-entered physical/implementation progress. `progress_percent` is
  // 0–100; `progress_stage` is a short freeform label ("Foundation poured",
  // "50% structural"). These are distinct from `reported_progress_*`, which
  // are reserved for AI-extracted values with a source citation.
  progress_percent: z.coerce.number().min(0).max(100).optional(),
  progress_stage: z.string().max(60).optional(),
  cover_image_url: z.string().url().optional().or(z.literal('')),
  coords: z.string().optional(),
});

const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 80) + '-' + Math.random().toString(36).slice(2, 6);

export default function SubmitProject() {
  const { user, loading: authLoading, isReviewer } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const editId = params.get('edit');
  const isEdit = Boolean(editId);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<any>({ sector: SECTORS[0] });
  const [editLoaded, setEditLoaded] = useState<boolean>(!isEdit);
  const [sources, setSources] = useState<SourceRow[]>([{ url: '', title: '', source_type: 'article' }]);
  const [details, setDetails] = useState<DetailsState>(emptyDetails());
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const setSource = (i: number, patch: Partial<SourceRow>) =>
    setSources(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addSource = () => setSources(rows => [...rows, { url: '', title: '', source_type: 'article' }]);
  const removeSource = (i: number) => setSources(rows => rows.filter((_, idx) => idx !== i));

  // Load existing project on edit mode. Restricted to submitter or moderators
  // by RLS; we additionally guard the form to read-only for everyone else.
  useEffect(() => {
    if (!isEdit || !user) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', editId).maybeSingle();
      if (cancelled) return;
      if (error || !data) { toast.error('Project not found'); nav('/dashboard'); return; }
      const ownsIt = data.submitted_by === user.id;
      const editableStatus = data.approval_status === 'pending' || data.approval_status === 'changes_requested';
      if (!ownsIt && !isReviewer) { toast.error('You can only edit your own submissions'); nav('/dashboard'); return; }
      if (ownsIt && !editableStatus) { toast.error('This submission is no longer editable. Ask a reviewer.'); nav('/dashboard'); return; }
      setForm({
        ...data,
        coords: (data.latitude != null && data.longitude != null) ? `${data.latitude}, ${data.longitude}` : '',
      });
      const { data: src } = await supabase.from('project_sources').select('url, title, source_type').eq('project_id', editId);
      if ((src ?? []).length > 0) {
        setSources((src ?? []).map((s: any) => ({ url: s.url ?? '', title: s.title ?? '', source_type: s.source_type ?? 'article' })));
      }

      // Load this user's editable detail rows (pending or changes_requested).
      // Approved rows are intentionally left alone — they go through the admin
      // moderation tab so the contributor doesn't accidentally bounce an
      // already-cleared row back into the queue.
      const loaded: DetailsState = emptyDetails();
      await Promise.all((Object.keys(DETAIL_TABLES) as (keyof DetailsState)[]).map(async (k) => {
        const tbl = DETAIL_TABLES[k];
        const { data: rows } = await supabase.from(tbl as any).select('*')
          .eq('project_id', editId)
          .eq('submitted_by', user.id)
          .in('approval_status', ['pending', 'changes_requested']);
        loaded[k] = (rows ?? []) as any[];
      }));
      setDetails(loaded);
      setEditLoaded(true);
    })();
    return () => { cancelled = true; };
  }, [isEdit, editId, user, isReviewer, nav]);

  if (!authLoading && !user) {
    return <Navigate to="/auth?mode=signup&next=/dashboard/submit" replace />;
  }
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

    // Validate the source rows: any row with a URL also needs a title.
    const cleanSources = sources
      .map(s => ({ url: s.url.trim(), title: s.title.trim(), source_type: s.source_type }))
      .filter(s => s.url.length > 0);
    for (const s of cleanSources) {
      try { new URL(s.url); }
      catch { return toast.error(`Source URL is invalid: ${s.url}`); }
      if (!s.title) return toast.error('Each source needs a short title');
    }

    setLoading(true);
    const { coords, ...payload } = parsed.data as any;

    let projectId: string | number;
    if (isEdit) {
      // If a moderator is editing an already-approved row, keep it published.
      // Submitter edits (or moderator edits on pending rows) bounce to pending
      // so the next approval re-runs the publish-delay trigger.
      const wasOwnerEdit = form.submitted_by === user.id;
      const wasApproved = form.approval_status === 'approved';
      const update: any = {
        ...payload,
        latitude: lat, longitude: lng,
        cover_image_url: payload.cover_image_url || null,
      };
      if (wasOwnerEdit || !wasApproved) {
        update.approval_status = 'pending';
        update.published_at = null;
      }
      const { error } = await supabase.from('projects').update(update).eq('id', editId);
      if (error) { setLoading(false); return toast.error(error.message); }
      projectId = editId!;
      // Replace the source set: delete this user's existing sources, insert new ones.
      await supabase.from('project_sources').delete().eq('project_id', projectId).eq('added_by', user.id);
    } else {
      const { data: proj, error } = await supabase.from('projects').insert({
        ...payload,
        slug: slugify(payload.title),
        latitude: lat, longitude: lng,
        submitted_by: user.id,
        cover_image_url: payload.cover_image_url || null,
      }).select('id').single();
      if (error) { setLoading(false); return toast.error(error.message); }
      projectId = proj.id;
    }

    if (cleanSources.length > 0) {
      const { error: sErr } = await supabase.from('project_sources').insert(cleanSources.map(s => ({
        project_id: projectId,
        added_by: user.id,
        title: s.title,
        url: s.url,
        source_type: s.source_type,
        verified: false,
        approval_status: 'pending',
        submitted_by_ai: false,
      })));
      if (sErr) console.warn('Source insert failed:', sErr.message);
    }

    // Comprehensive detail rows. In edit mode, drop this user's pending /
    // changes_requested rows first so the form is the source of truth — but
    // never touch approved rows (those belong to the moderation queue).
    const detailInserts = detailsForInsert(details);
    let detailRowCount = 0;
    for (const [bucket, tbl] of Object.entries(DETAIL_TABLES) as [keyof DetailsState, string][]) {
      const rows = detailInserts[bucket];
      if (isEdit) {
        await supabase.from(tbl as any)
          .delete()
          .eq('project_id', projectId)
          .eq('submitted_by', user.id)
          .in('approval_status', ['pending', 'changes_requested']);
      }
      if (rows.length === 0) continue;
      const payload = rows.map(r => ({
        ...r,
        project_id: projectId,
        submitted_by: user.id,
        submitted_by_ai: false,
        approval_status: 'pending',
      }));
      const { error: dErr } = await supabase.from(tbl as any).insert(payload);
      if (dErr) {
        console.warn(`${tbl} insert failed:`, dErr.message);
        toast.warning(`${bucket}: ${dErr.message}`);
      } else {
        detailRowCount += rows.length;
      }
    }

    setLoading(false);
    const detailMsg = detailRowCount > 0 ? ` (${detailRowCount} detail row${detailRowCount === 1 ? '' : 's'})` : '';
    toast.success(isEdit
      ? `Updated — back in the review queue.${detailMsg}`
      : `Submitted! Reviewers will look at it shortly.${detailMsg}`);
    nav('/dashboard');
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Contribute</p>
          <h1 className="font-display text-4xl font-bold">{isEdit ? 'Edit project' : 'Submit a project'}</h1>
          <p className="text-muted-foreground mt-2">
            {isEdit
              ? 'Saving will reset this submission to pending and re-enter the review queue.'
              : 'Provide what you know — sources can be added after approval.'}
          </p>
        </div>
      </section>

      <div className="container py-8 max-w-3xl">
        <Card className="p-6">
          {!editLoaded ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
          <form onSubmit={submit} className="space-y-5">
            <Field label="Project title *"><Input maxLength={200} required value={form.title ?? ''} onChange={e => set('title', e.target.value)} /></Field>
            <Field label="Description"><Textarea rows={4} maxLength={5000} value={form.description ?? ''} onChange={e => set('description', e.target.value)} /></Field>

            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Sector *">
                <Select value={form.sector ?? SECTORS[0]} onValueChange={v => set('sector', v)}>
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
              <Field label="Municipality / VDC"><Input maxLength={120} value={form.municipality ?? ''} onChange={e => set('municipality', e.target.value)} /></Field>
              <Field label="Ward no."><Input type="number" min="0" max="99" value={form.ward ?? ''} onChange={e => set('ward', e.target.value)} /></Field>
              <Field label="Location description"><Input maxLength={300} placeholder="e.g. Kalanki–Naubise section" value={form.location_text ?? ''} onChange={e => set('location_text', e.target.value)} /></Field>
              <Field label="Coordinates" hint='Paste any format or pick on the map.'>
                <div className="flex gap-2">
                  <Input placeholder='27.7172° N, 85.3240° E' value={form.coords ?? ''} onChange={e => set('coords', e.target.value)} />
                  <CoordPickerDialog initial={form.coords} onPick={(v) => set('coords', v)} />
                </div>
              </Field>
              <Field label="Project type">
                <Select value={form.project_type ?? ''} onValueChange={v => set('project_type', v)}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>{PROJECT_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Budget (NPR)"><Input type="number" min="0" value={form.budget_npr ?? ''} onChange={e => set('budget_npr', e.target.value)} /></Field>
              <Field label="Funding committed (NPR)" hint="Total of all funding sources committed."><Input type="number" min="0" value={form.funding_committed_npr ?? ''} onChange={e => set('funding_committed_npr', e.target.value)} /></Field>
              <Field label="Estimated beneficiaries"><Input type="number" min="0" value={form.estimated_beneficiaries ?? ''} onChange={e => set('estimated_beneficiaries', e.target.value)} /></Field>
              <Field label="Implementing agency"><Input maxLength={200} value={form.implementing_agency ?? ''} onChange={e => set('implementing_agency', e.target.value)} /></Field>
              <Field label="Contractor"><Input maxLength={200} value={form.contractor ?? ''} onChange={e => set('contractor', e.target.value)} /></Field>
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
              <Field label="Start date"><Input type="date" value={form.start_date ?? ''} onChange={e => set('start_date', e.target.value)} /></Field>
              <Field label="Expected completion"><Input type="date" value={form.expected_completion ?? ''} onChange={e => set('expected_completion', e.target.value)} /></Field>
              <Field label="Physical progress (%)" hint="Manual entry. 0–100. Leave blank if unknown — AI analysis populates a separate reported_progress_percent field with a source citation.">
                <Input type="number" min="0" max="100" step="1" value={form.progress_percent ?? ''} onChange={e => set('progress_percent', e.target.value)} />
              </Field>
              <Field label="Progress stage label" hint='Short freeform label ("Foundation poured", "50% structural", "Punch-list").'>
                <Input maxLength={60} value={form.progress_stage ?? ''} onChange={e => set('progress_stage', e.target.value)} />
              </Field>
            </div>

            <Field label="Cover image" hint="Drag a file in, paste from clipboard, or click upload. Or paste a URL below.">
              <div className="space-y-2">
                <ImageDropzone value={form.cover_image_url ?? null} onChange={(url) => set('cover_image_url', url ?? '')} />
                <Input type="url" placeholder="…or paste a public image URL" value={form.cover_image_url ?? ''} onChange={e => set('cover_image_url', e.target.value)} />
              </div>
            </Field>

            <div className="space-y-2 border rounded-md p-3">
              <div className="flex items-center justify-between">
                <Label>Sources</Label>
                <Button type="button" size="sm" variant="outline" onClick={addSource}>+ Add another</Button>
              </div>
              <p className="text-xs text-muted-foreground">Paste links to news, government notices, or reports that back up the data above. At least one is helpful for review.</p>
              {sources.map((s, i) => (
                <div key={i} className="grid grid-cols-[1fr_auto] sm:grid-cols-2 md:grid-cols-[1fr_1fr_140px_auto] gap-2 items-start">
                  <Input className="col-span-2 sm:col-span-1 md:col-span-1" placeholder="https://…" type="url" value={s.url} onChange={e => setSource(i, { url: e.target.value })} />
                  <Input className="col-span-2 sm:col-span-1 md:col-span-1" placeholder="Source title" maxLength={200} value={s.title} onChange={e => setSource(i, { title: e.target.value })} />
                  <Select value={s.source_type} onValueChange={v => setSource(i, { source_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{SOURCE_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                  <Button type="button" size="sm" variant="ghost" onClick={() => removeSource(i)} aria-label="Remove source" className="text-muted-foreground hover:text-destructive" disabled={sources.length === 1}>
                    ×
                  </Button>
                </div>
              ))}
            </div>

            <SubmitDetailsSection value={details} onChange={setDetails} />

            <div className="flex gap-3 pt-2">
              <Button type="submit" disabled={loading} className="bg-accent hover:bg-accent/90 text-accent-foreground">
                {loading ? (isEdit ? 'Saving…' : 'Submitting…') : (isEdit ? 'Save & re-submit for review' : 'Submit for review')}
              </Button>
              <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
            </div>
          </form>
          )}
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
