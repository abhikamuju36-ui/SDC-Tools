// SDC Centralized Calendar — Utility Functions & Constants

export var MONTHS       = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export var MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
export var DOW_LONG     = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
export var DOW_SHORT    = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
export var DOW_MINI     = ['S','M','T','W','T','F','S'];
export var HOUR_H       = 48; // px per hour in time grid

export var CATEGORIES = [
  { id: 'holiday',  label: 'SDC Holidays',   sw: 'var(--cat-holiday)',  swBg: 'var(--cat-holiday-bg)'  },
  { id: 'payday',   label: 'Pay Days',       sw: 'var(--cat-payday)',   swBg: 'var(--cat-payday-bg)'   },
  { id: 'birthday', label: 'Birthdays',      sw: 'var(--cat-birthday)', swBg: 'var(--cat-birthday-bg)' },
  { id: 'meeting',  label: 'Team Meetings',  sw: 'var(--cat-meeting)',  swBg: 'var(--cat-meeting-bg)'  },
  { id: 'company',  label: 'Company Events', sw: 'var(--cat-company)',  swBg: 'var(--cat-company-bg)'  },
  { id: 'deadline', label: 'Deadlines',      sw: 'var(--cat-deadline)', swBg: 'var(--cat-deadline-bg)' },
  { id: 'personal', label: 'Personal',       sw: 'var(--cat-personal)', swBg: 'var(--cat-personal-bg)' },
  { id: 'vacation', label: 'Vacation / PTO', sw: 'var(--cat-vacation)', swBg: 'var(--cat-vacation-bg)' },
];
export var CATMAP = Object.fromEntries(CATEGORIES.map(c => [c.id, c]));

export var TIMEZONES = [
  'America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
  'America/Phoenix','America/Anchorage','Pacific/Honolulu',
  'Europe/London','Europe/Paris','Europe/Berlin','Europe/Moscow',
  'Asia/Dubai','Asia/Kolkata','Asia/Shanghai','Asia/Tokyo','Asia/Seoul',
  'Australia/Sydney','Pacific/Auckland',
];

// ─── Date helpers ─────────────────────────────────────────────
export var isSameDay   = (a, b) => a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
export var ymd         = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export var parseYMD    = (s) => { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); };
export var startOfMonth= (d) => new Date(d.getFullYear(), d.getMonth(), 1);
export var endOfMonth  = (d) => new Date(d.getFullYear(), d.getMonth()+1, 0);
export var addMonths   = (d,n) => new Date(d.getFullYear(), d.getMonth()+n, 1);
export var addDays     = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
export var daysBetween = (a,b) => Math.round((b-a)/86400000);
export var startOfWeek = (d, ws=1) => { const diff=(d.getDay()-ws+7)%7; return addDays(d,-diff); };

export var fmtDateLong = (d) => `${DOW_LONG[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
export var fmtDateShort= (d) => `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;

export var fmtTime = (hhmm, tz) => {
  if (!hhmm) return '';
  if (tz) {
    const now = new Date();
    const [h,m] = hhmm.split(':').map(Number);
    now.setHours(h,m,0,0);
    return now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:tz});
  }
  const [h,m] = hhmm.split(':').map(Number);
  const p = h>=12?'PM':'AM';
  return `${((h+11)%12)+1}:${String(m).padStart(2,'0')} ${p}`;
};

export var timeToMin = (hhmm) => { if(!hhmm)return 0; const[h,m]=hhmm.split(':').map(Number); return h*60+m; };
export var rotateDow = (s,arr) => arr.slice(s).concat(arr.slice(0,s));

// Feature 15: ISO week number
export function getWeekNum(d) {
  const date = new Date(d); date.setHours(0,0,0,0);
  date.setDate(date.getDate() + 3 - (date.getDay()+6)%7);
  const week1 = new Date(date.getFullYear(),0,4);
  return 1 + Math.round(((date-week1)/86400000 - 3 + (week1.getDay()+6)%7) / 7);
}

