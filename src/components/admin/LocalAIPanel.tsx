// Local AI tools — admin-facing card that mirrors the website's built-in AI
// tools (Discover / Go Live / Analyze / Brief / Fetch news / Verify) but
// routes the work through the moderator's own Claude.ai or ChatGPT
// subscription instead of burning Tavily + Mistral free-tier credits.
//
// Workflow: pick a tool, fill the inputs, click "Copy prompt". The
// clipboard now holds a self-contained prompt the moderator pastes into
// their AI tool. The AI does the web research and writes directly to
// Supabase via the embedded service-role key. If the AI can't make HTTPS
// calls, it returns a JSON block instead — paste it into the textarea at
// the bottom and the website applies it via the admin's authenticated
// session.
//
// The whole panel collapses to a single header by default so the admin
// page isn't dominated by it. Click the header to open.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Sparkles, Copy, Eye, EyeOff, AlertTriangle, ChevronDown, ChevronRight,
  ClipboardPaste, Wand2, Check, Radio, Lock, History, Trash2, Activity,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SECTORS, PROVINCES } from "@/lib/constants";
import { supabase } from "@/integrations/supabase/client";
import {
  buildLocalAiPrompt,
  LOCAL_AI_TASKS,
  type LocalAiInput,
  type LocalAiProjectRef,
  type LocalAiTask,
} from "@/lib/localAiPrompt";

const KEY_STORAGE = "niw_local_ai_service_key";
const BATCH_HISTORY_STORAGE = "niw_local_ai_batches";
const MAX_BATCH_HISTORY = 20;

// Tables the AI writes into during any workflow. Used by the rollback button
// to find every row carrying a given batch tag and bulk-reject it.
const ROLLBACK_TABLES = [
  "projects", "project_sources", "project_updates", "project_milestones",
  "project_funding", "project_documents", "project_stakeholders",
  "project_risks", "project_impact", "project_procurement",
  "project_compliance", "global_briefs",
] as const;

// 8-hex batch id, generated client-side. Same shape buildLocalAiPrompt uses
// when no batchId is passed in — we generate here and pass it in so we can
// remember it for the history list.
function genBatchId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

// Snapshot of mutable shared state captured at the moment Copy-prompt fires.
// On rollback the panel restores this so a malfunctioning workflow's side
// effects (cursor advances, in-flight flags) get reverted, not just its
// data-table inserts. Only Go Live captures one today (it's the only
// workflow that mutates shared state); the field stays optional so other
// tasks don't pay any cost.
type GoLiveStateSnapshot = {
  last_province: string | null;
  last_district: string | null;
  last_sector: string | null;
  last_advanced_by: string | null;
  last_advanced_at: string | null;
  enqueued_count: number | null;
  golive_session_id: string | null;
  golive_started_at: string | null;
  livecheck_session_id: string | null;
  livecheck_started_at: string | null;
};

type BatchEntry = {
  batchId: string;
  task: LocalAiTask;
  label: string;
  copiedAt: string;  // ISO
  preSnapshot?: { sherlock_live_state?: GoLiveStateSnapshot };
};

// LocalStorage-backed batch history. Survives reloads but is per-browser, so
// if the admin re-runs from a different machine they won't see the old
// batches there. Cap at MAX_BATCH_HISTORY so the list stays scannable.
function loadBatchHistory(): BatchEntry[] {
  try {
    const raw = localStorage.getItem(BATCH_HISTORY_STORAGE);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_BATCH_HISTORY) : [];
  } catch { return []; }
}
function saveBatchHistory(entries: BatchEntry[]) {
  try {
    localStorage.setItem(BATCH_HISTORY_STORAGE, JSON.stringify(entries.slice(0, MAX_BATCH_HISTORY)));
  } catch { /* localStorage may be disabled */ }
}

// ── Project list cached at panel level so each workflow row that needs the
// project picker doesn't re-fetch. Approved projects sort first (those are
// the ones moderators actually run analysis on), then everything else by
// recency. Hard cap at 500 — the picker has search, so capacity is fine.
type ProjectRow = {
  id: number;
  slug: string;
  title: string;
  sector: string | null;
  province: string | null;
  approval_status: string;
  last_comprehensive_analysis_at: string | null;  // ISO timestamp; null = never analyzed
};

// Per-workflow claim — what the panel mutex actually keys off now. Go Live
// and Live Check each get their own column on sherlock_live_state, so they
// can coexist; only same-workflow second-starts are locked out.
type LiveClaims = {
  goLive: { sessionId: string; startedAt: string | null } | null;
  liveCheck: { sessionId: string; startedAt: string | null } | null;
};
const EMPTY_CLAIMS: LiveClaims = { goLive: null, liveCheck: null };

