import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin } from 'lucide-react';
import { parseCoordinates } from '@/lib/parseCoords';

// Default Leaflet marker icon shim — same paths as ProjectMap.
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const NEPAL_CENTER: [number, number] = [28.3949, 84.124];

export function CoordPickerDialog({
  initial,
  onPick,
}: {
  initial?: string;
  onPick: (latLng: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [picked, setPicked] = useState<{ lat: number; lng: number } | null>(null);

  // Initialise map only when the dialog is open. We have to wait for the
  // dialog content to mount; useEffect on `open` does that for us.
  useEffect(() => {
    if (!open) return;
    if (!containerRef.current || mapRef.current) return;
    const start = (() => {
      if (initial) {
        const c = parseCoordinates(initial);
        if (c) return [c.lat, c.lng] as [number, number];
      }
      return NEPAL_CENTER;
    })();
    const startZoom = initial && parseCoordinates(initial) ? 11 : 7;
    const map = L.map(containerRef.current, { zoomControl: true }).setView(start, startZoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap',
      maxZoom: 18,
    }).addTo(map);

    if (initial) {
      const c = parseCoordinates(initial);
      if (c) {
        markerRef.current = L.marker([c.lat, c.lng], { draggable: true }).addTo(map);
        setPicked({ lat: c.lat, lng: c.lng });
        markerRef.current.on('dragend', () => {
          const ll = markerRef.current!.getLatLng();
          setPicked({ lat: ll.lat, lng: ll.lng });
        });
      }
    }

    map.on('click', (e: L.LeafletMouseEvent) => {
      const ll = e.latlng;
      if (markerRef.current) {
        markerRef.current.setLatLng(ll);
      } else {
        markerRef.current = L.marker(ll, { draggable: true }).addTo(map);
        markerRef.current.on('dragend', () => {
          const dll = markerRef.current!.getLatLng();
          setPicked({ lat: dll.lat, lng: dll.lng });
        });
      }
      setPicked({ lat: ll.lat, lng: ll.lng });
    });

    mapRef.current = map;
    // Resize fix — Leaflet needs a kick after the dialog finishes its open animation.
    const t = setTimeout(() => map.invalidateSize(), 200);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, [open, initial]);

  const accept = () => {
    if (!picked) return;
    onPick(`${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)}`);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <MapPin className="h-3.5 w-3.5" /> Pick on map
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pick coordinates</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">Click anywhere on the map to drop a pin. Drag the pin to refine. We send back lat, lng to the form.</p>
        <div ref={containerRef} className="rounded-md overflow-hidden border" style={{ height: 480 }} />
        <div className="flex items-center justify-between gap-3 pt-2">
          <div className="text-xs font-mono text-muted-foreground">
            {picked ? `${picked.lat.toFixed(6)}, ${picked.lng.toFixed(6)}` : 'No point chosen yet.'}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={accept} disabled={!picked}>Use these coordinates</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
