import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

type AnalysisJobRow = {
  id: string;
  project_id: number;
  run_id: string;
  status: string;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  attempts: number;
  last_error: string | null;
  since_date?: string | null;
  projects: { id: number; title: string; slug: string | null } | null;
};

const ACTIVE_STATUSES = ['queued', 'running'];
const RECENT_STATUSES = ['succeeded', 'failed', 'cancelled'];

const statusClass = (status: string) => {
  if (status === 'queued') return 'border-warning/40 text-warning bg-warning/5';
  if (status === 'running') return 'border-info/40 text-info bg-info/5';
  if (status === 'succeeded') return 'border-success/40 text-success bg-success/5';
  if (status === 'failed') return 'border-destructive/40 text-destructive bg-destructive/5';
  if (status === 'cancelled') return 'border-muted-foreground/40 text-muted-foreground bg-muted/50';
  return 'border-border text-muted-foreground';
};

const fmtDate = (iso?: string | null) => {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const fmtDuration = (start?: string | null, end?: string | null) => {
  if (!start) return '-';
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs < startMs) return '-';
  const totalSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes % 60;
    return `${hours}h ${remMinutes}m`;
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
};

const shortError = (value: string | null) => {
  if (!value) return '-';
  return value.length > 60 ? `${value.slice(0, 60)}...` : value;
};

async function loadJobs() {
  const [active, recent] = await Promise.all([
    supabase
      .from('analysis_jobs')
      .select('id, project_id, run_id, status, enqueued_at, started_at, finished_at, attempts, last_error, since_date, projects(id, title, slug)')
      .in('status', ACTIVE_STATUSES)
      .order('enqueued_at', { ascending: true }),
    supabase
      .from('analysis_jobs')
      .select('id, project_id, run_id, status, enqueued_at, started_at, finished_at, attempts, last_error, since_date, projects(id, title, slug)')
      .in('status', RECENT_STATUSES)
      .order('finished_at', { ascending: false, nullsFirst: false })
      .order('enqueued_at', { ascending: false })
      .limit(30),
  ]);

  if (active.error) throw active.error;
  if (recent.error) throw recent.error;

  return {
    active: (active.data ?? []) as AnalysisJobRow[],
    recent: (recent.data ?? []) as AnalysisJobRow[],
  };
}

function StatusPill({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={cn('text-[10px] uppercase tracking-wider font-mono shrink-0', statusClass(status))}>
      {status}
    </Badge>
  );
}

function ProjectLink({ job }: { job: AnalysisJobRow }) {
  const title = job.projects?.title ?? `Project #${job.project_id}`;
  const slug = job.projects?.slug;
  return (
    <Link to={`/projects/${slug ?? job.project_id}`} className="font-medium hover:underline underline-offset-2 truncate">
      {title}
    </Link>
  );
}

function ErrorCell({ error }: { error: string | null }) {
  if (!error) return <span className="text-muted-foreground">-</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-block max-w-[220px] truncate text-destructive cursor-help">
          {shortError(error)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
        {error}
      </TooltipContent>
    </Tooltip>
  );
}

function DesktopRows({ jobs }: { jobs: AnalysisJobRow[] }) {
  return (
    <div className="hidden sm:block">
      <div className="grid grid-cols-[minmax(180px,1.4fr)_92px_120px_120px_90px_minmax(120px,1fr)] gap-3 px-3 py-2 text-[10px] uppercase tracking-wider font-mono text-muted-foreground border-b">
        <div>Project</div>
        <div>Status</div>
        <div>Since</div>
        <div>Enqueued</div>
        <div>Duration</div>
        <div>Error</div>
      </div>
      <div className="divide-y">
        {jobs.map(job => (
          <div key={job.id} className="grid grid-cols-[minmax(180px,1.4fr)_92px_120px_120px_90px_minmax(120px,1fr)] gap-3 px-3 py-2.5 text-xs items-center">
            <ProjectLink job={job} />
            <StatusPill status={job.status} />
            <div className="text-muted-foreground font-mono">{fmtDate(job.since_date)}</div>
            <div className="text-muted-foreground font-mono">{fmtDate(job.enqueued_at)}</div>
            <div className="text-muted-foreground font-mono">{fmtDuration(job.enqueued_at, job.finished_at)}</div>
            <ErrorCell error={job.last_error} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MobileRows({ jobs }: { jobs: AnalysisJobRow[] }) {
  return (
    <div className="sm:hidden divide-y">
      {jobs.map(job => (
        <div key={job.id} className="p-3 space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <ProjectLink job={job} />
              <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                enqueued {fmtDate(job.enqueued_at)}
              </div>
            </div>
            <StatusPill status={job.status} />
          </div>
          {job.last_error && <div className="text-xs"><ErrorCell error={job.last_error} /></div>}
        </div>
      ))}
    </div>
  );
}

function JobSection({ title, jobs, emptyText }: { title: string; jobs: AnalysisJobRow[]; emptyText: string }) {
  return (
    <section className="rounded-md border bg-background overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-muted/30">
        <h4 className="text-sm font-semibold">{title}</h4>
        <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">{jobs.length} job{jobs.length === 1 ? '' : 's'}</span>
      </div>
      {jobs.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground">{emptyText}</div>
      ) : (
        <ScrollArea className="h-[480px]">
          <DesktopRows jobs={jobs} />
          <MobileRows jobs={jobs} />
        </ScrollArea>
      )}
    </section>
  );
}

export function AnalysisJobsMonitor() {
  const { data, error, isFetching, refetch } = useQuery({
    queryKey: ['admin-analysis-jobs'],
    queryFn: loadJobs,
    refetchInterval: 10_000,
  });

  useEffect(() => {
    if (error) toast.error(error.message);
  }, [error]);

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold">Analysis jobs</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Queue monitor for project analysis runs. Refreshes every 10 seconds.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1', isFetching && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <JobSection
          title="Active"
          jobs={data?.active ?? []}
          emptyText="No queued or running analysis jobs."
        />
        <JobSection
          title="Recently completed"
          jobs={data?.recent ?? []}
          emptyText="No completed, failed, or cancelled analysis jobs yet."
        />
      </div>
    </Card>
  );
}