// ─── Recurring event expansion ────────────────────────────────
export function expandRecurring(ev, rangeStart, rangeEnd) {
  if (!ev.repeat || ev.repeat==='none') return [ev];
  const instances=[], base=new Date(ev.date);
  let cur, maxIt=500;

  const mk=(d)=>({...ev, id:`${ev.id}-r-${ymd(d)}`, date:new Date(d), isRecurringInstance:true, masterEventId:ev.id});

  if (ev.repeat==='daily') {
    cur=new Date(base);
    while(cur<rangeStart) cur=addDays(cur,1);
    while(cur<=rangeEnd && maxIt-->0){ instances.push(mk(cur)); cur=addDays(cur,1); }
  } else if (ev.repeat==='weekly') {
    cur=new Date(base);
    while(cur<rangeStart) cur=addDays(cur,7);
    while(cur<=rangeEnd && maxIt-->0){ instances.push(mk(cur)); cur=addDays(cur,7); }
  } else if (ev.repeat==='monthly') {
    cur=new Date(rangeStart.getFullYear(), rangeStart.getMonth(), base.getDate());
    if(cur<rangeStart) cur=new Date(cur.getFullYear(), cur.getMonth()+1, base.getDate());
    while(cur<=rangeEnd && maxIt-->0){ instances.push(mk(cur)); cur=new Date(cur.getFullYear(), cur.getMonth()+1, base.getDate()); }
  } else if (ev.repeat==='yearly') {
    cur=new Date(rangeStart.getFullYear(), base.getMonth(), base.getDate());
    if(cur<rangeStart) cur.setFullYear(cur.getFullYear()+1);
    while(cur<=rangeEnd && maxIt-->0){ instances.push(mk(cur)); cur=new Date(cur.getFullYear()+1, cur.getMonth(), cur.getDate()); }
  }
  return instances;
}

export function expandAll(events, rangeStart, rangeEnd) {
  const out=[];
  events.forEach(ev=>{
    if(ev.repeat && ev.repeat!=='none') out.push(...expandRecurring(ev,rangeStart,rangeEnd));
    else out.push(ev);
  });
  return out;
}

// ─── ICS export / import ─────────────────────────────────────
export function icsDate(date, time) {
  const y=date.getFullYear(), mo=String(date.getMonth()+1).padStart(2,'0'), d=String(date.getDate()).padStart(2,'0');
  if (!time) return `${y}${mo}${d}`;
  const [h,m]=time.split(':');
  return `${y}${mo}${d}T${h}${m}00`;
}

export function generateICS(events) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//SDC Automation//Centralized Calendar//EN','CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  events.forEach(ev=>{
    const now=new Date();
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${ev.id}@sdc-calendar`);
    lines.push(`DTSTAMP:${icsDate(now,`${now.getHours()}:${now.getMinutes()}`)}`);
    if (ev.allDay||!ev.time) {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(ev.date)}`);
      const end=ev.endDate ? addDays(new Date(ev.endDate),1) : addDays(new Date(ev.date),1);
      lines.push(`DTEND;VALUE=DATE:${icsDate(end)}`);
    } else {
      lines.push(`DTSTART:${icsDate(ev.date,ev.time)}`);
      lines.push(`DTEND:${icsDate(ev.date,ev.endTime||ev.time)}`);
    }
    lines.push(`SUMMARY:${ev.title.replace(/\n/g,'\\n')}`);
    if(ev.description) lines.push(`DESCRIPTION:${ev.description.replace(/\n/g,'\\n')}`);
    if(ev.location)    lines.push(`LOCATION:${ev.location.replace(/\n/g,'\\n')}`);
    if(ev.url)         lines.push(`URL:${ev.url}`);
    const freqMap={daily:'DAILY',weekly:'WEEKLY',monthly:'MONTHLY',yearly:'YEARLY'};
    if(ev.repeat && ev.repeat!=='none') lines.push(`RRULE:FREQ=${freqMap[ev.repeat]}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

export function parseICS(text) {
  const events=[];
  text.split('BEGIN:VEVENT').slice(1).forEach(block=>{
    const get=(key)=>{
      const m=block.match(new RegExp(`^${key}[;:][^\r\n]*`,'m'));
      return m ? m[0].split(':').slice(1).join(':').trim() : null;
    };
    const title=get('SUMMARY'); if(!title) return;
    const dtstart=get('DTSTART'); if(!dtstart) return;
    let date, time='', allDay=true;
    const raw=dtstart.replace(/[TZ]/g,'');
    date=parseYMD(`${raw.slice(0,4)}-${raw.slice(4,6)}-${raw.slice(6,8)}`);
    if(dtstart.includes('T')){ time=`${dtstart.slice(9,11)}:${dtstart.slice(11,13)}`; allDay=false; }
    events.push({
      id:`import-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
      title, date, time, allDay,
      category:'personal',
      description:get('DESCRIPTION')||'',
      location:get('LOCATION')||'',
      url:get('URL')||'',
    });
  });
  return events;
}

