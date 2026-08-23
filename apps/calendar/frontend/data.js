// Seed data for SDC Calendar
// Holidays sourced from official SDC 2026 Holiday & Pay Calendar

// Fixed-date SDC Paid Holidays (same date every year)
const FIXED_HOLIDAYS = [
  { m: 1,  d: 1,  name: "New Year's Day",   kind: 'federal' },
  { m: 12, d: 24, name: 'Christmas Eve',    kind: 'sdc'     },
  { m: 12, d: 25, name: 'Christmas Day',    kind: 'federal' },
];

// Nth-weekday holidays (computed per year)
const NTH_HOLIDAYS = [
  { m: 5,  wd: 1, n: -1, name: 'Memorial Day',                  kind: 'federal' },
  { m: 9,  wd: 1, n: 1,  name: 'Labor Day',                     kind: 'federal' },
  { m: 11, wd: 4, n: 4,  name: 'Thanksgiving Day',              kind: 'federal' },
  { m: 11, wd: 5, n: 4,  name: 'Day After Thanksgiving (SDC)',   kind: 'sdc'     },
];

// Easter dates (Good Friday observed) — update annually
const EASTER_GOOD_FRIDAYS = {
  2024: { m: 3, d: 29 },
  2025: { m: 4, d: 18 },
  2026: { m: 4, d: 3  },
  2027: { m: 3, d: 26 },
  2028: { m: 4, d: 14 },
  2029: { m: 3, d: 30 },
  2030: { m: 4, d: 19 },
};

// Independence Day: Jul 4 observed — if Sat observe Fri+Mon, if Sun observe Mon, else Jul 4
function independenceDayObserved(year) {
  const jul4 = new Date(year, 6, 4);
  const dow = jul4.getDay(); // 0=Sun,6=Sat
  if (dow === 6) {
    // Saturday → observe Fri Jul 3 AND Mon Jul 6
    return [
      { date: new Date(year, 6, 3), name: 'Independence Day (observed Fri)', kind: 'federal' },
      { date: new Date(year, 6, 6), name: 'Independence Day (observed Mon)', kind: 'federal' },
    ];
  } else if (dow === 0) {
    // Sunday → observe Mon Jul 5
    return [{ date: new Date(year, 6, 5), name: 'Independence Day (observed)', kind: 'federal' }];
  } else {
    return [{ date: new Date(year, 6, 4), name: 'Independence Day', kind: 'federal' }];
  }
}

function nthWeekdayOfMonth(year, month, weekday, n) {
  if (n > 0) {
    const first = new Date(year, month - 1, 1);
    const offset = (weekday - first.getDay() + 7) % 7;
    return new Date(year, month - 1, 1 + offset + (n - 1) * 7);
  } else {
    const last = new Date(year, month, 0);
    const offset = (last.getDay() - weekday + 7) % 7;
    return new Date(year, month - 1, last.getDate() - offset);
  }
}

function holidaysForYear(year) {
  const out = [];

  // Fixed-date holidays
  FIXED_HOLIDAYS.forEach(h => {
    out.push({ date: new Date(year, h.m - 1, h.d), title: h.name, category: 'holiday', kind: h.kind, allDay: true, seeded: true });
  });

  // Nth-weekday holidays
  NTH_HOLIDAYS.forEach(h => {
    out.push({ date: nthWeekdayOfMonth(year, h.m, h.wd, h.n), title: h.name, category: 'holiday', kind: h.kind, allDay: true, seeded: true });
  });

  // Independence Day (observance depends on what day Jul 4 falls)
  independenceDayObserved(year).forEach(h => {
    out.push({ date: h.date, title: h.name, category: 'holiday', kind: h.kind, allDay: true, seeded: true });
  });

  // Easter — Good Friday observed
  const gf = EASTER_GOOD_FRIDAYS[year];
  if (gf) {
    out.push({ date: new Date(year, gf.m - 1, gf.d), title: 'Easter (Good Friday Observed)', category: 'holiday', kind: 'sdc', allDay: true, seeded: true });
  }

  return out;
}

