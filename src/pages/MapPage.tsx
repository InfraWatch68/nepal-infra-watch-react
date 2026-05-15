import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SiteHeader } from '@/components/layout/SiteHeader';
import { SiteFooter } from '@/components/layout/SiteFooter';
import { ProjectMap } from '@/components/ProjectMap';
import { Card } from '@/components/ui/card';

export default function MapPage() {
  const [projects, setProjects] = useState<any[]>([]);
  useEffect(() => {
    supabase.from('projects').select('id,slug,title,latitude,longitude,status,sector')
      .eq('approval_status', 'approved').not('latitude', 'is', null)
      .then(({ data }) => setProjects(data ?? []));
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
        <Card className="overflow-hidden h-[60vh] sm:h-[calc(100vh-280px)] sm:min-h-[500px]">
          <ProjectMap projects={projects} />
        </Card>
      </div>
      <SiteFooter />
    </div>
  );
}
