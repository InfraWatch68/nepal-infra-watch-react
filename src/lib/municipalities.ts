import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type MunicipalityKind = 'metropolitan' | 'sub_metropolitan' | 'municipality' | 'rural_municipality';

export type Municipality = {
  id: number;
  name: string;
  district: string;
  province: string;
  kind: MunicipalityKind;
};

// Async getter. Returns [] when province/district missing — UI uses that to
// disable the municipality select until a district is chosen.
export async function fetchMunicipalities(
  province?: string | null,
  district?: string | null,
): Promise<Municipality[]> {
  if (!province || !district) return [];
  const { data, error } = await supabase
    .from('municipalities')
    .select('id, name, district, province, kind')
    .eq('province', province)
    .eq('district', district)
    .order('name', { ascending: true });
  if (error) throw error;
  return (data ?? []) as Municipality[];
}

// React Query hook. Cached forever within a session — municipality data is
// effectively static (changes only on a federal reorganization).
export function useMunicipalities(province?: string | null, district?: string | null) {
  return useQuery({
    queryKey: ['municipalities', province ?? null, district ?? null],
    queryFn: () => fetchMunicipalities(province, district),
    enabled: Boolean(province && district),
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
