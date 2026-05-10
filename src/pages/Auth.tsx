import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Mountain } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

export default function Auth() {
  const [params] = useSearchParams();
  const initialMode = params.get('mode') === 'signup' ? 'signup' : 'signin';
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const nav = useNavigate();
  const { user } = useAuth();

  useEffect(() => { if (user) nav('/dashboard'); }, [user, nav]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { full_name: fullName },
          }
        });
        if (error) throw error;
        toast.success('Account created. Check your email to confirm.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success('Welcome back.');
        nav('/dashboard');
      }
    } catch (err: any) {
      toast.error(err.message ?? 'Authentication failed');
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen grid md:grid-cols-2">
      <div className="hidden md:block gradient-hero relative">
        <div className="absolute inset-0 opacity-[0.05] bg-[radial-gradient(circle_at_30%_20%,white_1px,transparent_1px)] [background-size:24px_24px]" />
        <div className="relative h-full flex flex-col justify-between p-12 text-primary-foreground">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-md bg-accent flex items-center justify-center">
              <Mountain className="h-5 w-5 text-accent-foreground" />
            </div>
            <span className="font-display text-xl font-bold">Nepal Infra Watch</span>
          </Link>
          <div>
            <p className="font-display text-3xl font-semibold leading-tight mb-3 text-balance">
              "Sunlight is the best disinfectant."
            </p>
            <p className="text-sm text-primary-foreground/60">Join contributors tracking every infrastructure rupee across Nepal.</p>
          </div>
          <div className="text-xs font-mono text-primary-foreground/50 uppercase tracking-wider">v0.1 · Public Beta</div>
        </div>
      </div>

      <div className="flex items-center justify-center p-6 md:p-12">
        <Card className="w-full max-w-md p-8 shadow-elegant">
          <div className="md:hidden flex items-center gap-2 mb-6">
            <div className="h-8 w-8 rounded-md gradient-hero flex items-center justify-center">
              <Mountain className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold">Nepal Infra Watch</span>
          </div>
          <h1 className="font-display text-3xl font-bold mb-2">{mode === 'signup' ? 'Create account' : 'Sign in'}</h1>
          <p className="text-sm text-muted-foreground mb-6">
            {mode === 'signup' ? 'Submit and track infrastructure projects.' : 'Continue to your dashboard.'}
          </p>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <Label htmlFor="name">Full name</Label>
                <Input id="name" value={fullName} onChange={e => setFullName(e.target.value)} required maxLength={120} />
              </div>
            )}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} required maxLength={255} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} maxLength={72} />
            </div>
            <Button type="submit" disabled={loading} className="w-full bg-accent hover:bg-accent/90 text-accent-foreground">
              {loading ? '...' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'signup' ? (
              <>Already have an account? <button onClick={() => setMode('signin')} className="text-accent hover:underline font-medium">Sign in</button></>
            ) : (
              <>New here? <button onClick={() => setMode('signup')} className="text-accent hover:underline font-medium">Create account</button></>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
