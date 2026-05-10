import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default icon (Leaflet's default points to broken CDN paths in bundlers)
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MarkerProject {
  id: string;
  slug?: string;
  title: string;
  latitude: number | null;
  longitude: number | null;
  status?: string;
  sector?: string;
}

const NEPAL_CENTER: [number, number] = [28.3949, 84.124];

export function ProjectMap({ projects, height = '100%' }: { projects: MarkerProject[]; height?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(NEPAL_CENTER, 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 18,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const layer = L.layerGroup().addTo(map);
    const points: L.LatLng[] = [];
    projects.forEach(p => {
      if (p.latitude == null || p.longitude == null) return;
      const ll = L.latLng(Number(p.latitude), Number(p.longitude));
      points.push(ll);
      const marker = L.marker(ll).addTo(layer);
      const link = p.slug ? `<a href="/projects/${p.slug}" style="color:hsl(350 78% 48%);font-weight:600">View →</a>` : '';
      marker.bindPopup(`<div style="font-family:Inter,sans-serif"><div style="font-weight:600;margin-bottom:4px">${p.title}</div><div style="font-size:11px;color:#666">${p.sector ?? ''}${p.status ? ' · ' + p.status : ''}</div><div style="margin-top:6px">${link}</div></div>`);
    });
    if (points.length === 1) map.setView(points[0], 11);
    else if (points.length > 1) map.fitBounds(L.latLngBounds(points).pad(0.2));
    return () => { layer.remove(); };
  }, [projects]);

  return <div ref={containerRef} style={{ height, width: '100%', minHeight: 320 }} />;
}
