import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sparkles, Loader2, Download } from 'lucide-react';
import { exportComparisonReport } from '@/lib/exportPdf';
import { formatNPR } from '@/lib/parseCoords';
import { STATUS_LABELS } from '@/lib/constants';
import { toast } from 'sonner';

export default function Compare() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [projects, setProjects] = useState<any[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [aiText, setAiText] = useState<string>('');
  const [loadingAi, setLoadingAi] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    supabase.from('projects').select('*').eq('approval_status', 'approved').order('title')
      .then(({ data }) => setProjects(data ?? []));
  }, []);

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 4 ? [...s, id] : s);
  const chosen = projects.filter(p => selected.includes(p.id));

  const compareWithAi = async () => {
    if (!user) { setShowSignIn(true); return; }
    if (chosen.length < 2) return toast.error('Select at least 2 projects');
    setLoadingAi(true); setAiText('');
    try {
      const { data, error } = await supabase.functions.invoke('ai-project-insights', {
        body: { mode: 'compare', projectIds: selected }
      });
      if (error) throw error;
      setAiText(data.text);
    } catch (e: any) { toast.error(e.message ?? 'AI failed'); }
    finally { setLoadingAi(false); }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Side-by-side</p>
          <h1 className="font-display text-4xl font-bold">Compare projects</h1>
          <p className="text-muted-foreground mt-2">Select up to 4 projects to compare metrics, timelines, and AI-generated insights.</p>
        </div>
      </section>

      <div className="container py-8 grid lg:grid-cols-[300px_1fr] gap-8">
        <Card className="p-4 h-fit lg:sticky lg:top-20 max-h-[70vh] overflow-y-auto">
          <h3 className="font-semibold mb-3 text-sm">Pick projects ({selected.length}/4)</h3>
          <div className="space-y-2">
            {projects.map(p => (
              <label key={p.id} className="flex items-start gap-2 p-2 rounded hover:bg-muted cursor-pointer text-sm">
                <Checkbox checked={selected.includes(p.id)} onCheckedChange={() => toggle(p.id)} disabled={!selected.includes(p.id) && selected.length >= 4} />
                <span className="leading-tight">{p.title}<span className="block text-xs text-muted-foreground">{p.sector}</span></span>
              </label>
            ))}
          </div>
        </Card>

        <div className="space-y-6">
          {chosen.length === 0 ? (
            <Card className="p-12 text-center text-muted-foreground">Select projects on the left to compare.</Card>
          ) : (
            <>
              <Card className="overflow-x-auto">
                <table className="w-full text-sm min-w-[480px]">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 sm:p-3 font-semibold w-28 sm:w-40">Metric</th>
                      {chosen.map(p => <th key={p.id} className="text-left p-2 sm:p-3 font-semibold min-w-[140px]">{p.title}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['Sector', (p: any) => p.sector],
                      ['Province', (p: any) => p.province ?? '—'],
                      ['District', (p: any) => p.district ?? '—'],
                      ['Status', (p: any) => STATUS_LABELS[p.status]],
                      ['Budget', (p: any) => formatNPR(p.budget_npr)],
                      ['Progress', (p: any) => `${p.progress_percent ?? 0}%`],
                      ['Contractor', (p: any) => p.contractor ?? '—'],
                      ['Agency', (p: any) => p.implementing_agency ?? '—'],
                      ['Start', (p: any) => p.start_date ?? '—'],
                      ['Completion', (p: any) => p.expected_completion ?? '—'],
                    ].map(([label, fn]: any) => (
                      <tr key={label} className="border-t">
                        <td className="p-2 sm:p-3 text-muted-foreground font-mono text-[10px] sm:text-xs uppercase tracking-wider">{label}</td>
                        {chosen.map(p => <td key={p.id} className="p-2 sm:p-3 break-words">{fn(p)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card className="p-5 border-accent/30 bg-accent/5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent" />
                    <h3 className="font-semibold">AI comparison</h3>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => exportComparisonReport(chosen, aiText)} disabled={!aiText}>
                      <Download className="h-4 w-4" /> Export PDF
                    </Button>
                    <Button size="sm" onClick={compareWithAi} disabled={loadingAi || chosen.length < 2}>
                      {loadingAi ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate insight'}
                    </Button>
                  </div>
                </div>
                {aiText ? <p className="text-sm whitespace-pre-wrap leading-relaxed">{aiText}</p> :
                  <p className="text-sm text-muted-foreground italic">Generate an AI-written comparison highlighting differences in scope, budget efficiency, and timeline risk.</p>}
              </Card>
            </>
          )}
        </div>
      </div>
      <SiteFooter />

      <Dialog open={showSignIn} onOpenChange={setShowSignIn}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign in required</DialogTitle>
            <DialogDescription>
              You need to sign in to use AI features. Create a free account or log in to generate insights and export PDFs.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-2">
            <Button onClick={() => { setShowSignIn(false); navigate('/auth'); }}>
              Sign in / Sign up
            </Button>
            <Button variant="ghost" onClick={() => setShowSignIn(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