export function downloadFile(filename, content, mime) {
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([content],{type:mime}));
  a.download=filename; a.click();
  URL.revokeObjectURL(a.href);
}

// ─── Conflict detection ───────────────────────────────────────
export function detectConflicts(newEv, existing) {
  if (newEv.allDay||!newEv.time) return [];
  const ns=timeToMin(newEv.time), ne=newEv.endTime?timeToMin(newEv.endTime):ns+60;
  const nd=ymd(newEv.date instanceof Date ? newEv.date : parseYMD(newEv.date));
  return existing.filter(ev=>{
    if(ev.id===newEv.id||ev.allDay||!ev.time) return false;
    if(ymd(ev.date)!==nd) return false;
    const es=timeToMin(ev.time), ee=ev.endTime?timeToMin(ev.endTime):es+60;
    return ns<ee&&ne>es;
  });
}

// ─── Time-grid layout (column assignment for overlapping events) ─
export function layoutTimeEvents(events) {
  const sorted=[...events].sort((a,b)=>timeToMin(a.time)-timeToMin(b.time));
  const cols=[];
  sorted.forEach(ev=>{
    const es=timeToMin(ev.time), ee=ev.endTime?timeToMin(ev.endTime):es+60;
    let c=0;
    while(cols[c]&&cols[c].some(o=>{ const os=timeToMin(o.time),oe=o.endTime?timeToMin(o.endTime):os+60; return es<oe&&ee>os; })) c++;
    if(!cols[c])cols[c]=[];
    cols[c].push(ev);
    ev._col=c;
  });
  sorted.forEach(ev=>{
    const es=timeToMin(ev.time),ee=ev.endTime?timeToMin(ev.endTime):es+60;
    let max=ev._col;
    sorted.forEach(o=>{ if(o===ev)return; const os=timeToMin(o.time),oe=o.endTime?timeToMin(o.endTime):os+60; if(es<oe&&ee>os)max=Math.max(max,o._col); });
    ev._totalCols=max+1;
  });
  return sorted;
}

// ─── Storage ─────────────────────────────────────────────────
export var USER_EVENTS_KEY = 'sdc_user_events_v2';
export var PREFS_KEY       = 'sdc_prefs_v2';
export var EMPLOYEES_KEY   = 'sdc_employees_v1';

export function loadUserEvents() {
  try {
    const raw=localStorage.getItem(USER_EVENTS_KEY);
    if(!raw) return [];
    return JSON.parse(raw).map(e=>({...e, date:new Date(e.date), endDate:e.endDate?new Date(e.endDate):null}));
  } catch { return []; }
}
export function saveUserEvents(events) {
  try {
    localStorage.setItem(USER_EVENTS_KEY, JSON.stringify(events.map(e=>({
      ...e,
      date:e.date instanceof Date?e.date.toISOString():e.date,
      endDate:e.endDate instanceof Date?e.endDate.toISOString():e.endDate,
    }))));
    return true;
  } catch { return false; }
}
export function loadPrefs()  { try { return JSON.parse(localStorage.getItem(PREFS_KEY)||'{}'); } catch { return {}; } }
export function savePrefs(p) { try { localStorage.setItem(PREFS_KEY,JSON.stringify(p)); } catch {} }
export function loadEmployees() { try { const r=localStorage.getItem(EMPLOYEES_KEY); return r?JSON.parse(r):null; } catch { return null; } }
export function saveEmployees(e){ try { localStorage.setItem(EMPLOYEES_KEY,JSON.stringify(e)); } catch {} }
