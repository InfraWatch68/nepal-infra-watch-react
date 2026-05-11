// Collapsible "comprehensive details" block for the project submission form.
// Captures a handful of key fields per detail table (funding, documents,
// stakeholders, risks, impact, procurement, compliance). All optional —
// rows the contributor fills in get inserted alongside the project as
// `submitted_by_ai=false, approval_status='pending'` and pass through the
// usual review queue.
//
// Edit-mode shape: the parent loads any of this user's existing
// pending/changes_requested rows and re-passes them through `value`; on
// save the parent deletes prior rows and reinserts the current set.

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Wallet, FileText, Users, AlertTriangle, BarChart3, Gavel, ShieldCheck, Plus, X } from 'lucide-react';

// Enums copied from the migration file. Kept here (not in constants.ts) because
// they're only meaningful inside the submission form and admin moderation.
export const FUNDING_TYPES = ['government','multilateral','bilateral','private','loan','grant','equity','ppp','other'] as const;
export const DOC_TYPES = ['eia','iee','contract','tender','audit','progress_report','completion_report','blueprint','financial','press_release','legal','other'] as const;
export const STAKEHOLDER_ROLES = ['implementing_agency','executing_ministry','contractor','sub_contractor','consultant','donor','beneficiary','regulator','community','other'] as const;
export const RISK_CATEGORIES = ['financial','legal','environmental','social','political','technical','schedule','audit','corruption','other'] as const;
export const RISK_SEVERITIES = ['low','medium','high','critical'] as const;
export const IMPACT_METRIC_TYPES = ['beneficiaries','jobs_temporary','jobs_permanent','displacement','area_served_sq_km','households_served','co2_reduction_t','revenue_generated_npr','energy_capacity_mw','water_capacity_mld','other'] as const;
export const PROCUREMENT_STATUS = ['planned','published','bidding','evaluation','awarded','cancelled','disputed'] as const;
export const COMPLIANCE_ITEM_TYPES = ['eia','iee','land_acquisition','right_of_way','forest_clearance','social_impact','audit_oag','audit_ciaa','blacklist','court_case','other'] as const;
export const COMPLIANCE_STATUS = ['not_started','in_progress','approved','rejected','conditional','blacklisted','dismissed','pending'] as const;

export type DetailRow = Record<string, any>;
export type DetailsState = {
  funding: DetailRow[];
  documents: DetailRow[];
  stakeholders: DetailRow[];
  risks: DetailRow[];
  impact: DetailRow[];
  procurement: DetailRow[];
  compliance: DetailRow[];
};

export const emptyDetails = (): DetailsState => ({
  funding: [], documents: [], stakeholders: [],
  risks: [], impact: [], procurement: [], compliance: [],
});

export const blankRow = (kind: keyof DetailsState): DetailRow => {
  switch (kind) {
    case 'funding':      return { source_name: '', source_type: 'government', amount_npr: '', source_url: '' };
    case 'documents':    return { title: '', doc_type: 'other', url: '', source_org: '' };
    case 'stakeholders': return { org_name: '', role: 'implementing_agency', contact_email: '', website: '' };
    case 'risks':        return { title: '', severity: 'medium', category: 'other', description: '' };
    case 'impact':       return { metric_type: 'beneficiaries', metric_value: '', unit: '', notes: '' };
    case 'procurement':  return { tender_title: '', status: 'planned', awardee_name: '', contract_value_npr: '' };
    case 'compliance':   return { item_type: 'other', status: 'not_started', authority: '', finding: '' };
  }
};

// Strip empties on the way out, so we don't insert rows that have no
// identifying field. This is the per-row "is the user trying to submit
// anything here?" predicate.
export const hasContent = (kind: keyof DetailsState, row: DetailRow): boolean => {
  switch (kind) {
    case 'funding':      return !!row.source_name?.trim();
    case 'documents':    return !!row.title?.trim() && !!row.url?.trim();
    case 'stakeholders': return !!row.org_name?.trim();
    case 'risks':        return !!row.title?.trim();
    case 'impact':       return row.metric_value !== '' && row.metric_value != null;
    case 'procurement':  return !!row.tender_title?.trim();
    case 'compliance':   return !!row.item_type && !!row.status;
  }
};

