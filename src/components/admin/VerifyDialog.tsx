import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ShieldCheck, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Report = {
  ok: boolean;
  confidence: 'high' | 'medium' | 'low';
  summary: string;
  supported: string[];
  unsupported: string[];
  contradicted: Array<{ claim: string; evidence: string; source_url: string }>;
  missing_data: string[];
  sources_checked?: number;
  warnings?: string[];
};

const CONFIDENCE_CLASSES: Record<string, string> = {
  high:   'bg-success/15 text-success border-success/40',
  medium: 'bg-warning/15 text-warning border-warning/40',
  low:    'bg-destructive/15 text-destructive border-destructive/40',
};

export function VerifyDialog({ projectId, projectTitle }: { projectId: string | number; projectTitle: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);

  const run = async () => {
    setBusy(true); setReport(null);
    const { data, error } = await supabase.functions.invoke('ai-verify-project', {
      body: { projectId: Number(projectId) },
    });
    setBusy(false);
    if (error) { toast.error(error.message ?? 'Verify failed'); return; }
    setReport(data as Report);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (v && !report && !busy) run(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <ShieldCheck className="h-4 w-4" /> AI verify
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>AI verification: {projectTitle}</DialogTitle>
        </DialogHeader>
        {busy ? (
          <div className="py-12 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto" /><p className="text-xs text-muted-foreground mt-2">Cross-checking against news + government sources…</p></div>
        ) : !report ? (
          <p className="text-sm text-muted-foreground">No report yet.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={cn('uppercase font-mono text-[10px] tracking-wider', CONFIDENCE_CLASSES[report.confidence] ?? CONFIDENCE_CLASSES.low)}>
                {report.confidence} confidence
              </Badge>
              {report.sources_checked != null && (
                <span className="text-xs text-muted-foreground font-mono">{report.sources_checked} sources checked</span>
              )}
            </div>
            <p className="leading-relaxed">{report.summary}</p>

            <Section title="Supported claims" items={report.supported} kind="ok" />
            <Section title="Unsupported claims" items={report.unsupported} kind="warn" />
            <Section title="Missing important data from sources" items={report.missing_data} kind="info" />

            {report.contradicted?.length > 0 && (
              <div>
                <h4 className="font-semibold text-xs uppercase tracking-wider mb-1.5 text-destructive">Contradicted claims</h4>
                <ul className="space-y-2">
                  {report.contradicted.map((c, i) => (
                    <li key={i} className="border-l-4 border-destructive bg-destructive/5 rounded-r p-2.5">
                      <div className="font-medium">{c.claim}</div>
                      <div className="text-xs text-muted-foreground mt-1">Evidence: {c.evidence}</div>
                      {c.source_url && (
                        <a href={c.source_url} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline inline-flex items-center gap-1 mt-1">
                          Source <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {report.warnings && report.warnings.length > 0 && (
              <div className="text-xs text-muted-foreground border-t pt-2">
                {report.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <Button size="sm" variant="outline" onClick={run} disabled={busy}>Re-verify</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, items, kind }: { title: string; items: string[]; kind: 'ok' | 'warn' | 'info' }) {
  if (!items || items.length === 0) return null;
  const color = kind === 'ok' ? 'text-success' : kind === 'warn' ? 'text-warning' : 'text-info';
  return (
    <div>
      <h4 className={cn('font-semibold text-xs uppercase tracking-wider mb-1.5', color)}>{title}</h4>
      <ul className="space-y-1 list-disc list-inside text-sm text-foreground">
        {items.map((s, i) => <li key={i}>{s}</li>)}
      </ul>
    </div>
  );
}