const PAY_ANCHOR = new Date(2026, 0, 9);

function paydaysForYear(year) {
  const out = [];
  const ms14 = 14 * 24 * 3600 * 1000;
  let d = new Date(PAY_ANCHOR);
  while (d.getFullYear() > year || (d.getFullYear() === year && d.getMonth() > 0) || d > new Date(year, 0, 14)) {
    d = new Date(d.getTime() - ms14);
  }
  while (d.getFullYear() < year) d = new Date(d.getTime() + ms14);
  while (d.getFullYear() === year) {
    out.push({ date: new Date(d), title: 'Pay Day', category: 'payday', allDay: true, seeded: true });
    d = new Date(d.getTime() + ms14);
  }
  return out;
}

const DEFAULT_EMPLOYEES = [
  {
    "name": "Abhi Kamuju",
    "role": "SDC Automation",
    "email": "akamuju@sdcautomation.com",
    "bMonth": 1,
    "bDay": 1,
    "id": "100000"
  },
  {
    "name": "Debbie Belliveau",
    "role": "Director of Events",
    "email": "dbelliveau@sdcautomation.com",
    "bMonth": 12,
    "bDay": 26,
    "id": "100001"
  },
  {
    "name": "Steve Belliveau",
    "role": "Chief Executive Officer",
    "email": "sbelliveau@sdcautomation.com",
    "bMonth": 12,
    "bDay": 24,
    "id": "100002"
  },
  {
    "name": "Darrin McCauley",
    "role": "Service Technician",
    "email": "dmccauley@sdcautomation.com",
    "bMonth": 10,
    "bDay": 17,
    "id": "100010"
  },
  {
    "name": "Greg Merrill",
    "role": "Sales Manager",
    "email": "gmerrill@sdcautomation.com",
    "bMonth": 12,
    "bDay": 14,
    "id": "100012"
  },
  {
    "name": "Dave Shaner",
    "role": "Sr. Electrical Engineer",
    "email": "dshaner@sdcautomation.com",
    "bMonth": 6,
    "bDay": 4,
    "id": "100014"
  },
  {
    "name": "Sandra Morrison",
    "role": "Account Payable",
    "email": "smorrison@sdcautomation.com",
    "bMonth": 8,
    "bDay": 26,
    "id": "100021"
  },
  {
    "name": "Ashley Cohen",
    "role": "Director of Marketing, Sales & HR",
    "email": "acohen@sdcautomation.com",
    "bMonth": 4,
    "bDay": 21,
    "id": "100023"
  },
  {
    "name": "Patrick Morrison",
    "role": "Director of Plant Operations",
    "email": "pmorrison@sdcautomation.com",
    "bMonth": 1,
    "bDay": 18,
    "id": "100027"
  },
  {
    "name": "James Peoples",
    "role": "Sr. Mechanical Designer",
    "email": "jpeoples@sdcautomation.com",
    "bMonth": 9,
    "bDay": 30,
    "id": "100030"
  },
  {
    "name": "Richard Hlavaty",
    "role": "Welder-Fabricator",
    "email": "rhlavaty@sdcautomation.com",
    "bMonth": 10,
    "bDay": 3,
    "id": "100032"
  },
  {
    "name": "Mike Czenszak",
    "role": "Chief Mechanical Engineer",
    "email": "mczenszak@sdcautomation.com",
    "bMonth": 11,
    "bDay": 16,
    "id": "100034"
  },
  {
    "name": "Jason Perry",
    "role": "Electrical Engineering Team Lead",
    "email": "jperry@sdcautomation.com",
    "bMonth": 7,
    "bDay": 3,
    "id": "100039"
  },
  {
    "name": "Daniel Belliveau",
    "role": "President",
    "email": "danbelliveau@sdcautomation.com",
    "bMonth": 4,
    "bDay": 2,
    "id": "100042"
  },
  {
    "name": "Josh Belliveau",
    "role": "Associate Project Manager",
    "email": "joshbelliveau@sdcautomation.com",
    "bMonth": 11,
    "bDay": 6,
    "id": "100055"
  },
  {
    "name": "Tim Wilmot",
    "role": "Controls Engineering Manager",
    "email": "twilmot@sdcautomation.com",
    "bMonth": 5,
    "bDay": 23,
    "id": "100057"
  },
  {
    "name": "Neil Davis",
    "role": "Sr. Electrical Engineer",
    "email": "ndavis@sdcautomation.com",
    "bMonth": 5,
    "bDay": 27,
    "id": "100058"
  },
  {
    "name": "Monica Saggio",
    "role": "Service Engineering Manager",
    "email": "msaggio@sdcautomation.com",
    "bMonth": 3,
    "bDay": 2,
    "id": "100059"
  },
  {
    "name": "Frank Stask",
    "role": "Machine Builder",
    "email": "fstask@sdcautomation.com",
    "bMonth": 4,
    "bDay": 23,
    "id": "100060"
  },
  {
    "name": "Paul Vinci",
    "role": "Sr Mechanical Engineer",
    "email": "pvinci@sdcautomation.com",
    "bMonth": 6,
    "bDay": 8,
    "id": "100067"
  },
  {
    "name": "Mike Gast",
    "role": "Project Execution Manager",
    "email": "mgast@sdcautomation.com",
    "bMonth": 11,
    "bDay": 26,
    "id": "100074"
  },
  {
    "name": "Ian Milne",
    "role": "Sr Mechanical Engineer",
    "email": "imilne@sdcautomation.com",
    "bMonth": 7,
    "bDay": 25,
    "id": "100077"
  },
  {
    "name": "Rich Troha",
    "role": "Industrial Electrician",
    "email": "rtroha@sdcautomation.com",
    "bMonth": 2,
    "bDay": 27,
    "id": "100081"
  },
  {
    "name": "Mitch Heinz",
    "role": "Machine Builder",
    "email": "mheinz@sdcautomation.com",
    "bMonth": 3,
    "bDay": 21,
    "id": "100089"
  },
  {
    "name": "Kevin Novotney",
    "role": "Machine Builder",
    "email": "knovotney@sdcautomation.com",
    "bMonth": 4,
    "bDay": 18,
    "id": "100094"
  },
  {
    "name": "Keith Schwentker",
    "role": "CNC Programmer",
    "email": "kschwentker@sdcautomation.com",
    "bMonth": 7,
    "bDay": 8,
    "id": "100098"
  },
  {
    "name": "Tim Shaffer",
    "role": "Lead Machine Debug and Commissioning Technician",
    "email": "tshaffer@sdcautomation.com",
    "bMonth": 12,
    "bDay": 14,
    "id": "100102"
  },
  {
    "name": "Rob Galosi",
    "role": "Sr Mechanical Engineer",
    "email": "rgalosi@sdcautomation.com",
    "bMonth": 7,
    "bDay": 27,
    "id": "100103"
  },
  {
    "name": "John Raguz",
    "role": "CNC Machinist & Programmer",
    "email": "jraguz@sdcautomation.com",
    "bMonth": 4,
    "bDay": 23,
    "id": "100108"
  },
  {
    "name": "Riana Pulsford",
    "role": "Marketing Strategist",
    "email": "rianademko@gmail.com",
    "bMonth": 4,
    "bDay": 17,
    "id": "100110"
  },
  {
    "name": "Sean Hamp",
    "role": "Machine Builder",
    "email": "shamp@sdcautomation.com",
    "bMonth": 6,
    "bDay": 1,
    "id": "100111"
  },
  {
    "name": "Rich Dula",
    "role": "Machine Builder",
    "email": "rdula@sdcautomation.com",
    "bMonth": 7,
    "bDay": 3,
    "id": "100113"
  },
  {
    "name": "Neil Simpson",
    "role": "Electrical Build Supervisor",
    "email": "nsimpson@sdcautomation.com",
    "bMonth": 9,
    "bDay": 22,
    "id": "100119"
  },
  {
    "name": "Caleb Hunkus",
    "role": "Mechanical Concept Engineer",
    "email": "chunkus@sdcautomation.com",
    "bMonth": 3,
    "bDay": 30,
    "id": "100120"
  },
  {
    "name": "Andrea Myers",
    "role": "HR & People Manager",
    "email": "amyers@sdcautomation.com",
    "bMonth": 3,
    "bDay": 24,
    "id": "100121"
  },
  {
    "name": "Dewayne Cantrell",
    "role": "Mechanical Build Supervisor",
    "email": "dcantrell@sdcautomation.com",
    "bMonth": 4,
    "bDay": 25,
    "id": "100125"
  },
  {
    "name": "Sarah Pfaff",
    "role": "Buyer / Spare Parts Coordinator",
    "email": "spfaff@sdcautomation.com",
    "bMonth": 9,
    "bDay": 2,
    "id": "100131"
  },
  {
    "name": "Jackie Hlavaty",
    "role": "Inventory Coordinator",
    "email": "jhlavaty@sdcautomation.com",
    "bMonth": 9,
    "bDay": 28,
    "id": "100133"
  },
  {
    "name": "Matt Armand",
    "role": "Electrical Engineer",
    "email": "marmand@sdcautomation.com",
    "bMonth": 10,
    "bDay": 27,
    "id": "100136"
  },
  {
    "name": "Trung Nguyen",
    "role": "Mechanical Engineer",
    "email": "tnguyen@sdcautomation.com",
    "bMonth": 1,
    "bDay": 14,
    "id": "100137"
  },
  {
    "name": "Andre Shirk",
    "role": "Industrial Electrician",
    "email": "ashirk@sdcautomation.com",
    "bMonth": 11,
    "bDay": 9,
    "id": "100138"
  },
  {
    "name": "Greg Sanford",
    "role": "Industrial Electrician",
    "email": "gsanford@sdcautomation.com",
    "bMonth": 7,
    "bDay": 18,
    "id": "100139"
  },
  {
    "name": "Patrick Wiles",
    "role": "Manufacturing Operations Manager",
    "email": "pwiles@sdcautomation.com",
    "bMonth": 6,
    "bDay": 22,
    "id": "100140"
  },
  {
    "name": "Xiao Li Liu",
    "role": "Project Manager",
    "email": "lliu@sdcautomation.com",
    "bMonth": 1,
    "bDay": 10,
    "id": "100141"
  },
  {
    "name": "Lisa Andreani",
    "role": "Chief Financial Officer",
    "email": "landreani@sdcautomation.com",
    "bMonth": 3,
    "bDay": 30,
    "id": "100145"
  },
  {
    "name": "Eric Simpson",
    "role": "Industrial Electrician",
    "email": "esimpson@sdcautomation.com",
    "bMonth": 12,
    "bDay": 30,
    "id": "100147"
  },
  {
    "name": "Mark Savina",
    "role": "Sr. Electrical Controls Engineer",
    "email": "msavina@sdcautomation.com",
    "bMonth": 2,
    "bDay": 22,
    "id": "100148"
  },
  {
    "name": "Pat Laffey",
    "role": "Senior Buyer",
    "email": "plaffey@sdcautomation.com",
    "bMonth": 3,
    "bDay": 6,
    "id": "100155"
  },
  {
    "name": "John Piscioneri",
    "role": "Industrial Electrician",
    "email": "jpiscioneri@sdcautomation.com",
    "bMonth": 7,
    "bDay": 17,
    "id": "100156"
  },
  {
    "name": "Billy Cantrell",
    "role": "Service Technician",
    "email": "bcantrell@sdcautomation.com",
    "bMonth": 7,
    "bDay": 22,
    "id": "100162"
  },
  {
    "name": "Nick Piscioneri",
    "role": "Project Manager",
    "email": "npiscioneri@sdcautomation.com",
    "bMonth": 11,
    "bDay": 27,
    "id": "100164"
  },
  {
    "name": "Adam Haviland",
    "role": "Mechanical Engineer",
    "email": "ahaviland@sdcautomation.com",
    "bMonth": 11,
    "bDay": 13,
    "id": "100165"
  },
  {
    "name": "Samuel Adams",
    "role": "Machine Builder",
    "email": "sadams@sdcautomation.com",
    "bMonth": 12,
    "bDay": 16,
    "id": "100167"
  },
  {
    "name": "Jessica Hudak",
    "role": "Technical Writer",
    "email": "jhudak@sdcautomation.com",
    "bMonth": 7,
    "bDay": 14,
    "id": "100169"
  },
  {
    "name": "Jesse Brown",
    "role": "Machine Builder",
    "email": "jbrown@sdcautomation.com",
    "bMonth": 7,
    "bDay": 24,
    "id": "100170"
  },
  {
    "name": "Daniel Siegfried",
    "role": "Mechanical Engineer",
    "email": "dsiegfried@sdcautomation.com",
    "bMonth": 4,
    "bDay": 4,
    "id": "100174"
  },
  {
    "name": "Dave Culbertson",
    "role": "Sr. Applications Engineer",
    "email": "dculbertson@sdcautomation.com",
    "bMonth": 4,
    "bDay": 17,
    "id": "100175"
  },
  {
    "name": "Ivan Galvez",
    "role": "Service Engineer - Automated Machines",
    "email": "igalvez@sdcautomation.com",
    "bMonth": 4,
    "bDay": 1,
    "id": "100176"
  },
  {
    "name": "Nick Grande",
    "role": "Industrial Painter - Automated Machines",
    "email": "ngrande@sdcautomation.com",
    "bMonth": 5,
    "bDay": 28,
    "id": "100182"
  },
  {
    "name": "Jon Miles",
    "role": "Machinist",
    "email": "jmiles@sdcautomation.com",
    "bMonth": 5,
    "bDay": 14,
    "id": "100183"
  },
  {
    "name": "Justin Stanko",
    "role": "Electrical Controls Engineer",
    "email": "jstanko@sdcautomation.com",
    "bMonth": 7,
    "bDay": 6,
    "id": "100184"
  },
  {
    "name": "Josh Latham",
    "role": "Sr. Applications Engineer",
    "email": "jlatham@sdcautomation.com",
    "bMonth": 5,
    "bDay": 5,
    "id": "100602"
  },
  {
    "name": "Nick Parshall",
    "role": "Robotics Programmer",
    "email": "nparshall@sdcautomation.com",
    "bMonth": 9,
    "bDay": 11,
    "id": "100603"
  },
  {
    "name": "Harlee Valvoda",
    "role": "Office Administrator",
    "email": "hvalvoda@sdcautomation.com",
    "bMonth": 9,
    "bDay": 2,
    "id": "100604"
  },
  {
    "name": "Rob Klingensmith",
    "role": "Service Engineer - Automated Machines",
    "email": "rklingensmith@sdcautomation.com",
    "bMonth": 7,
    "bDay": 25,
    "id": "100605"
  },
  {
    "name": "Hailey Rizor",
    "role": "Electrical Controls Engineer",
    "email": "hrizor@sdcautomation.com",
    "bMonth": 1,
    "bDay": 8,
    "id": "100606"
  },
  {
    "name": "Mark Ruane",
    "role": "Sr Mechanical Engineer",
    "email": "mruane@sdcautomation.com",
    "bMonth": 11,
    "bDay": 27,
    "id": "100607"
  },
  {
    "name": "Colin Simpson",
    "role": "Manufacturing Support & Facility Maintenance",
    "email": "csimpson@sdcautomation.com",
    "bMonth": 1,
    "bDay": 27,
    "id": "100608"
  },
  {
    "name": "Aubrie Russell",
    "role": "Marketing Intern",
    "email": "arussell@sdcautomation.com",
    "bMonth": 4,
    "bDay": 8,
    "id": "100609"
  },
  {
    "name": "Ryan Belliveau",
    "role": "Shipping and Receiving Associate",
    "email": "rbelliveau@sdcautomation.com",
    "bMonth": 5,
    "bDay": 1,
    "id": "100610"
  },
  {
    "name": "Mike Kuzius",
    "role": "Industrial Electrician",
    "email": "mkuzius@sdcautomation.com",
    "bMonth": 8,
    "bDay": 31,
    "id": "100701"
  },
  {
    "name": "Greg Weimer",
    "role": "Machine Builder",
    "email": "gweimer@sdcautomation.com",
    "bMonth": 3,
    "bDay": 1,
    "id": "100702"
  },
  {
    "name": "Rick Wagner",
    "role": "Business Development Manager",
    "email": "rwagner@sdcautomation.com",
    "bMonth": 11,
    "bDay": 15,
    "id": "100703"
  },
  {
    "name": "Kala Mallavarapu",
    "role": "Electrical Controls Engineer",
    "email": "umallavarapu@sdcautomation.com",
    "bMonth": 7,
    "bDay": 9,
    "id": "100704"
  }
];