// Convert the raw row to the shape the DB expects (number coercion, empty→null).
export const toDbRow = (kind: keyof DetailsState, row: DetailRow): DetailRow => {
  const out: DetailRow = {};
  for (const [k, v] of Object.entries(row)) {
    if (v === '' || v == null) continue;
    if (k.endsWith('_npr') || k === 'metric_value' || k === 'amount_npr' || k === 'baseline_value' || k === 'target_value' || k === 'contract_value_npr') {
      const n = Number(v);
      if (!Number.isNaN(n)) out[k] = n;
    } else {
      out[k] = typeof v === 'string' ? v.trim() : v;
    }
  }
  return out;
};

export function detailsForInsert(state: DetailsState): Record<keyof DetailsState, DetailRow[]> {
  const out = {} as Record<keyof DetailsState, DetailRow[]>;
  (Object.keys(state) as (keyof DetailsState)[]).forEach(k => {
    out[k] = state[k].filter(r => hasContent(k, r)).map(r => toDbRow(k, r));
  });
  return out;
}

type Props = {
  value: DetailsState;
  onChange: (next: DetailsState) => void;
};

export function SubmitDetailsSection({ value, onChange }: Props) {
  const update = (kind: keyof DetailsState, i: number, patch: DetailRow) =>
    onChange({ ...value, [kind]: value[kind].map((r, idx) => idx === i ? { ...r, ...patch } : r) });
  const add = (kind: keyof DetailsState) =>
    onChange({ ...value, [kind]: [...value[kind], blankRow(kind)] });
  const remove = (kind: keyof DetailsState, i: number) =>
    onChange({ ...value, [kind]: value[kind].filter((_, idx) => idx !== i) });

  const sectionMeta: Array<{ key: keyof DetailsState; label: string; icon: React.ComponentType<any>; hint: string }> = [
    { key: 'funding',      label: 'Funding sources',  icon: Wallet,        hint: 'Loans, grants, government allocation. Add a row per funder you know about.' },
    { key: 'documents',    label: 'Documents',        icon: FileText,      hint: 'EIA report, contract scan, audit, progress report — anything public.' },
    { key: 'stakeholders', label: 'Stakeholders',     icon: Users,         hint: 'Ministries, donors, consultants, sub-contractors.' },
    { key: 'risks',        label: 'Risks / issues',   icon: AlertTriangle, hint: 'Anything that could derail the project — land disputes, audits, court cases.' },
    { key: 'impact',       label: 'Impact metrics',   icon: BarChart3,     hint: 'Beneficiaries reached, jobs created, capacity added.' },
    { key: 'procurement',  label: 'Procurement / tenders', icon: Gavel,    hint: 'Tender notices, awards, contractors selected.' },
    { key: 'compliance',   label: 'Compliance',       icon: ShieldCheck,   hint: 'EIA approval, land clearance, court status, blacklist actions.' },
  ];

  const totalRows = Object.values(value).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="border rounded-md">
      <div className="px-3 py-2 border-b bg-muted/40">
        <Label className="text-sm font-semibold">Comprehensive details (optional)</Label>
        <p className="text-xs text-muted-foreground">
          Add what you know — leave blank what you don't. Each row passes through review separately.
          {totalRows > 0 && <span className="ml-1 font-mono">{totalRows} row{totalRows === 1 ? '' : 's'} drafted</span>}
        </p>
      </div>
      <Accordion type="multiple" className="px-3">
        {sectionMeta.map(({ key, label, icon: Icon, hint }) => {
          const rows = value[key];
          return (
            <AccordionItem key={key} value={key} className="border-b last:border-b-0">
              <AccordionTrigger className="py-3 hover:no-underline">
                <span className="flex items-center gap-2 text-sm">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  {label}
                  {rows.length > 0 && <span className="text-xs font-mono text-muted-foreground">({rows.length})</span>}
                </span>
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-3">
                <p className="text-xs text-muted-foreground">{hint}</p>
                {rows.map((row, i) => (
                  <div key={i} className="border rounded-md p-2 relative space-y-2 bg-secondary/30">
                    <Button type="button" size="icon" variant="ghost" aria-label="Remove row"
                      className="absolute top-1 right-1 h-6 w-6 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(key, i)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                    <RowFields kind={key} row={row} onChange={(patch) => update(key, i, patch)} />
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={() => add(key)}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add {label.toLowerCase().replace(/s$/, '').replace(/ \(.*$/, '')}
                </Button>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

export function RowFields({ kind, row, onChange }: { kind: keyof DetailsState; row: DetailRow; onChange: (patch: DetailRow) => void }) {
  const set = (k: string, v: any) => onChange({ [k]: v });
  switch (kind) {
    case 'funding':
      return (
        <div className="grid sm:grid-cols-[1fr_140px_1fr] gap-2">
          <Input placeholder="Source name (e.g. World Bank)" value={row.source_name ?? ''} onChange={e => set('source_name', e.target.value)} />
          <Select value={row.source_type} onValueChange={v => set('source_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{FUNDING_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" min="0" placeholder="Amount NPR" value={row.amount_npr ?? ''} onChange={e => set('amount_npr', e.target.value)} />
          <Input className="sm:col-span-3" placeholder="Source URL (optional)" value={row.source_url ?? ''} onChange={e => set('source_url', e.target.value)} />
        </div>
      );
    case 'documents':
      return (
        <div className="grid sm:grid-cols-[1fr_140px] gap-2">
          <Input placeholder="Document title" value={row.title ?? ''} onChange={e => set('title', e.target.value)} />
          <Select value={row.doc_type} onValueChange={v => set('doc_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{DOC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="sm:col-span-2" type="url" placeholder="Document URL (required)" value={row.url ?? ''} onChange={e => set('url', e.target.value)} />
          <Input className="sm:col-span-2" placeholder="Issuing organization (optional)" value={row.source_org ?? ''} onChange={e => set('source_org', e.target.value)} />
        </div>
      );
    case 'stakeholders':
      return (
        <div className="grid sm:grid-cols-[1fr_160px] gap-2">
          <Input placeholder="Organization name" value={row.org_name ?? ''} onChange={e => set('org_name', e.target.value)} />
          <Select value={row.role} onValueChange={v => set('role', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STAKEHOLDER_ROLES.map(r => <SelectItem key={r} value={r}>{r.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="sm:col-span-2" type="email" placeholder="Contact email (optional)" value={row.contact_email ?? ''} onChange={e => set('contact_email', e.target.value)} />
          <Input className="sm:col-span-2" placeholder="Website (optional)" value={row.website ?? ''} onChange={e => set('website', e.target.value)} />
        </div>
      );
    case 'risks':
      return (
        <div className="grid sm:grid-cols-[1fr_120px_140px] gap-2">
          <Input placeholder="Risk title (e.g. land dispute in Ward 5)" value={row.title ?? ''} onChange={e => set('title', e.target.value)} />
          <Select value={row.severity} onValueChange={v => set('severity', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{RISK_SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={row.category} onValueChange={v => set('category', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{RISK_CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
          </Select>
          <Textarea className="sm:col-span-3" rows={2} placeholder="Description (optional)" value={row.description ?? ''} onChange={e => set('description', e.target.value)} />
        </div>
      );
    case 'impact':
      return (
        <div className="grid sm:grid-cols-[1fr_140px_120px] gap-2">
          <Select value={row.metric_type} onValueChange={v => set('metric_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{IMPACT_METRIC_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
          <Input type="number" placeholder="Value" value={row.metric_value ?? ''} onChange={e => set('metric_value', e.target.value)} />
          <Input placeholder="Unit (optional)" value={row.unit ?? ''} onChange={e => set('unit', e.target.value)} />
          <Input className="sm:col-span-3" placeholder="Notes (optional)" value={row.notes ?? ''} onChange={e => set('notes', e.target.value)} />
        </div>
      );
    case 'procurement':
      return (
        <div className="grid sm:grid-cols-[1fr_140px] gap-2">
          <Input placeholder="Tender / contract title" value={row.tender_title ?? ''} onChange={e => set('tender_title', e.target.value)} />
          <Select value={row.status} onValueChange={v => set('status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{PROCUREMENT_STATUS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="sm:col-span-2" placeholder="Awardee (optional)" value={row.awardee_name ?? ''} onChange={e => set('awardee_name', e.target.value)} />
          <Input className="sm:col-span-2" type="number" min="0" placeholder="Contract value NPR (optional)" value={row.contract_value_npr ?? ''} onChange={e => set('contract_value_npr', e.target.value)} />
        </div>
      );
    case 'compliance':
      return (
        <div className="grid sm:grid-cols-[1fr_140px] gap-2">
          <Select value={row.item_type} onValueChange={v => set('item_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COMPLIANCE_ITEM_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={row.status} onValueChange={v => set('status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{COMPLIANCE_STATUS.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
          </Select>
          <Input className="sm:col-span-2" placeholder="Authority (optional, e.g. OAG)" value={row.authority ?? ''} onChange={e => set('authority', e.target.value)} />
          <Textarea className="sm:col-span-2" rows={2} placeholder="Finding (optional)" value={row.finding ?? ''} onChange={e => set('finding', e.target.value)} />
        </div>
      );
  }
}
