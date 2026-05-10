import { useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, X, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

type Props = {
  bucket?: string;
  value?: string | null;
  onChange: (url: string | null) => void;
  className?: string;
};

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function ImageDropzone({ bucket = 'project-covers', value, onChange, className }: Props) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    if (!user) { toast.error('Sign in first'); return; }
    if (!ALLOWED.includes(file.type)) { toast.error('Image must be JPEG, PNG, WebP, or GIF'); return; }
    if (file.size > MAX_BYTES) { toast.error('Image must be under 5 MB'); return; }
    setBusy(true);
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
    const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: '3600',
    });
    if (error) { setBusy(false); toast.error(error.message); return; }
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    setBusy(false);
    onChange(data.publicUrl);
    toast.success('Image uploaded');
  };

  const onPaste = (e: React.ClipboardEvent) => {
    const item = Array.from(e.clipboardData.items).find(it => it.type.startsWith('image/'));
    if (item) {
      const file = item.getAsFile();
      if (file) { e.preventDefault(); upload(file); }
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) upload(file);
  };

  return (
    <div
      className={cn(
        'rounded-md border-2 border-dashed p-3 transition',
        dragOver ? 'border-accent bg-accent/5' : 'border-border',
        className,
      )}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      onPaste={onPaste}
      tabIndex={0}
    >
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt="cover" className="h-16 w-28 object-cover rounded" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground truncate font-mono">{value}</div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            Replace
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)} aria-label="Clear image" className="text-muted-foreground hover:text-destructive">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="h-4 w-4" />
            <div>
              <div>Drop an image here, paste from clipboard, or click upload.</div>
              <div className="text-xs">JPEG / PNG / WebP / GIF · max 5 MB</div>
            </div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Upload
          </Button>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED.join(',')}
        className="sr-only"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
      />
    </div>
  );
}
