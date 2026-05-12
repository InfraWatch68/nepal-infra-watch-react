// Thematic sector — broad funding/policy classification. Distinct from
// `project_type` which describes the physical artifact (Road, Bridge, …).
export const SECTORS = [
  'Transport', 'Energy', 'Water & Sanitation', 'Agriculture & Irrigation',
  'Health', 'Education', 'Telecom', 'Urban Development', 'Tourism',
] as const;

// Physical artifact / project class — used by the Submit form and the AI
// discovery pipeline. Multiple types map into one sector (e.g. Road / Bridge /
// Tunnel / Airport / Railway are all Transport).
export const PROJECT_TYPES = [
  'Road', 'Bridge', 'Tunnel', 'Cable car', 'Airport', 'Railway',
  'Hydropower', 'Solar', 'Wind', 'Transmission line', 'Substation',
  'Drinking water', 'Sewerage', 'Treatment plant', 'Reservoir', 'Irrigation canal',
  'Hospital', 'School', 'Stadium', 'Market', 'Office building', 'Telecom tower',
  'Other',
] as const;

export const PROVINCES = [
  'Koshi', 'Madhesh', 'Bagmati', 'Gandaki', 'Lumbini', 'Karnali', 'Sudurpashchim'
] as const;

export type Province = typeof PROVINCES[number];

// Nepal's 77 districts grouped by province (2020 federal reorganization).
export const DISTRICTS_BY_PROVINCE: Record<Province, readonly string[]> = {
  Koshi: [
    'Bhojpur', 'Dhankuta', 'Ilam', 'Jhapa', 'Khotang', 'Morang', 'Okhaldhunga',
    'Panchthar', 'Sankhuwasabha', 'Solukhumbu', 'Sunsari', 'Taplejung', 'Terhathum', 'Udayapur',
  ],
  Madhesh: [
    'Bara', 'Dhanusha', 'Mahottari', 'Parsa', 'Rautahat', 'Saptari', 'Sarlahi', 'Siraha',
  ],
  Bagmati: [
    'Bhaktapur', 'Chitwan', 'Dhading', 'Dolakha', 'Kathmandu', 'Kavrepalanchok',
    'Lalitpur', 'Makwanpur', 'Nuwakot', 'Ramechhap', 'Rasuwa', 'Sindhuli', 'Sindhupalchok',
  ],
  Gandaki: [
    'Baglung', 'Gorkha', 'Kaski', 'Lamjung', 'Manang', 'Mustang',
    'Myagdi', 'Nawalpur', 'Parbat', 'Syangja', 'Tanahun',
  ],
  Lumbini: [
    'Arghakhanchi', 'Banke', 'Bardiya', 'Dang', 'Eastern Rukum', 'Gulmi',
    'Kapilvastu', 'Palpa', 'Parasi', 'Pyuthan', 'Rolpa', 'Rupandehi',
  ],
  Karnali: [
    'Dailekh', 'Dolpa', 'Humla', 'Jajarkot', 'Jumla',
    'Kalikot', 'Mugu', 'Salyan', 'Surkhet', 'Western Rukum',
  ],
  Sudurpashchim: [
    'Achham', 'Baitadi', 'Bajhang', 'Bajura', 'Dadeldhura',
    'Darchula', 'Doti', 'Kailali', 'Kanchanpur',
  ],
};

// Flat sorted list of every district (used when no province is selected).
export const ALL_DISTRICTS = Object.values(DISTRICTS_BY_PROVINCE)
  .flat()
  .slice()
  .sort((a, b) => a.localeCompare(b));

// Returns districts for a province, or all districts if no/invalid province.
export function districtsFor(province?: string | null): readonly string[] {
  if (province && (province in DISTRICTS_BY_PROVINCE)) {
    return DISTRICTS_BY_PROVINCE[province as Province];
  }
  return ALL_DISTRICTS;
}

export const STATUS_LABELS: Record<string, string> = {
  proposed: 'Proposed',
  approved: 'Approved',
  in_progress: 'In Progress',
  delayed: 'Delayed',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const STATUS_COLORS: Record<string, string> = {
  proposed: 'bg-muted text-muted-foreground',
  approved: 'bg-info/15 text-info',
  in_progress: 'bg-warning/15 text-warning',
  delayed: 'bg-destructive/15 text-destructive',
  completed: 'bg-success/15 text-success',
  cancelled: 'bg-muted text-muted-foreground',
};

// Overlay-friendly variants for badges that sit on cover photos. The default
// STATUS_COLORS use /15 alpha tints which disappear against bright photos
// (Thori Tourist Area, Madhesh Digital Education cards both showed near-
// invisible "approved"/"in progress" pills). These use solid /90 fills with
// white-ish text + a backdrop-blur + ring so the pill reads cleanly against
// any background. ProjectCard uses these; admin badges and the detail-page
// hero keep the tinted variants because their backdrops are already dark.
export const STATUS_COLORS_OVERLAY: Record<string, string> = {
  proposed:    'bg-foreground/80 text-background backdrop-blur-sm shadow-md ring-1 ring-black/10',
  approved:    'bg-info/95 text-white backdrop-blur-sm shadow-md ring-1 ring-black/10',
  in_progress: 'bg-warning/95 text-warning-foreground backdrop-blur-sm shadow-md ring-1 ring-black/10',
  delayed:     'bg-destructive/95 text-white backdrop-blur-sm shadow-md ring-1 ring-black/10',
  completed:   'bg-success/95 text-white backdrop-blur-sm shadow-md ring-1 ring-black/10',
  cancelled:   'bg-foreground/80 text-background backdrop-blur-sm shadow-md ring-1 ring-black/10',
};
