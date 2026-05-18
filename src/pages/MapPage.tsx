import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { ProjectMap } from '@/components/ProjectMap';
import { Card } from '@/components/ui/card';

export default function MapPage() {
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    supabase.from('projects').select('id,slug,title,latitude,longitude,status,sector')
      .eq('approval_status', 'approved').not('latitude', 'is', null)
      .then(({ data }) => setProjects(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <SiteHeader />
      <section className="border-b bg-secondary/30">
        <div className="container py-6 sm:py-8">
          <p className="text-xs uppercase tracking-[0.2em] font-mono text-accent mb-2">Geo View</p>
          <h1 className="font-display text-3xl sm:text-4xl font-bold">Project map</h1>
          <p className="text-muted-foreground mt-2 text-sm sm:text-base">{projects.length} geo-tagged projects across Nepal</p>
        </div>
      </section>
      <div className="container py-4 sm:py-6 flex-1">
        <Card className="relative overflow-hidden h-[60vh] sm:h-[calc(100vh-280px)] sm:min-h-[500px]">
          {loading ? (
            <div className="h-full w-full bg-muted/50 animate-pulse" aria-label="Loading project map" />
          ) : projects.length === 0 ? (
            <div className="h-full flex items-center justify-center p-6 text-center">
              <div>
                <h2 className="font-display text-xl font-semibold mb-2">No geo-tagged projects yet</h2>
                <p className="text-sm text-muted-foreground max-w-md">
                  Approved projects with latitude and longitude will appear here.
                </p>
              </div>
            </div>
          ) : (
            <ProjectMap projects={projects} />
          )}
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
