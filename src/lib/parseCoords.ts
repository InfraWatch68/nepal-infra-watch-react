// Parse coordinate strings like "27.7172° N, 85.3240° E", "27.7172,85.3240",
// "27°42'21.9\"N 85°19'26.4\"E" into decimal { lat, lng }.
export function parseCoordinates(input: string): { lat: number; lng: number } | null {
  if (!input) return null;
  const s = input.trim().replace(/\s+/g, ' ');

  // Try simple "lat, lng" or "lat lng"
  const simple = s.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (simple) {
    const lat = parseFloat(simple[1]);
    const lng = parseFloat(simple[2]);
    if (isFinite(lat) && isFinite(lng)) return { lat, lng };
  }

  // Decimal with hemisphere: "27.7172° N, 85.3240° E"
  const decHem = s.match(/(-?\d+(?:\.\d+)?)\s*°?\s*([NSns])[,\s]+(-?\d+(?:\.\d+)?)\s*°?\s*([EWew])/);
  if (decHem) {
    let lat = parseFloat(decHem[1]);
    let lng = parseFloat(decHem[3]);
    if (decHem[2].toUpperCase() === 'S') lat = -lat;
    if (decHem[4].toUpperCase() === 'W') lng = -lng;
    return { lat, lng };
  }

  // DMS: 27°42'21.9"N 85°19'26.4"E
  const dms = s.match(/(\d+)[°\s]+(\d+)['′\s]+(\d+(?:\.\d+)?)["″\s]*([NSns])[,\s]+(\d+)[°\s]+(\d+)['′\s]+(\d+(?:\.\d+)?)["″\s]*([EWew])/);
  if (dms) {
    const toDec = (d: string, m: string, sec: string, hem: string) => {
      const v = parseInt(d) + parseInt(m) / 60 + parseFloat(sec) / 3600;
      return /[SW]/i.test(hem) ? -v : v;
    };
    return { lat: toDec(dms[1], dms[2], dms[3], dms[4]), lng: toDec(dms[5], dms[6], dms[7], dms[8]) };
  }

  return null;
}

export function formatNPR(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value >= 1e9) return `रू ${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e7) return `रू ${(value / 1e7).toFixed(2)} Cr`;
  if (value >= 1e5) return `रू ${(value / 1e5).toFixed(2)} L`;
  return `रू ${value.toLocaleString('en-IN')}`;
}