function birthdaysForYear(year, employees) {
  const list = employees || DEFAULT_EMPLOYEES;
  return list.map(e => ({
    date: new Date(year, e.bMonth - 1, e.bDay),
    title: `${e.name}'s Birthday`,
    category: 'birthday',
    meta: { role: e.role, name: e.name },
    allDay: true,
    seeded: true,
  }));
}

function sampleEventsForYear(year) {
  return [
    { date: new Date(year, 0, 14),  title: 'Q1 Kickoff All-Hands',          category: 'company',  time: '10:00', endTime: '11:30', location: 'Main Auditorium', allDay: false, seeded: true },
    { date: new Date(year, 1, 10),  title: 'Annual Strategy Offsite',        category: 'company',  allDay: true,  seeded: true, endDate: new Date(year, 1, 12) },
    { date: new Date(year, 2, 18),  title: 'Engineering Summit',             category: 'company',  time: '09:00', endTime: '17:00', location: 'Floor 4',        allDay: false, seeded: true },
    { date: new Date(year, 3, 22),  title: 'Earth Day Volunteering',         category: 'company',  allDay: true,  seeded: true },
    { date: new Date(year, 4, 20),  title: 'Q2 All-Hands',                  category: 'company',  time: '10:00', endTime: '11:30', location: 'Main Auditorium', allDay: false, seeded: true },
    { date: new Date(year, 5, 17),  title: 'Mid-Year Review',                category: 'meeting',  time: '14:00', endTime: '15:00', allDay: false, seeded: true },
    { date: new Date(year, 7, 19),  title: 'Product Showcase',               category: 'company',  time: '13:00', endTime: '16:00', location: 'Demo Hall',      allDay: false, seeded: true },
    { date: new Date(year, 8, 9),   title: 'Fall Leadership Conference',     category: 'company',  allDay: true,  seeded: true, endDate: new Date(year, 8, 11) },
    { date: new Date(year, 9, 30),  title: 'Benefits Enrollment Deadline',   category: 'deadline', allDay: true,  seeded: true },
    { date: new Date(year, 10, 4),  title: 'Q4 Planning All-Hands',         category: 'company',  time: '10:00', endTime: '11:30', location: 'Main Auditorium', allDay: false, seeded: true },
    { date: new Date(year, 11, 11), title: 'Holiday Party',                  category: 'company',  time: '18:00', endTime: '22:00', location: 'The Grand Hall',  allDay: false, seeded: true },
    { date: new Date(year, 11, 23), title: 'Year-End Close Deadline',        category: 'deadline', allDay: true,  seeded: true },
  ];
}

function seedAllEvents(years, employees) {
  const all = [];
  years.forEach(y => {
    all.push(...holidaysForYear(y));
    all.push(...paydaysForYear(y));
    all.push(...birthdaysForYear(y, employees));
    all.push(...sampleEventsForYear(y));
  });
  return all.map((e, i) => ({ ...e, id: `seed-${i}-${+e.date}` }));
}

window.SDC_DATA = {
  DEFAULT_EMPLOYEES,
  seedAllEvents,
  holidaysForYear,
  paydaysForYear,
  birthdaysForYear,
  sampleEventsForYear,
};
