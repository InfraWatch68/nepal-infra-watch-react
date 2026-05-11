// Mirror of src/lib/nationalPride.ts for the Deno edge runtime. The frontend
// imports from src/, edge functions import from here. Keep the two in sync
// when alias lists change. Single source of truth would require a build step
// or Deno HTTPS import — duplication is cheaper for a stable 24-entry list.

export type NationalPrideProject = {
  name: string;
  sector?: string;
  province?: string;
  aliases: string[];
};

export const NATIONAL_PRIDE_PROJECTS: NationalPrideProject[] = [
  { name: 'Pokhara Regional International Airport', sector: 'Transport', province: 'Gandaki',
    aliases: ['Pokhara International Airport', 'PIA', 'पोखरा क्षेत्रीय अन्तर्राष्ट्रिय विमानस्थल'] },
  { name: 'Gautam Buddha International Airport', sector: 'Transport', province: 'Lumbini',
    aliases: ['Bhairahawa International Airport', 'GBIA', 'गौतम बुद्ध अन्तर्राष्ट्रिय विमानस्थल'] },
  { name: 'Nijgadh International Airport', sector: 'Transport', province: 'Madhesh',
    aliases: ['Nijgadh Airport', 'Second International Airport', 'NIA Nijgadh', 'निजगढ अन्तर्राष्ट्रिय विमानस्थल'] },
  { name: 'Kathmandu-Terai Madhesh Fast Track', sector: 'Transport', province: 'Bagmati',
    aliases: ['Kathmandu-Terai Expressway', 'Kathmandu Terai Fast Track', 'Fast Track', 'काठमाडौं तराई मधेस द्रुतमार्ग'] },
  { name: 'Postal Highway', sector: 'Transport',
    aliases: ['Hulaki Marg', 'East-West Postal Highway', 'हुलाकी मार्ग'] },
  { name: 'Mid-Hill Highway', sector: 'Transport',
    aliases: ['Pushpalal Highway', 'Mid Hill Lokmarg', 'पुष्पलाल मध्यपहाडी राजमार्ग'] },
  { name: 'North-South Koshi Corridor', sector: 'Transport',
    aliases: ['Koshi Corridor', 'Koshi Highway', 'उत्तर-दक्षिण कोशी कोरिडोर'] },
  { name: 'North-South Kaligandaki Corridor', sector: 'Transport',
    aliases: ['Kaligandaki Corridor', 'Kaligandaki Highway', 'उत्तर-दक्षिण कालीगण्डकी कोरिडोर'] },
  { name: 'North-South Karnali Corridor', sector: 'Transport',
    aliases: ['Karnali Corridor', 'Karnali Highway', 'उत्तर-दक्षिण कर्णाली कोरिडोर'] },
  { name: 'Madan Bhandari Highway', sector: 'Transport',
    aliases: ['Madan Bhandari Lokmarg', 'मदन भण्डारी राजमार्ग'] },
  { name: 'East-West Railway', sector: 'Transport',
    aliases: ['East West Railway', 'Mechi-Mahakali Railway', 'पूर्व-पश्चिम रेलमार्ग'] },
  { name: 'Kathmandu-Kerung Railway', sector: 'Transport',
    aliases: ['Kerung-Kathmandu Railway', 'Kathmandu Kerung Railway', 'Kerung Kathmandu Railway', 'काठमाडौं केरुङ रेल'] },
  { name: 'Upper Tamakoshi Hydropower', sector: 'Energy', province: 'Bagmati',
    aliases: ['Upper Tamakoshi', 'Upper Tamakoshi Hydroelectric Project', 'UTHEP', 'माथिल्लो तामाकोशी जलविद्युत'] },
  { name: 'Budhi Gandaki Hydropower', sector: 'Energy', province: 'Gandaki',
    aliases: ['Budhi Gandaki', 'Budhigandaki Hydroelectric Project', 'बुढीगण्डकी जलविद्युत'] },
  { name: 'West Seti Hydropower', sector: 'Energy', province: 'Sudurpashchim',
    aliases: ['West Seti', 'West Seti Hydroelectric Project', 'पश्चिम सेती जलविद्युत'] },
  { name: 'Babai Multipurpose Project', sector: 'Energy', province: 'Lumbini',
    aliases: ['Babai Irrigation', 'Babai Multipurpose', 'बबई बहुउद्देश्यीय आयोजना'] },
  { name: 'Bheri-Babai Diversion Multipurpose Project', sector: 'Energy', province: 'Karnali',
    aliases: ['Bheri Babai Diversion', 'BBDMP', 'भेरी-बबई डाइभर्सन'] },
  { name: 'Sikta Irrigation Project', sector: 'Agriculture & Irrigation', province: 'Lumbini',
    aliases: ['Sikta Irrigation', 'सिक्टा सिंचाइ'] },
  { name: 'Kaligandaki-Tinau Diversion', sector: 'Agriculture & Irrigation',
    aliases: ['Kaligandaki Tinau Diversion', 'Kali Gandaki Tinau Diversion', 'कालीगण्डकी-तिनाउ डाइभर्सन'] },
  { name: 'Melamchi Water Supply Project', sector: 'Water & Sanitation', province: 'Bagmati',
    aliases: ['Melamchi Water', 'Melamchi WSP', 'मेलम्ची खानेपानी आयोजना'] },
  { name: 'Pashupati Area Development', sector: 'Tourism', province: 'Bagmati',
    aliases: ['Pashupati Development', 'PADT', 'पशुपति क्षेत्र विकास'] },
  { name: 'Lumbini Area Development', sector: 'Tourism', province: 'Lumbini',
    aliases: ['Lumbini Development', 'Lumbini Master Plan', 'लुम्बिनी क्षेत्र विकास'] },
  { name: 'Janakpur Area Development', sector: 'Tourism', province: 'Madhesh',
    aliases: ['Janakpur Development', 'जनकपुर क्षेत्र विकास'] },
  { name: 'President Chure-Tarai Madhesh Conservation Programme', sector: 'Urban Development',
    aliases: ['Chure Tarai Madhesh', 'Chure Conservation', 'President Chure Tarai Madhesh', 'राष्ट्रपति चुरे-तराई मधेश संरक्षण'] },
];

function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function matchNationalPride(title: string): NationalPrideProject | null {
  if (!title) return null;
  const t = normalise(title);
  if (!t) return null;
  for (const p of NATIONAL_PRIDE_PROJECTS) {
    const candidates = [p.name, ...p.aliases].map(normalise);
    for (const c of candidates) {
      if (!c) continue;
      if (t === c) return p;
      const [short, long] = t.length <= c.length ? [t, c] : [c, t];
      if (short.length / long.length < 0.6) continue;
      if (long.includes(short)) return p;
    }
  }
  return null;
}