export function LocalAIPanel() {
  const [open, setOpen] = useState(false);
  const [serviceKey, setServiceKey] = useState<string>("");
  const [showKey, setShowKey] = useState(false);
  const [keyOpen, setKeyOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [claims, setClaims] = useState<LiveClaims>(EMPTY_CLAIMS);
  const [batchHistory, setBatchHistory] = useState<BatchEntry[]>(() => loadBatchHistory());
  const anyActive = !!claims.goLive || !!claims.liveCheck;

  // Hydrate the saved service-role key from localStorage on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY_STORAGE);
      if (saved) setServiceKey(saved);
    } catch { /* localStorage may be disabled */ }
  }, []);

  // Only fetch the project list once the admin actually expands the panel.
  useEffect(() => {
    if (!open || projects.length > 0 || projectsLoading) return;
    setProjectsLoading(true);
    supabase.from("projects")
      .select("id, slug, title, sector, province, approval_status, last_comprehensive_analysis_at")
      .order("approval_status", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        setProjects((data ?? []) as ProjectRow[]);
        setProjectsLoading(false);
      });
  }, [open, projects.length, projectsLoading]);

  // Per-workflow mutex — reads the two session columns on
  // sherlock_live_state. Go Live and Live Check each have their own column;
  // they don't block each other, only a same-workflow second-start locks.
  //
  // Stale detection: if the AI dies externally (admin kills the terminal,
  // tab close, host crash), its release-the-column step never runs. The
  // claim column would stay set forever, leaving a "Stop" button for a
  // session that's gone. Each prompt now PATCHes a heartbeat column on
  // every cell/cycle, so we treat heartbeat-older-than-5min as "the AI
  // is gone" and clear the claim automatically.
  const STALE_HEARTBEAT_MS = 5 * 60 * 1000;
  const refreshClaims = useCallback(async () => {
    const { data } = await supabase.from("sherlock_live_state")
      .select("golive_session_id, golive_started_at, golive_heartbeat_at, livecheck_session_id, livecheck_started_at, livecheck_heartbeat_at")
      .eq("id", 1).maybeSingle();
    const r: any = data;
    const now = Date.now();

    const checkStale = async (col: "golive" | "livecheck") => {
      const sid = r?.[`${col}_session_id`];
      if (!sid) return null;
      const hb = r?.[`${col}_heartbeat_at`];
      const startedAt = r?.[`${col}_started_at`];
      // First heartbeat may not have landed yet within the first 60s of a
      // run — use started_at as fallback. After that, heartbeat is the
      // authoritative liveness signal.
      const ageMs = now - new Date(hb ?? startedAt ?? 0).getTime();
      if (Number.isFinite(ageMs) && ageMs > STALE_HEARTBEAT_MS) {
        // Auto-clear stale claim. Returns null so the UI hides the banner.
        await supabase.from("sherlock_live_state")
          .update({ [`${col}_session_id`]: null, updated_at: new Date().toISOString() } as any)
          .eq("id", 1);
        toast.message(`Auto-cleared stale ${col === "golive" ? "Go Live" : "Live Check"} session — no heartbeat for ${Math.round(ageMs / 60000)}m. The AI process appears to have died externally.`);
        return null;
      }
      return { sessionId: sid, startedAt: startedAt ?? null };
    };

    const [goLive, liveCheck] = await Promise.all([
      checkStale("golive"),
      checkStale("livecheck"),
    ]);
    setClaims({ goLive, liveCheck });
  }, []);

  useEffect(() => {
    if (!open) return;
    refreshClaims();
    // Realtime picks up the AI's normal PATCHes. But when the AI dies
    // externally there are no more PATCHes — nothing to listen for —
    // so we also re-check every 60s to catch stale heartbeats.
    const ch = supabase.channel("local-ai-claims")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "sherlock_live_state", filter: "id=eq.1" }, () => refreshClaims())
      .subscribe();
    const tick = window.setInterval(() => { refreshClaims(); }, 60_000);
    return () => { supabase.removeChannel(ch); window.clearInterval(tick); };
  }, [open, refreshClaims]);

  // Record a fresh batch in history. Called by WorkflowRow's copyPrompt.
  const recordBatch = useCallback((entry: BatchEntry) => {
    setBatchHistory(prev => {
      const next = [entry, ...prev].slice(0, MAX_BATCH_HISTORY);
      saveBatchHistory(next);
      return next;
    });
  }, []);

  const saveKey = () => {
    const v = serviceKey.trim();
    try {
      if (v) {
        localStorage.setItem(KEY_STORAGE, v);
        toast.success("Service-role key saved locally");
      } else {
        localStorage.removeItem(KEY_STORAGE);
        toast.success("Service-role key cleared");
      }
    } catch { toast.error("Couldn't write to localStorage"); }
  };

  const keyPreview = useMemo(() => {
    if (!serviceKey) return "";
    if (showKey) return serviceKey;
    return serviceKey.length <= 12 ? "•".repeat(serviceKey.length) : serviceKey.slice(0, 12) + "•".repeat(20);
  }, [serviceKey, showKey]);

  return (
    <Card className="p-0 border-accent/30 bg-accent/5 overflow-hidden">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="w-full text-left px-5 py-4 flex items-center justify-between gap-3 hover:bg-accent/10 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <Wand2 className="h-4 w-4 text-accent shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                Local AI tools
                <span className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
                  · click to {open ? "collapse" : "expand"}
                </span>
              </h3>
              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                Run the website's AI workflows in <strong>your</strong> Claude.ai or ChatGPT subscription instead of burning the website's Tavily + Mistral credits.
              </p>
            </div>
          </div>
          <span className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-t border-accent/20">
          <div className="p-5 space-y-4">
            <p className="text-xs text-muted-foreground">
              Same workflows as the website's built-in AI tools — Discover,
              Go Live, Analyze, Brief, Fetch news, Verify. Pick a tool, fill
              the inputs, click <span className="font-mono">Copy prompt</span>,
              paste into your AI. The AI writes the result back to Supabase
              via the embedded credentials; if it can't make HTTPS calls,
              paste the JSON it returns into the box at the bottom and the
              website applies it locally.
            </p>

            {/* ── Service-role key setup ──────────────────────────────────── */}
            <div className="rounded-md border border-warning/40 bg-warning/5 p-3 space-y-2">
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 text-left"
                onClick={() => setKeyOpen(o => !o)}
              >
                <span className="text-xs font-semibold flex items-center gap-2">
                  {keyOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <AlertTriangle className="h-3.5 w-3.5 text-warning" />
                  Supabase service-role key {serviceKey
                    ? <span className="text-success font-mono text-[10px] uppercase ml-2">set</span>
                    : <span className="text-destructive font-mono text-[10px] uppercase ml-2">not set</span>}
                </span>
                <span className="text-[10px] text-muted-foreground">{serviceKey ? "saved in this browser only" : "needed for direct writes"}</span>
              </button>
              {keyOpen && (
                <div className="space-y-2">
                  <p className="text-[11px] text-muted-foreground">
                    Substituted into the prompt's <span className="font-mono">&lt;SERVICE_ROLE_KEY&gt;</span> placeholder
                    right before copying. Stored only in your browser's localStorage.
                  </p>
                  <p className="text-[11px] text-warning font-mono">
                    ⚠ Use the <strong>JWT-format service_role key</strong> (starts with <span className="font-mono">eyJ</span>),
                    NOT the <span className="font-mono">sb_secret_</span> one. Supabase rejects sb_secret_ keys
                    with HTTP 401 "Forbidden use of secret API key in browser" when called from Claude.ai / ChatGPT / subagent runtimes.
                    Find the JWT key at Supabase Dashboard → Project Settings → API → service_role.
                  </p>
                  {serviceKey.startsWith("sb_secret_") && (
                    <p className="text-[11px] text-destructive font-semibold bg-destructive/10 border border-destructive/40 rounded px-2 py-1">
                      The key you've saved starts with <span className="font-mono">sb_secret_</span> — that will fail at runtime. Paste the JWT-format <span className="font-mono">eyJ...</span> key instead.
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    <Input
                      type={showKey ? "text" : "password"}
                      value={showKey ? serviceKey : keyPreview}
                      onChange={(e) => setServiceKey(e.target.value)}
                      placeholder="sb_secret_…"
                      className="font-mono text-xs"
                      autoComplete="off"
                      spellCheck={false}
                    />
                    <Button
                      size="sm" variant="outline" className="h-9 px-2"
                      onClick={() => setShowKey(s => !s)}
                      aria-label={showKey ? "Hide key" : "Show key"}
                    >
                      {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" onClick={saveKey}>Save</Button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Active-session banners (one per running long workflow) ── */}
            {anyActive && <ActiveSessionsBanner claims={claims} />}

            {/* ── Auto-analysis toggle (controls the website trigger) ─────── */}
            <AutoAnalysisToggleCard />

            {/* ── Workflow rows ───────────────────────────────────────────── */}
            <div className="space-y-3">
              {LOCAL_AI_TASKS.map(t => {
                // Per-workflow Copy lock — only blocks the same workflow.
                // Go Live and Live Check can run in parallel; the rest of
                // the workflows never lock.
                const copyDisabled =
                  (t.key === "go-live" && !!claims.goLive) ||
                  (t.key === "live-check" && !!claims.liveCheck);
                return (
                  <WorkflowRow
                    key={t.key}
                    task={t.key}
                    label={t.label}
                    blurb={t.blurb}
                    serviceKey={serviceKey}
                    projects={projects}
                    projectsLoading={projectsLoading}
                    copyDisabled={copyDisabled}
                    onCopied={recordBatch}
                  />
                );
              })}
            </div>

            {/* ── Recent batches (with rollback) ──────────────────────────── */}
            <BatchHistoryBlock
              entries={batchHistory}
              onCleared={() => { setBatchHistory([]); saveBatchHistory([]); }}
              onRemoved={(batchId) => {
                setBatchHistory(prev => {
                  const next = prev.filter(b => b.batchId !== batchId);
                  saveBatchHistory(next);
                  return next;
                });
              }}
            />

            {/* ── Paste-back fallback ─────────────────────────────────────── */}
            <PasteBackBlock />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Workflow row — one per task. Holds task-specific input state.
function WorkflowRow({ task, label, blurb, serviceKey, projects, projectsLoading, copyDisabled, onCopied }: {
  task: LocalAiTask;
  label: string;
  blurb: string;
  serviceKey: string;
  projects: ProjectRow[];
  projectsLoading: boolean;
  copyDisabled: boolean;
  onCopied: (entry: BatchEntry) => void;
}) {
  // Single-cell discover.
  const [sector, setSector] = useState<string>("");
  const [province, setProvince] = useState<string>("");
  // Single-project (fetch-news, verify) — direct text input as before.
  const [slug, setSlug] = useState<string>("");
  // Brief.
  const [scope, setScope] = useState<"global" | "province" | "sector">("global");
  const [scopeValue, setScopeValue] = useState<string>("");
  // Analyze: multi-select project ids (as strings).
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  // Go Live: multi-select provinces / sectors plus a few toggles.
  const [glProvinces, setGlProvinces] = useState<Set<string>>(new Set(PROVINCES));
  const [glSectors, setGlSectors] = useState<Set<string>>(new Set(SECTORS));
  const [glPerCellMax, setGlPerCellMax] = useState<number>(3);
  const [glBudget, setGlBudget] = useState<number>(30);
  const [glIncludeDistricts, setGlIncludeDistricts] = useState<boolean>(false);
  const [glNationalPride, setGlNationalPride] = useState<boolean>(false);
  const [glStartFresh, setGlStartFresh] = useState<boolean>(false);
  // Cursor + who-last-touched-it. Reads from the shared sherlock_live_state
  // row (which the server cron AND local sessions both write to) so the
  // panel shows true cross-mode progress.
  const [glCheckpoint, setGlCheckpoint] = useState<{
    sector: string;
    province: string;
    district: string | null;
    cellsTotal: number;
    advancedBy: "server" | "local" | null;
    advancedAt: string | null;
    serverLocalActive: boolean;  // sherlock_live_state.local_session_id is set
  } | null>(null);
  // Live Check loop bounds.
  const [lcCycles, setLcCycles] = useState<number>(60);
  const [lcIntervalSec, setLcIntervalSec] = useState<number>(60);

  // Checkpoint discovery — only runs for the Go Live row. Now primary
  // source is sherlock_live_state (id=1) which BOTH the server cron and
  // local sessions write to. So if the server cron last advanced the
  // cursor, this picks that up too. Falls back to scanning local-golive
  // sherlock_jobs only if state is empty (first-time admins).
  useEffect(() => {
    if (task !== "go-live") return;
    let cancelled = false;
    (async () => {
      // Primary: shared state row.
      const stateRow = await supabase.from("sherlock_live_state")
        .select("last_province, last_district, last_sector, last_advanced_by, last_advanced_at, enqueued_count, golive_session_id")
        .eq("id", 1).maybeSingle();
      const st: any = stateRow.data;
      if (st && (st.last_sector || st.last_province)) {
        if (cancelled) return;
        setGlCheckpoint({
          sector: st.last_sector ?? "?",
          province: st.last_province ?? "?",
          district: st.last_district ?? null,
          cellsTotal: typeof st.enqueued_count === "number" ? st.enqueued_count : 0,
          advancedBy: (st.last_advanced_by as "server" | "local" | null) ?? null,
          advancedAt: st.last_advanced_at ?? null,
          serverLocalActive: !!st.golive_session_id,  // another Go Live is in flight
        });
        return;
      }
      // Fallback: most recent local-golive sherlock_jobs row.
      const [lastRow, totalRow] = await Promise.all([
        supabase.from("sherlock_jobs")
          .select("params, finished_at")
          .like("params->>ai_source", "%-golive-%")
          .eq("status", "done")
          .gt("inserted", 0)
          .order("finished_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("sherlock_jobs")
          .select("id", { count: "exact", head: true })
          .like("params->>ai_source", "%-golive-%")
          .eq("status", "done"),
      ]);
      if (cancelled) return;
      const row: any = lastRow.data;
      if (!row?.params) { setGlCheckpoint(null); return; }
      const sec = Array.isArray(row.params.sectors) ? row.params.sectors[0] : null;
      const prov = row.params.province ?? null;
      if (!sec || !prov) { setGlCheckpoint(null); return; }
      setGlCheckpoint({
        sector: sec,
        province: prov,
        district: row.params.district ?? null,
        cellsTotal: totalRow.count ?? 0,
        advancedBy: "local",
        advancedAt: row.finished_at ?? null,
        serverLocalActive: false,
      });
    })();
    return () => { cancelled = true; };
  }, [task]);

  const selectedProjects: LocalAiProjectRef[] = useMemo(() => {
    if (selectedProjectIds.size === 0) return [];
    const byId = new Map(projects.map(p => [String(p.id), p]));
    return [...selectedProjectIds]
      .map(id => byId.get(id))
      .filter((p): p is ProjectRow => !!p)
      .map(p => ({ id: p.id, slug: p.slug, title: p.title, sector: p.sector, province: p.province }));
  }, [selectedProjectIds, projects]);

  const copyPrompt = async () => {
    // Fresh batch id per Copy click. The panel keeps these in localStorage
    // history so the admin can roll back a bad session by tag prefix later.
    const batchId = genBatchId();
    const input: LocalAiInput = {
      serviceRoleKey: serviceKey,
      batchId,
      sector: sector || undefined,
      province: province || undefined,
      projectSlugOrId: slug.trim() || undefined,
      projects: selectedProjects.length > 0 ? selectedProjects : undefined,
      scope,
      scopeValue: scopeValue || undefined,
      goLiveProvinces: [...glProvinces],
      goLiveSectors: [...glSectors],
      goLivePerCellMax: glPerCellMax,
      goLiveBudget: glBudget,
      goLiveIncludeDistricts: glIncludeDistricts,
      goLiveNationalPride: glNationalPride,
      // Resume cursor is honoured only if Start Fresh is off AND we have one.
      goLiveResumeFrom: (!glStartFresh && glCheckpoint)
        ? { sector: glCheckpoint.sector, province: glCheckpoint.province }
        : null,
      liveCheckCycles: lcCycles,
      liveCheckIntervalSec: lcIntervalSec,
    };
    if (task === "analyze" && selectedProjects.length === 0) {
      toast.error("Pick at least one project before copying the Analyze prompt.");
      return;
    }

    // Pre-snapshot for Go Live — capture sherlock_live_state cursor + counter
    // so a rollback can fully revert the AI's cursor advancements. Skipped
    // for other workflows that don't mutate shared state.
    let preSnapshot: BatchEntry["preSnapshot"] = undefined;
    if (task === "go-live") {
      const { data } = await supabase.from("sherlock_live_state")
        .select("last_province, last_district, last_sector, last_advanced_by, last_advanced_at, enqueued_count, golive_session_id, golive_started_at, livecheck_session_id, livecheck_started_at")
        .eq("id", 1)
        .maybeSingle();
      if (data) preSnapshot = { sherlock_live_state: data as GoLiveStateSnapshot };
    }

    const prompt = buildLocalAiPrompt(task, input);
    try {
      await navigator.clipboard.writeText(prompt);
      const charsK = (prompt.length / 1000).toFixed(1);
      toast.success(`Copied ${label} prompt (${charsK}KB, batch ${batchId}) — paste into Claude.ai or ChatGPT`);
      onCopied({ batchId, task, label, copiedAt: new Date().toISOString(), preSnapshot });
    } catch {
      toast.error("Clipboard write failed — your browser may have blocked it");
    }
  };

  return (
    <div className="rounded-md border bg-background p-3 space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold flex items-center gap-2">
            {task === "go-live" ? <Radio className="h-3.5 w-3.5 text-accent" /> : <Sparkles className="h-3.5 w-3.5 text-accent" />}
            {label}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{blurb}</p>
        </div>
        <Button
          size="sm" variant="outline"
          onClick={copyPrompt}
          className="shrink-0"
          disabled={copyDisabled}
          title={copyDisabled ? "A local-AI workflow is already in flight. Wait for it to finish to avoid two AIs writing the same project at once." : undefined}
        >
          {copyDisabled
            ? <><Lock className="h-3.5 w-3.5 mr-1" /> Locked</>
            : <><Copy className="h-3.5 w-3.5 mr-1" /> Copy prompt</>}
        </Button>
      </div>

      {/* Task-specific input controls. */}
      {task === "discover" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Sector (optional)</Label>
            <Select value={sector} onValueChange={(v) => setSector(v === "__any" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any sector" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Any sector</SelectItem>
                {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Province (optional)</Label>
            <Select value={province} onValueChange={(v) => setProvince(v === "__any" ? "" : v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any province" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__any">Any province</SelectItem>
                {PROVINCES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {task === "go-live" && (
        <div className="space-y-2">
          {/* Cross-mode "active" warning — shown when sherlock_live_state has
              a local_session_id set (i.e. a local Go Live or Live Check
              session is currently running). The Stop button nulls the
              session id, which the AI checks before each cell/cycle and
              exits gracefully. */}
          {glCheckpoint?.serverLocalActive && (
            <div className="rounded-md border-2 border-info bg-info/10 px-2.5 py-1.5 text-[11px] font-mono text-foreground flex items-center gap-2 flex-wrap">
              <Activity className="h-3 w-3 text-info animate-pulse shrink-0" />
              <span className="flex-1 min-w-0">
                A local Go Live session is already in flight.
                Starting another will overwrite its claim and force it to exit cleanly.
              </span>
              <StopLocalSessionButton workflow="go-live" />
            </div>
          )}

          {/* Checkpoint banner — mirrors the website Live Discovery card.
              Green when present, dimmer when Start Fresh is on. Shows who
              last advanced the cursor (server cron or local AI) so the
              admin understands cross-mode handoff at a glance. */}
          {glCheckpoint && (
            <div className={cn(
              "rounded-md border px-2.5 py-1.5 text-[11px] font-mono leading-relaxed",
              glStartFresh
                ? "border-muted bg-muted/30 text-muted-foreground line-through decoration-1"
                : "border-success/40 bg-success/10 text-foreground",
            )}>
              <div>
                ↻ Will resume from cursor at{" "}
                <strong className="font-semibold">{glCheckpoint.province}</strong>
                {glCheckpoint.district && <> / <strong className="font-semibold">{glCheckpoint.district}</strong></>}
                {" "}/ <strong className="font-semibold">{glCheckpoint.sector}</strong>
                <span className="text-muted-foreground"> · {glCheckpoint.cellsTotal} cell{glCheckpoint.cellsTotal === 1 ? "" : "s"} processed in this run</span>
              </div>
              {glCheckpoint.advancedBy && (
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  last advanced by{" "}
                  <span className={cn(
                    "font-semibold px-1 rounded",
                    glCheckpoint.advancedBy === "server" ? "bg-accent/20 text-accent" : "bg-info/20 text-info",
                  )}>
                    {glCheckpoint.advancedBy}
                  </span>
                  {glCheckpoint.advancedAt && <> · {new Date(glCheckpoint.advancedAt).toLocaleString()}</>}
                </div>
              )}
            </div>
          )}
          {!glCheckpoint && (
            <div className="rounded-md border border-dashed border-muted px-2.5 py-1.5 text-[11px] text-muted-foreground font-mono">
              No previous Go Live cursor — first session will start from cell 1.
            </div>
          )}

          <ChipMultiSelect
            label="Provinces"
            options={PROVINCES}
            selected={glProvinces}
            onChange={setGlProvinces}
          />
          <ChipMultiSelect
            label="Sectors"
            options={SECTORS}
            selected={glSectors}
            onChange={setGlSectors}
          />

          {/* Numeric caps row: 5/cell + total. Matches the website's "Per-query
              max" wording so admins reading both pages see the same labels. */}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label
                className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground"
                title="Maximum new projects the AI may insert from one (province × sector) cell before moving on. Mirrors the website Live Discovery card's per-query-max."
              >
                Per-query max
              </Label>
              <Input
                type="number" min={1} max={10} value={glPerCellMax}
                onChange={(e) => setGlPerCellMax(Math.max(1, Math.min(10, Number(e.target.value) || 3)))}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label
                className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground"
                title="Hard stop. The AI exits as soon as it has inserted this many new projects in total across all cells, even if cells remain."
              >
                Stop after (total)
              </Label>
              <Input
                type="number" min={1} max={200} value={glBudget}
                onChange={(e) => setGlBudget(Math.max(1, Math.min(200, Number(e.target.value) || 30)))}
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Switches stacked vertically with helper text — same shape as the
              website's Live Discovery card (District-comprehensive / National
              Pride mode / Start fresh). */}
          <div className="space-y-1.5 pt-1">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={glIncludeDistricts} onCheckedChange={setGlIncludeDistricts} />
              <span>
                <span className="font-semibold">District-comprehensive</span>
                <span className="text-muted-foreground"> — also rotates through each province's districts (77 districts × {glSectors.size} sectors)</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={glNationalPride} onCheckedChange={setGlNationalPride} />
              <span>
                <span className="font-semibold">National Pride mode</span>
                <span className="text-muted-foreground"> — iterates the 24 Rastra Gaurab projects instead of the province × sector grid</span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <Switch checked={glStartFresh} onCheckedChange={setGlStartFresh} />
              <span>
                <span className="font-semibold">Start fresh</span>
                <span className="text-muted-foreground"> — ignore the saved cursor and restart from the first cell</span>
              </span>
            </label>
          </div>

          <p className="text-[10px] text-muted-foreground font-mono leading-snug">
            Grid: {glProvinces.size} × {glSectors.size} = <span className="text-foreground">{glProvinces.size * glSectors.size}</span> cells.
            Worst case: <span className="text-foreground">{glProvinces.size * glSectors.size * glPerCellMax}</span> projects (cells × per-query-max).
            The AI halts after <span className="text-foreground">{glBudget}</span> total insertions whichever comes first.
          </p>

          {/* Live log — mirrors the Sherlock Queue view, filtered to local
              Go Live rows. Updates via realtime so the admin can watch the
              AI walk the grid without leaving this panel. */}
          <GoLiveQueueLog />
        </div>
      )}

      {task === "analyze" && (
        <ProjectMultiSelectField
          projects={projects}
          loading={projectsLoading}
          selected={selectedProjectIds}
          onChange={setSelectedProjectIds}
        />
      )}

      {task === "live-check" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label
              className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground"
              title="How many polling cycles before the AI exits. 60 cycles × 60s ≈ 1 hour of monitoring."
            >
              Max cycles
            </Label>
            <Input
              type="number" min={1} max={500} value={lcCycles}
              onChange={(e) => setLcCycles(Math.max(1, Math.min(500, Number(e.target.value) || 60)))}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label
              className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground"
              title="Seconds between polls. Keep ≥30s to avoid hammering the database."
            >
              Poll every (sec)
            </Label>
            <Input
              type="number" min={30} max={3600} value={lcIntervalSec}
              onChange={(e) => setLcIntervalSec(Math.max(30, Math.min(3600, Number(e.target.value) || 60)))}
              className="h-8 text-xs"
            />
          </div>
          <p className="text-[10px] text-muted-foreground font-mono leading-snug col-span-2">
            Runs for up to <span className="text-foreground">{(lcCycles * lcIntervalSec / 60).toFixed(0)} minutes</span> total
            ({lcCycles} cycles × {lcIntervalSec}s).
            Turn off the website's "Auto-analysis on approval" toggle above before starting this.
          </p>
        </div>
      )}

      {(task === "fetch-news" || task === "verify") && (
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Project slug or id</Label>
          <Input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="e.g. kaligandaki-corridor-road-4a2f  or  164"
            className="h-8 text-xs font-mono"
          />
        </div>
      )}

      {task === "brief" && (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">Scope</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as any)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="global">Global (national)</SelectItem>
                <SelectItem value="province">By province</SelectItem>
                <SelectItem value="sector">By sector</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scope !== "global" && (
            <div className="space-y-1">
              <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
                {scope === "province" ? "Province" : "Sector"}
              </Label>
              <Select value={scopeValue} onValueChange={setScopeValue}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={scope === "province" ? "Pick a province" : "Pick a sector"} /></SelectTrigger>
                <SelectContent>
                  {(scope === "province" ? PROVINCES : SECTORS).map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ChipMultiSelect — compact toggle row for fixed-small lists (provinces,
// sectors). Each option is a button that flips between filled/outlined.
// Used by Go Live for province and sector selection.
function ChipMultiSelect({ label, options, selected, onChange }: {
  label: string;
  options: readonly string[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const allOn = options.every(o => selected.has(o));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          {label} ({selected.size}/{options.length})
        </Label>
        <button
          type="button"
          className="text-[10px] text-muted-foreground hover:text-foreground underline"
          onClick={() => onChange(allOn ? new Set() : new Set(options))}
        >
          {allOn ? "Clear" : "All"}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(o => {
          const on = selected.has(o);
          return (
            <button
              key={o}
              type="button"
              onClick={() => {
                const next = new Set(selected);
                if (next.has(o)) next.delete(o); else next.add(o);
                onChange(next);
              }}
              className={cn(
                "px-2 py-0.5 rounded-full border text-[11px] font-mono transition-colors",
                on
                  ? "border-accent bg-accent/15 text-foreground"
                  : "border-border text-muted-foreground hover:bg-muted",
              )}
            >
              {o}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ProjectMultiSelectField — searchable popover with checkbox list. Pulls
// from the panel-level projects cache. Shows selected count and a few
// chips on the trigger; popover content has the search + filter + list.
//
// Filter dropdown (right of search) narrows the list to the projects the
// admin most often wants to re-analyze:
//   - all:            every fetched row
//   - approved:       approval_status='approved' only — the typical analysis target
//   - unanalyzed:     last_comprehensive_analysis_at IS NULL
//   - stale-2d:       last_comprehensive_analysis_at > 2 days ago (sorted stalest first)
type ProjectFilter = "all" | "approved" | "unanalyzed" | "stale-2d";

const STALE_THRESHOLD_MS = 2 * 24 * 60 * 60 * 1000;

function ProjectMultiSelectField({ projects, loading, selected, onChange }: {
  projects: ProjectRow[];
  loading: boolean;
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<ProjectFilter>("all");

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    onChange(next);
  };

  // Apply the active filter then re-sort. Stale puts the oldest first;
  // unanalyzed has nothing to sort by so keeps the source order (approved →
  // recent first, set by the panel-level fetch).
  const filteredProjects = useMemo(() => {
    const now = Date.now();
    const cutoff = now - STALE_THRESHOLD_MS;
    let rows = projects;
    if (filter === "approved") {
      rows = rows.filter(p => p.approval_status === "approved");
    } else if (filter === "unanalyzed") {
      rows = rows.filter(p => p.last_comprehensive_analysis_at == null);
    } else if (filter === "stale-2d") {
      // Both never-analyzed AND analyzed-more-than-2-days-ago count as stale;
      // the user's goal is "everything overdue for a refresh".
      rows = rows.filter(p => {
        if (!p.last_comprehensive_analysis_at) return true;
        return new Date(p.last_comprehensive_analysis_at).getTime() < cutoff;
      });
      // Sort stalest first: nulls (never analyzed) at top, then oldest timestamps.
      rows = [...rows].sort((a, b) => {
        const ta = a.last_comprehensive_analysis_at ? new Date(a.last_comprehensive_analysis_at).getTime() : 0;
        const tb = b.last_comprehensive_analysis_at ? new Date(b.last_comprehensive_analysis_at).getTime() : 0;
        return ta - tb;  // ascending = stalest (smallest timestamp / null=0) first
      });
    }
    return rows;
  }, [projects, filter]);

  const selectedSummary = useMemo(() => {
    if (selected.size === 0) return "Pick projects to analyze";
    const titles = projects.filter(p => selected.has(String(p.id))).slice(0, 2).map(p => p.title);
    const extra = selected.size - titles.length;
    return [...titles, extra > 0 ? `+${extra} more` : null].filter(Boolean).join(" · ");
  }, [selected, projects]);

  // Helper for the per-row stale badge — shows "Xd ago" or "never" so admins
  // can eyeball freshness without expanding to inspect.
  const staleBadge = (iso: string | null): { label: string; tone: "ok" | "warn" | "stale" | "never" } => {
    if (!iso) return { label: "never", tone: "never" };
    const ageMs = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ageMs / 86400000);
    if (days < 1) return { label: `${Math.floor(ageMs / 3600000)}h ago`, tone: "ok" };
    if (days < 2) return { label: `${days}d ago`, tone: "ok" };
    if (days < 7) return { label: `${days}d ago`, tone: "warn" };
    return { label: `${days}d ago`, tone: "stale" };
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] uppercase tracking-wider font-mono text-muted-foreground">
          Projects ({selected.size} selected)
        </Label>
        {selected.size > 0 && (
          <button
            type="button"
            className="text-[10px] text-muted-foreground hover:text-foreground underline"
            onClick={() => onChange(new Set())}
          >
            Clear
          </button>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="w-full h-8 justify-between text-xs font-normal"
            disabled={loading}
          >
            <span className="truncate text-left flex-1 mr-2">
              {loading ? "Loading projects…" : selectedSummary}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command>
            {/* Search input + filter dropdown share one row. The Command
                primitive needs CommandInput as its first child to power
                cmdk's internal search state, so the filter Select lives
                next to it inside a flex row. */}
            <div className="flex items-center gap-1 px-1 border-b">
              <CommandInput
                placeholder="Search title, slug, sector, province…"
                className="h-9 text-xs flex-1 border-0"
              />
              <Select value={filter} onValueChange={(v) => setFilter(v as ProjectFilter)}>
                <SelectTrigger
                  className="h-7 px-2 text-[11px] font-mono w-auto gap-1 border-0 bg-transparent hover:bg-muted shrink-0"
                  aria-label="Filter"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All ({projects.length})</SelectItem>
                  <SelectItem value="approved" className="text-xs">
                    Approved only ({projects.filter(p => p.approval_status === "approved").length})
                  </SelectItem>
                  <SelectItem value="unanalyzed" className="text-xs">
                    Unanalyzed ({projects.filter(p => p.last_comprehensive_analysis_at == null).length})
                  </SelectItem>
                  <SelectItem value="stale-2d" className="text-xs">
                    Stale &gt;2d, stalest first
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <CommandList className="max-h-72">
              <CommandEmpty>No projects match.</CommandEmpty>
              <CommandGroup>
                {filteredProjects.map(p => {
                  const id = String(p.id);
                  const isChecked = selected.has(id);
                  const badge = staleBadge(p.last_comprehensive_analysis_at);
                  const badgeTone =
                    badge.tone === "never" ? "text-destructive" :
                    badge.tone === "stale" ? "text-destructive" :
                    badge.tone === "warn" ? "text-warning" :
                    "text-success";
                  return (
                    <CommandItem
                      key={p.id}
                      value={`${p.title} ${p.slug} ${p.sector ?? ""} ${p.province ?? ""}`}
                      onSelect={() => toggle(id)}
                      className="flex items-start gap-2 cursor-pointer"
                    >
                      <span className={cn(
                        "mt-0.5 h-3.5 w-3.5 rounded border flex items-center justify-center shrink-0",
                        isChecked ? "bg-accent border-accent text-accent-foreground" : "border-input",
                      )}>
                        {isChecked && <Check className="h-3 w-3" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{p.title}</div>
                        <div className="text-[10px] text-muted-foreground font-mono truncate">
                          {p.sector ?? "—"} · {p.province ?? "—"} · {p.approval_status} · <span className={badgeTone}>{badge.label}</span>
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Paste-back applier. Accepts the JSON block the AI emits when it has no
// HTTPS-capable tool. The shape is task-tagged ({"task":"discover|brief|..."}),
// so we route to the right inserter from a single textarea. Writes use the
// admin's authenticated supabase client — RLS allows moderators to insert
// pending rows on every table touched here.
function PasteBackBlock() {
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = async () => {
    let parsed: any;
    try {
      // Tolerate wrapping fences ("```json … ```") that ChatGPT loves to add.
      const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      parsed = JSON.parse(stripped);
    } catch (e: any) {
      toast.error(`Couldn't parse JSON: ${e.message}`);
      return;
    }
    if (!parsed || typeof parsed.task !== "string") {
      toast.error('Expected a JSON object with a "task" field (e.g. {"task":"discover", ...})');
      return;
    }
    setBusy(true);
    try {
      const result = await applyLocalAiResult(parsed);
      toast.success(result);
      setRaw("");
    } catch (e: any) {
      toast.error(`Apply failed: ${e.message ?? String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-dashed p-3 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-semibold flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <ClipboardPaste className="h-3.5 w-3.5 text-accent" /> Paste back result (no-HTTPS fallback)
        </span>
        <span className="text-[10px] text-muted-foreground">use when your AI returned JSON instead of writing directly</span>
      </button>
      {open && (
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">
            Paste the JSON block the AI emitted. The website inserts the rows
            using your moderator session. All inserts land as
            <span className="font-mono"> approval_status="pending" </span>
            and show up in the review queue.
          </p>
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='{"task":"discover","projects_to_insert":[...],"sources_to_insert":[...]}'
            className="font-mono text-xs h-32"
            spellCheck={false}
          />
          <div className="flex justify-end">
            <Button size="sm" onClick={apply} disabled={busy || !raw.trim()}>
              {busy ? "Applying…" : "Apply"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Route a paste-back JSON object to the right inserter. Returns a short
// summary string for the toast. Throws on validation failure so the
// caller can surface the message uniformly.
async function applyLocalAiResult(parsed: any): Promise<string> {
  switch (parsed.task) {
    case "discover":
    case "go-live":
      // Go Live and Discover share the same write shape (projects + sources).
      return applyDiscover(parsed);
    case "brief":
      return applyBriefs(parsed);
    case "fetch-news":
      return applyFetchNews(parsed);
    case "analyze":
      return applyAnalyze(parsed);
    case "verify":
      return "Verify task is read-only — no DB writes performed. Review the JSON yourself.";
    default:
      throw new Error(`Unknown task "${parsed.task}". Expected discover / go-live / analyze / brief / fetch-news / verify.`);
  }
}

// ── applyDiscover: write projects + project_sources, optionally a sherlock_jobs row.
async function applyDiscover(p: any): Promise<string> {
  const projects: any[] = Array.isArray(p.projects_to_insert) ? p.projects_to_insert : [];
  const sources: any[] = Array.isArray(p.sources_to_insert) ? p.sources_to_insert : [];
  if (projects.length === 0) throw new Error("payload has no projects_to_insert[]");
  const projectRows = projects.map((row: any) => ({ ...row, ai_tag: row.ai_tag ?? "claude-local", submitted_by_ai: true, approval_status: "pending" }));
  const { data: insertedProjects, error: projErr } = await supabase
    .from("projects")
    .insert(projectRows)
    .select("id, slug");
  if (projErr) throw new Error(projErr.message);
  const sourceRows = sources.map((s: any, i: number) => ({
    ...s,
    project_id: s.project_id ?? insertedProjects?.[i]?.id,
    submitted_by_ai: true,
    approval_status: "pending",
  })).filter((s: any) => typeof s.project_id === "number");
  let srcInserted = 0;
  if (sourceRows.length > 0) {
    const { error: srcErr, count } = await supabase.from("project_sources").insert(sourceRows, { count: "exact" });
    if (srcErr) throw new Error(`projects ok (${insertedProjects?.length ?? 0}) but sources failed: ${srcErr.message}`);
    srcInserted = count ?? sourceRows.length;
  }
  return `Inserted ${insertedProjects?.length ?? 0} project(s) + ${srcInserted} source(s). All pending review.`;
}

// ── applyBriefs: write a batch of global_briefs, demoting prior display rows for the scope.
async function applyBriefs(p: any): Promise<string> {
  const briefs: any[] = Array.isArray(p.briefs) ? p.briefs : [];
  if (briefs.length === 0) throw new Error("brief payload has no briefs[]");
  const scope: string = String(p.scope || briefs[0]?.scope || "global");
  await supabase.from("global_briefs").update({ display_eligible: false })
    .eq("scope", scope).eq("display_eligible", true);
  const rows = briefs.map((b: any) => ({
    scope: b.scope ?? scope,
    scope_province: b.scope_province ?? null,
    scope_sector: b.scope_sector ?? null,
    headline: b.headline,
    body: b.body,
    sources: b.sources ?? [],
    importance: typeof b.importance === "number" ? b.importance : null,
    display_eligible: typeof b.importance === "number" ? b.importance >= 0.65 : false,
    batch_id: p.batch_id ?? null,
    created_by: null,
  }));
  const { error, count } = await supabase.from("global_briefs").insert(rows, { count: "exact" });
  if (error) throw new Error(error.message);
  const displayCount = rows.filter(r => r.display_eligible).length;
  return `Inserted ${count ?? rows.length} brief(s); ${displayCount} display-eligible.`;
}

// ── applyFetchNews: write project_updates + project_sources for one project.
async function applyFetchNews(p: any): Promise<string> {
  const projectId: number | null = typeof p.project_id === "number" ? p.project_id : null;
  if (!projectId) throw new Error("fetch-news payload missing project_id");
  const updates: any[] = Array.isArray(p.updates) ? p.updates : [];
  const sources: any[] = Array.isArray(p.sources) ? p.sources : [];
  let upCount = 0, srcCount = 0;
  if (updates.length > 0) {
    const rows = updates.map((u: any) => ({ ...u, project_id: projectId, submitted_by_ai: true, approval_status: "pending", update_type: u.update_type ?? "news" }));
    const { error, count } = await supabase.from("project_updates").insert(rows, { count: "exact" });
    if (error) throw new Error(error.message);
    upCount = count ?? rows.length;
  }
  if (sources.length > 0) {
    const rows = sources.map((s: any) => ({ ...s, project_id: projectId, submitted_by_ai: true, approval_status: "pending", source_type: s.source_type ?? "news" }));
    const { error, count } = await supabase.from("project_sources").insert(rows, { count: "exact" });
    if (error) throw new Error(`updates ok (${upCount}) but sources failed: ${error.message}`);
    srcCount = count ?? rows.length;
  }
  return `Inserted ${upCount} update(s) + ${srcCount} source(s) for project ${projectId}.`;
}

// ────────────────────────────────────────────────────────────────────────────
// StopLocalSessionButton — kill switch for a specific long-running local
// workflow. Targets either golive_session_id or livecheck_session_id on
// sherlock_live_state; the corresponding prompt polls its own column at the
// start of every cell/cycle and exits gracefully when it sees the null.
//
// Per-workflow targeting (as opposed to one shared session flag) lets Go
// Live and Live Check run in parallel: stopping one doesn't stop the other.
//
// We can't directly kill the AI's chat session — it lives in Claude.ai /
// ChatGPT / Claude Code, outside our reach. So the stop is cooperative:
// the AI has to poll. The trade-off is one cheap GET per cell (~100ms,
// ~5KB), which is negligible compared to the web-search costs.
function StopLocalSessionButton({ workflow, label }: {
  workflow: "go-live" | "live-check";
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  const column = workflow === "go-live" ? "golive_session_id" : "livecheck_session_id";
  const displayLabel = label ?? (workflow === "go-live" ? "Stop Go Live" : "Stop Live Check");
  const stop = async () => {
    const which = workflow === "go-live" ? "local Go Live sweep" : "local Live Check loop";
    if (!confirm(
      `Stop the running ${which}?\n\n` +
      `The AI checks ${column} before every ${workflow === "go-live" ? "cell" : "cycle"} — ` +
      "it'll finish whatever it's mid-write on, then exit cleanly. " +
      "Could take 5-60 seconds depending on what step it's on.\n\n" +
      (workflow === "go-live"
        ? "The cursor stays where it is — next session can resume from there."
        : "Newly-approved projects in the queue stay pending until the next Live Check session picks them up."),
    )) return;
    setBusy(true);
    const { error } = await supabase.from("sherlock_live_state")
      .update({ [column]: null, updated_at: new Date().toISOString() } as any)
      .eq("id", 1);
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success(`Stop signal sent. AI will exit after its current ${workflow === "go-live" ? "cell" : "cycle"} completes.`);
  };
  return (
    <Button
      size="sm" variant="destructive"
      onClick={stop}
      disabled={busy}
      className="h-7 px-2 text-[11px] shrink-0"
    >
      {busy ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Lock className="h-3 w-3 mr-1" />}
      {displayLabel}
    </Button>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// GoLiveQueueLog — slim mirror of the Sherlock Queue tab, filtered to local
// Go Live runs. Same row layout the Sherlock card uses (status badge · kind
// · params summary · +inserted/skipped · timestamp · error inline), so an
// admin watching the panel sees the exact same log they'd see by clicking
// over to Sherlock → Queue. Realtime keeps the list fresh as the AI works.
//
// Filter: sherlock_jobs where params->>'ai_source' starts with
// 'claude-local-golive-'. Only the most recent 20 rows render — enough to
// see a session's progress + the previous cell when resuming.

type GoLiveJob = {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed" | "cancelled";
  params: any;
  inserted: number | null;
  skipped: number | null;
  error_text: string | null;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  last_diagnostic: any;
};

function GoLiveQueueLog() {
  const [jobs, setJobs] = useState<GoLiveJob[]>([]);
  const [loading, setLoading] = useState(true);
  // Local-only filter toggle. Default OFF — admins want to see the full
  // picture (server cron + local sessions interleaved) so they understand
  // where the cursor came from. Flip ON to focus on just local rows when
  // debugging a session.
  const [localOnly, setLocalOnly] = useState(false);

  const refresh = useCallback(async () => {
    // Two queries unioned in JS: local-golive rows AND server-cron live-mode
    // rows. Supabase REST .or() with JSON-path predicates is fragile, so
    // doing two clean queries + sort in JS is the boring-and-works path.
    const [localQ, serverQ] = await Promise.all([
      supabase
        .from("sherlock_jobs")
        .select("id, kind, status, params, inserted, skipped, error_text, enqueued_at, started_at, finished_at, last_diagnostic")
        .like("params->>ai_source", "%-golive-%")
        .order("enqueued_at", { ascending: false })
        .limit(20),
      localOnly ? Promise.resolve({ data: [] as GoLiveJob[] }) : supabase
        .from("sherlock_jobs")
        .select("id, kind, status, params, inserted, skipped, error_text, enqueued_at, started_at, finished_at, last_diagnostic")
        .eq("params->>liveMode", "true")
        .order("enqueued_at", { ascending: false })
        .limit(20),
    ]);
    const merged = [
      ...((localQ.data ?? []) as GoLiveJob[]),
      ...((serverQ.data ?? []) as GoLiveJob[]),
    ];
    // Sort desc by enqueued_at, cap at 20 again after merge.
    merged.sort((a, b) => (b.enqueued_at > a.enqueued_at ? 1 : -1));
    setJobs(merged.slice(0, 20));
    setLoading(false);
  }, [localOnly]);

  useEffect(() => {
    refresh();
    // Realtime channel mirrors what SherlockManager's QueueTab does for
    // the full Sherlock list. We just listen for ANY change on sherlock_jobs
    // and re-fetch (cheap because we limit to 20 rows). Server-side filter
    // would be nicer but Supabase realtime filter syntax doesn't support
    // JSON-path predicates, so we accept the small overhead.
    const ch = supabase.channel("local-golive-log")
      .on("postgres_changes", { event: "*", schema: "public", table: "sherlock_jobs" }, () => refresh())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [refresh]);

  // Same status-badge map Sherlock uses, so the visual identity carries over.
  const statusBadge = (s: GoLiveJob["status"]) => {
    switch (s) {
      case "queued":    return <Badge variant="outline" className="text-[10px]">queued</Badge>;
      case "running":   return <Badge className="bg-info/15 text-info text-[10px]"><Loader2 className="h-2.5 w-2.5 mr-1 animate-spin" />running</Badge>;
      case "done":      return <Badge className="bg-success/15 text-success text-[10px]">done</Badge>;
      case "failed":    return <Badge className="bg-destructive/15 text-destructive text-[10px]">failed</Badge>;
      case "cancelled": return <Badge variant="outline" className="text-[10px] text-muted-foreground">cancelled</Badge>;
    }
  };

  // Mirror SherlockManager's summarize() — same fields, same wording.
  const summarize = (j: GoLiveJob): string => {
    const p = j.params ?? {};
    const pieces: string[] = [];
    if (p.province) pieces.push(String(p.province));
    if (p.district) pieces.push(String(p.district));
    if (p.municipality) pieces.push(String(p.municipality));
    if (Array.isArray(p.sectors) && p.sectors.length) pieces.push(`[${p.sectors.join(", ")}]`);
    if (p.topic) pieces.push(`topic="${p.topic}"`);
    if (p.region) pieces.push(`region="${p.region}"`);
    if (p.maxResults) pieces.push(`max=${p.maxResults}`);
    return pieces.join(" ") || "—";
  };

  const counts = useMemo(() => {
    const c = { queued: 0, running: 0, done: 0, failed: 0, cancelled: 0 } as Record<GoLiveJob["status"], number>;
    for (const j of jobs) c[j.status] += 1;
    return c;
  }, [jobs]);

  return (
    <div className="space-y-1.5 mt-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="text-[11px] uppercase tracking-wider font-mono text-muted-foreground flex items-center gap-2">
          <Activity className="h-3 w-3" /> Go Live log
          <span className="normal-case tracking-normal text-[10px]">
            {counts.queued} queued · {counts.running} running · {counts.done} done · {counts.failed} failed
            {(counts.queued > 0 || counts.running > 0) && <span className="ml-1.5 italic">(live)</span>}
          </span>
        </div>
        <label className="text-[10px] text-muted-foreground flex items-center gap-1.5 cursor-pointer normal-case">
          <Checkbox
            checked={localOnly}
            onCheckedChange={(v) => setLocalOnly(!!v)}
            className="h-3 w-3"
          />
          local only
        </label>
      </div>

      {loading && (
        <div className="text-[11px] text-muted-foreground italic flex items-center gap-1.5">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}

      {!loading && jobs.length === 0 && (
        <p className="text-[11px] text-muted-foreground italic">
          No local Go Live runs yet. Click Copy prompt above, paste into your AI tool, and rows will appear here as the AI writes them.
        </p>
      )}

      {jobs.length > 0 && (
        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
          {jobs.map(j => {
            // Source badge — derive from params. local rows carry the
            // ai_source flag; server cron rows carry liveMode=true with no
            // ai_source. Render a tiny pill so admins can see at a glance
            // which mode produced each row.
            const aiSource = typeof j.params?.ai_source === "string" ? j.params.ai_source : "";
            const isLocal = aiSource.startsWith("claude-local-");
            const isServer = !!j.params?.liveMode && !isLocal;
            return (
            <Card key={j.id} className="p-2 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                {statusBadge(j.status)}
                {isLocal && (
                  <Badge className="bg-info/15 text-info text-[9px] uppercase tracking-wider px-1.5 py-0">local</Badge>
                )}
                {isServer && (
                  <Badge className="bg-accent/15 text-accent text-[9px] uppercase tracking-wider px-1.5 py-0">server</Badge>
                )}
                <span className="font-mono text-[10px] text-muted-foreground">{j.kind}</span>
                <span className="font-mono text-[10px] truncate flex-1 min-w-0">{summarize(j)}</span>
                {j.status === "done" && (
                  <span className="text-[10px] text-success">+{j.inserted ?? 0} · skipped {j.skipped ?? 0}</span>
                )}
                <span className="text-[10px] text-muted-foreground" title={j.enqueued_at}>
                  {new Date(j.enqueued_at).toLocaleString()}
                </span>
              </div>
              {/* Heartbeat trail — mirrors the diagnostic Sherlock writes. While
                  running, shows the most recent phase label so the admin can
                  see what step the AI is on right now. */}
              {j.status === "running" && j.last_diagnostic?.label && (
                <p className="mt-1 text-[10px] text-info font-mono truncate" title={String(j.last_diagnostic.label)}>
                  ↳ {String(j.last_diagnostic.label)}
                </p>
              )}
              {j.error_text && (
                <p className="mt-1 text-[10px] text-destructive font-mono truncate" title={j.error_text}>
                  {j.error_text}
                </p>
              )}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ActiveSessionsBanner — one or two rows depending on which long-running
// workflows are active. Go Live and Live Check have independent claim
// columns so both can show up simultaneously; each has its own Stop button.
// Other workflows (Discover, Analyze one-shot, Brief, Fetch news, Verify)
// don't claim a session so they don't appear here.
function ActiveSessionsBanner({ claims }: { claims: LiveClaims }) {
  const scrollToQueue = () => {
    // Sherlock card has a stable anchor string we can land on.
    const el = Array.from(document.querySelectorAll<HTMLElement>("*")).find(e =>
      e.textContent?.includes("Async job queue, geo-seeded fan-out"));
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="rounded-md border-2 border-warning bg-warning/10 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-warning shrink-0 animate-pulse" />
        <div className="text-xs font-semibold">Local-AI workflow{(claims.goLive && claims.liveCheck) ? "s" : ""} in flight</div>
      </div>
      {claims.goLive && (
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono flex-wrap pl-6">
          <span>
            <span className="text-foreground font-semibold">Go Live</span> · batch{" "}
            <span className="bg-info/15 text-info px-1 rounded">{claims.goLive.sessionId}</span>
            {claims.goLive.startedAt && <span className="text-muted-foreground"> · started {new Date(claims.goLive.startedAt).toLocaleTimeString()}</span>}
          </span>
          <StopLocalSessionButton workflow="go-live" label="Stop Go Live" />
        </div>
      )}
      {claims.liveCheck && (
        <div className="flex items-center justify-between gap-2 text-[11px] font-mono flex-wrap pl-6">
          <span>
            <span className="text-foreground font-semibold">Live Check</span> · batch{" "}
            <span className="bg-info/15 text-info px-1 rounded">{claims.liveCheck.sessionId}</span>
            {claims.liveCheck.startedAt && <span className="text-muted-foreground"> · started {new Date(claims.liveCheck.startedAt).toLocaleTimeString()}</span>}
          </span>
          <StopLocalSessionButton workflow="live-check" label="Stop Live Check" />
        </div>
      )}
      <div className="flex items-center justify-between pl-6">
        <span className="text-[11px] text-muted-foreground">
          Both can run in parallel — Go Live discovers new projects, Live Check analyzes approved ones. Different tables, no conflict.
        </span>
        <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={scrollToQueue}>
          View in queue
        </Button>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// AutoAnalysisToggleCard — flips the site_settings flag that the database
// trigger queue_analysis_on_approval() reads. When OFF, approvals no longer
// fire auto-analysis (which burns Tavily + Mistral), and the admin should
// run the Local-AI Live Check task instead.
function AutoAnalysisToggleCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("site_settings").select("auto_analysis_on_approval_enabled").eq("id", 1).maybeSingle()
      .then(({ data }) => {
        setEnabled(!!(data as any)?.auto_analysis_on_approval_enabled);
      });
  }, []);

  const save = async (next: boolean) => {
    setBusy(true);
    const { error } = await supabase.from("site_settings")
      .update({ auto_analysis_on_approval_enabled: next, updated_at: new Date().toISOString() })
      .eq("id", 1);
    setBusy(false);
    if (error) return toast.error(error.message);
    setEnabled(next);
    toast.success(next
      ? "Auto-analysis on approval ON — the trigger fires analysis-drain (burns Tavily + Mistral) when a project is approved."
      : "Auto-analysis on approval OFF — approvals no longer auto-fire analysis. Use Local-AI Live Check below to handle them.");
  };

  if (enabled === null) return null;

  return (
    <div className={cn(
      "rounded-md border-2 p-3 flex items-start justify-between gap-3 flex-wrap",
      enabled ? "border-success/40 bg-success/5" : "border-muted bg-muted/10",
    )}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <Switch checked={enabled} onCheckedChange={save} disabled={busy} />
        <div className="min-w-0">
          <div className="text-xs font-semibold">
            Auto-analysis on approval
            <span className={cn("ml-2 text-[10px] font-mono uppercase", enabled ? "text-success" : "text-muted-foreground")}>
              {enabled ? "· ON" : "· off"}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            When ON, the database trigger enqueues a comprehensive analysis (analysis-drain) every time a project is approved — burns Tavily + Mistral credits.
            When OFF, approvals don't trigger anything; use Local-AI <strong>Live Check</strong> below to mirror the same behaviour on your subscription.
          </div>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// BatchHistoryBlock — collapsible list of recent Copy-prompt sessions.
// Each entry has a Rollback button that finds every row across the 12
// AI-writeable tables tagged with ai_tag = 'claude-local-<batchId>' (or
// substring for sherlock_jobs.params.ai_source) and bulk-rejects them.
//
// Rollback policy: rejects (approval_status='rejected') rather than deletes.
// Keeps an audit trail and lets a moderator un-reject if the batch turned
// out OK. Tables without approval_status (project_milestones at points in
// history) are deleted instead — milestones don't carry moderation state.
function BatchHistoryBlock({ entries, onCleared, onRemoved }: {
  entries: BatchEntry[];
  onCleared: () => void;
  onRemoved: (batchId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busyBatch, setBusyBatch] = useState<string | null>(null);

  const rollback = async (entry: BatchEntry) => {
    // Suffix match — the AI may stamp ai_tag as either
    //   "claude-local-<batchId>" (most workflows)  or
    //   "claude-local-<workflow>-<batchId>" (Go Live, Live Check).
    // Both end with "-<batchId>" so this LIKE catches both.
    const suffix = `%-${entry.batchId}`;
    const willRestoreCursor = !!entry.preSnapshot?.sherlock_live_state;

    if (!confirm(
      `Roll back batch ${entry.batchId} (${entry.label})?\n\n` +
      `Effects:\n` +
      `  • Bulk-reject (approval_status='rejected') every row tagged with that batch across the ${ROLLBACK_TABLES.length} AI-writeable data tables — reversible.\n` +
      `  • Delete sherlock_jobs queue rows the AI created for this batch — non-reversible.\n` +
      (willRestoreCursor
        ? `  • Restore sherlock_live_state cursor + counter to the snapshot captured before the AI ran — non-reversible.\n`
        : ``) +
      `\nClick OK to proceed.`,
    )) return;

    setBusyBatch(entry.batchId);
    const counts: Record<string, number> = {};
    const errors: string[] = [];

    // 1. Reject rows across data tables (12 tables that carry ai_tag).
    for (const t of ROLLBACK_TABLES) {
      try {
        const { error, count } = await supabase.from(t as any)
          .update({ approval_status: "rejected" })
          .like("ai_tag", suffix)
          .select("id", { count: "exact", head: true });
        if (error) {
          // ai_tag column might not exist on every table (older schemas);
          // ignore quietly so partial coverage doesn't blow up the whole run.
          if (!/column .* does not exist/i.test(error.message)) {
            errors.push(`${t}: ${error.message}`);
          }
        } else if (count) counts[t] = count;
      } catch (e: any) { errors.push(`${t}: ${e.message}`); }
    }

    // 2. Delete sherlock_jobs rows this batch created — params->>ai_source
    //    suffix matches the same batchId. Sherlock rows have no
    //    approval_status, so deletion (not rejection) is the right move;
    //    they're just queue tracking, not user-facing content.
    try {
      const { error, count } = await supabase.from("sherlock_jobs")
        .delete()
        .like("params->>ai_source", suffix)
        .select("id", { count: "exact", head: true });
      if (error) errors.push(`sherlock_jobs: ${error.message}`);
      else if (count) counts["sherlock_jobs"] = count;
    } catch (e: any) { errors.push(`sherlock_jobs: ${e.message}`); }

    // 3. Restore the Go Live cursor snapshot, if one was captured at copy
    //    time. Only Go Live takes snapshots today, so this is a no-op for
    //    other workflows.
    if (entry.preSnapshot?.sherlock_live_state) {
      const snap = entry.preSnapshot.sherlock_live_state;
      try {
        const { error } = await supabase.from("sherlock_live_state")
          .update({
            last_province: snap.last_province,
            last_district: snap.last_district,
            last_sector: snap.last_sector,
            last_advanced_by: snap.last_advanced_by,
            last_advanced_at: snap.last_advanced_at,
            enqueued_count: snap.enqueued_count,
            golive_session_id: snap.golive_session_id,
            golive_started_at: snap.golive_started_at,
            livecheck_session_id: snap.livecheck_session_id,
            livecheck_started_at: snap.livecheck_started_at,
            updated_at: new Date().toISOString(),
          })
          .eq("id", 1);
        if (error) errors.push(`live_state: ${error.message}`);
        else counts["live_state"] = 1;
      } catch (e: any) { errors.push(`live_state: ${e.message}`); }
    }

    setBusyBatch(null);
    onRemoved(entry.batchId);
    const summary = Object.entries(counts).map(([k, v]) => `${k.replace("project_", "")}:${v}`).join(" ");
    if (errors.length > 0) {
      toast.error(`Partial rollback. ${summary || "0 effects"}. Errors: ${errors.slice(0, 2).join(" · ")}`);
    } else {
      toast.success(summary
        ? `Rolled back batch ${entry.batchId} — ${summary}`
        : `Batch ${entry.batchId} had no rows to roll back (AI may not have written yet)`);
    }
  };

  return (
    <div className="rounded-md border p-3 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className="text-sm font-semibold flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <History className="h-3.5 w-3.5 text-accent" /> Recent batches ({entries.length})
        </span>
        <span className="text-[10px] text-muted-foreground">click any to roll back</span>
      </button>
      {open && (
        <div className="space-y-1.5">
          {entries.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic">
              No batches yet. Each Copy-prompt click records a fresh batch id here.
            </p>
          ) : (
            entries.map(e => (
              <div key={e.batchId} className="flex items-center gap-2 text-xs flex-wrap">
                <span className="font-mono text-[10px] bg-muted px-1.5 py-0.5 rounded">{e.batchId}</span>
                <span className="text-muted-foreground">{e.label}</span>
                <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                  {new Date(e.copiedAt).toLocaleString()}
                </span>
                <Button
                  size="sm" variant="ghost"
                  className="h-6 px-1.5 text-destructive hover:text-destructive"
                  onClick={() => rollback(e)}
                  disabled={busyBatch === e.batchId}
                  title="Bulk-reject every row this batch produced"
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))
          )}
          {entries.length > 0 && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                className="text-[10px] text-muted-foreground hover:text-foreground underline"
                onClick={() => { if (confirm("Clear batch history? Rows in the DB are not affected.")) onCleared(); }}
              >
                Clear history (local only)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── applyAnalyze: write across the 7 detail + 3 timeline tables for one project.
async function applyAnalyze(p: any): Promise<string> {
  const projectId: number | null = typeof p.project_id === "number" ? p.project_id : null;
  if (!projectId) throw new Error("analyze payload missing project_id");
  const tables = [
    "project_funding", "project_documents", "project_stakeholders",
    "project_risks", "project_impact", "project_procurement",
    "project_compliance", "project_milestones", "project_updates",
    "project_sources",
  ] as const;
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  for (const t of tables) {
    const rows: any[] = Array.isArray(p.rows?.[t]) ? p.rows[t] : [];
    if (rows.length === 0) { counts[t] = 0; continue; }
    const payload = rows.map((r: any) => ({ ...r, project_id: projectId, submitted_by_ai: true, approval_status: "pending" }));
    const { error, count } = await supabase.from(t as any).insert(payload, { count: "exact" });
    if (error) errors.push(`${t}: ${error.message}`);
    else counts[t] = count ?? payload.length;
  }
  const summary = Object.entries(counts).filter(([, n]) => n > 0).map(([k, n]) => `${k.replace("project_", "")}: ${n}`).join(", ");
  if (errors.length > 0) throw new Error(`Partial: ${summary || "0 inserts"}. Errors: ${errors.join(" · ")}`);
  return `Inserted: ${summary || "0 rows"} for project ${projectId}.`;
}
