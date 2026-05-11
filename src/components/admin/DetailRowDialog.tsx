// Reusable dialog for moderators to add a brand-new detail row to a project,
// or edit an existing one (approved or pending). Used by ComprehensiveSections
// (project detail page) and DetailsModerationTab (admin queue).
//
// Add mode: moderator-created rows skip the review queue — they land as
// approved + published_at=now() because the moderator IS the reviewer.
//
// Edit mode: writes back to the original row; if `approveOnSave` is true the
// row is also flipped to approved (used by the moderation queue edit-then-
// approve flow).

import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  RowFields, blankRow, toDbRow, hasContent,
  type DetailsState, type DetailRow,
} from '@/components/SubmitDetailsSection';

export const DETAIL_TABLES: Record<keyof DetailsState, string> = {
  funding:      'project_funding',
  documents:    'project_documents',
  stakeholders: 'project_stakeholders',
  risks:        'project_risks',
  impact:       'project_impact',
  procurement:  'project_procurement',
  compliance:   'project_compliance',
};

// Map a DB table name back to the DetailsState bucket key.
export function bucketForTable(table: string): keyof DetailsState | null {
  const entry = (Object.entries(DETAIL_TABLES) as [keyof DetailsState, string][])
    .find(([, t]) => t === table);
  return entry ? entry[0] : null;
}

type AddProps = {
  mode: 'add';
  kind: keyof DetailsState;
  projectId: number | string;
  trigger: React.ReactNode;
  onSaved?: () => void;
};
type EditProps = {
  mode: 'edit';
  kind: keyof DetailsState;
  row: DetailRow;
  trigger: React.ReactNode;
  approveOnSave?: boolean;
  onSaved?: () => void;
};

type Props = AddProps | EditProps;

export function DetailRowDialog(props: Props) {
  const { user, isAdmin, isCoadmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<DetailRow>(props.mode === 'edit' ? { ...props.row } : blankRow(props.kind));
  const [busy, setBusy] = useState(false);

  const reset = () => setRow(props.mode === 'edit' ? { ...props.row } : blankRow(props.kind));

  const save = async () => {
    if (!hasContent(props.kind, row)) {
      toast.error('Fill in at least the identifying fields for this row.');
      return;
    }
    const payload = toDbRow(props.kind, row);
    const table = DETAIL_TABLES[props.kind];
    setBusy(true);
    const isInstant = isAdmin || isCoadmin;
    const published_at = isInstant
      ? new Date().toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    if (props.mode === 'add') {
      const insert = {
        ...payload,
        project_id: props.projectId,
        submitted_by: user?.id,
        submitted_by_ai: false,
        approval_status: 'approved',
        reviewed_by: user?.id,
        published_at,
      };
      const { error } = await supabase.from(table as any).insert(insert);
      if (error) { setBusy(false); return toast.error(error.message); }
      const role = isAdmin ? 'admin' : isCoadmin ? 'coadmin' : 'reviewer';
      // best-effort review log — the new row's id isn't easy to surface without
      // a returning clause, so log against project_id with a synthetic action.
      await supabase.from('project_reviews').insert({
        target_table: table, target_id: String(props.projectId),
        reviewer_id: user?.id, reviewer_role: role,
        action: 'approved', notes: `Moderator added new ${props.kind} row`,
        was_admin: isInstant,
      });
      toast.success(`Added ${props.kind} row${isInstant ? '' : ' — publishes in 24h'}`);
    } else {
      const update: any = { ...payload };
      if (props.approveOnSave) {
        update.approval_status = 'approved';
        update.reviewed_by = user?.id;
        update.published_at = published_at;
      }
      const { error } = await supabase.from(table as any).update(update).eq('id', props.row.id);
      if (error) { setBusy(false); return toast.error(error.message); }
      const role = isAdmin ? 'admin' : isCoadmin ? 'coadmin' : 'reviewer';
      await supabase.from('project_reviews').insert({
        target_table: table, target_id: String(props.row.id),
        reviewer_id: user?.id, reviewer_role: role,
        action: props.approveOnSave ? 'approved' : 'edited',
        notes: 'Moderator edit',
        was_admin: isInstant,
      });
      toast.success(props.approveOnSave
        ? (isInstant ? 'Saved & approved' : 'Saved & approved — publish in 24h')
        : 'Saved');
    }
    setBusy(false);
    setOpen(false);
    props.onSaved?.();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <DialogTrigger asChild>{props.trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {props.mode === 'add' ? `Add ${props.kind} row` : `Edit ${props.kind} row`}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 pt-2">
          <RowFields kind={props.kind} row={row} onChange={(patch) => setRow(r => ({ ...r, ...patch }))} />
          <div className="flex gap-2 justify-end pt-2 border-t">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={save} disabled={busy} className="bg-accent hover:bg-accent/90 text-accent-foreground">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {props.mode === 'add' ? 'Add row' : (props.mode === 'edit' && (props as EditProps).approveOnSave ? 'Save & approve' : 'Save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
