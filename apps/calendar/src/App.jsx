import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { CATEGORIES, MONTHS, MONTHS_SHORT, addDays, addMonths, startOfWeek, fmtDateLong, expandAll, loadUserEvents, saveUserEvents, loadPrefs, savePrefs, loadEmployees, saveEmployees } from './utils.js';
import { API_URL, LOCAL_MODE, LOCAL_USER, APP_VERSION, TWEAK_DEFAULTS, ACCENT_SWATCHES, Icon } from './constants.jsx';
import { seedAllEvents, DEFAULT_EMPLOYEES } from './data.js';

import HoverCard from './components/HoverCard.jsx';
import KeyboardShortcuts from './components/KeyboardShortcuts.jsx';
import MonthSummaryBar from './components/MonthSummaryBar.jsx';
import ContextMenu from './components/ContextMenu.jsx';
import MonthGrid from './components/MonthView.jsx';
import WeekView from './components/WeekView.jsx';
import DayView from './components/DayView.jsx';
import EventModal from './components/EventModal.jsx';
import DayModal from './components/DayModal.jsx';
import EmployeeModal from './components/EmployeeModal.jsx';
import ImportExportModal from './components/ImportExportModal.jsx';
import TweaksPanel from './components/TweaksPanel.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import SchedulerPanel from './components/SchedulerPanel.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import Toast from './components/Toast.jsx';
import Sidebar, { Resizer } from './components/Sidebar.jsx';

// ─── Auth helpers ─────────────────────────────────────────────
function parseJWT(token) {
  try { return JSON.parse(atob(token.split('.')[1])); } catch { return null; }
}
function getStoredAuth() {
  const token = localStorage.getItem('sdc_auth_token');
  if (!token) return null;
  const payload = parseJWT(token);
  if (!payload || payload.exp * 1000 < Date.now()) {
    localStorage.removeItem('sdc_auth_token');
    return null;
  }
  return { token, ...payload };
}

// ─── DeleteConfirmModal (used inside CalendarApp for context-menu deletes) ──
function DeleteConfirmModal({ title, onConfirm, onCancel }) {
  return (
    <div className="scrim" onClick={e=>{ if(e.target===e.currentTarget) onCancel(); }}>
      <div className="modal" style={{width:'min(400px,calc(100vw - 32px))'}} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>Delete Event</h2>
        </div>
        <div className="modal-body">
          <p style={{margin:0,color:'var(--ink-2)'}}>Delete <strong>{title}</strong>? This cannot be undone.</p>
        </div>
        <div className="modal-foot">
          <div className="spacer"/>
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className="btn" style={{color:'var(--danger,#CC3333)',borderColor:'var(--danger,#CC3333)'}} onClick={onConfirm}>Delete</button>
        </div>
      </div>
    </div>
  );
}

// ─── Error Boundary ───────────────────────────────────────────
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error('[SDC Calendar Error]', error, info.componentStack); }
  render() {
    if (this.state.error) return (
      <div style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',height:'100vh',gap:16,padding:32,textAlign:'center'}}>
        <div style={{fontSize:48}}>⚠️</div>
        <h2 style={{margin:0,fontSize:20,color:'var(--ink)'}}>Something went wrong</h2>
        <p style={{color:'var(--ink-3)',maxWidth:440,lineHeight:1.5,margin:0}}>{this.state.error.message}</p>
        <button className="btn primary" onClick={()=>{ this.setState({error:null}); window.location.reload(); }}>Reload Calendar</button>
      </div>
    );
    return this.props.children;
  }
}

// ─── CalendarApp — full calendar UI ───────────────────────────
function CalendarApp({ authToken, authUser, allowedCats, onSignOut }) {
  const [serverOnline, setServerOnline] = useState(true);
  const [adminOpen, setAdminOpen] = useState(false);
  const [schedOpen,        setSchedOpen]        = useState(false);
  const [schedulerEvents,  setSchedulerEvents]  = useState(() => { try { return JSON.parse(localStorage.getItem('sdc_scheduler_events') || '[]'); } catch { return []; } });
  const [viewDate, setViewDate]=useState(()=>{ const s=localStorage.getItem('sdc_view_date'); return s?new Date(s):new Date(); });
  const [viewMode, setViewMode]=useState('month'); // month | week | day
  const [userEvents, setUserEventsRaw]=useState(()=>loadUserEvents());
  const [undoStack, setUndoStack]=useState([]);
  const [redoStack, setRedoStack]=useState([]);
  const [activeCats, setActiveCats]=useState(()=>new Set(CATEGORIES.map(c=>c.id)));
  const [search, setSearch]=useState('');
  const [modal, setModal]=useState(null);
  const [dayModal, setDayModal]=useState(null);
  const [tweaksOpen, setTweaksOpen]=useState(false);
  const [empModal, setEmpModal]=useState(false);
  const [importExportModal, setImportExportModal]=useState(false);
  const [toast, setToast]=useState(null);
  const [employeesVer, setEmployeesVer]=useState(0);
  const notifiedRef=useRef(new Set());
  // New state for features
  const [hoverCard, setHoverCard]=useState(null);
  const [jumpOpen, setJumpOpen]=useState(false);
  const [shortcutsOpen, setShortcutsOpen]=useState(false);
  const [myEventsOnly, setMyEventsOnly]=useState(false);
  const [appVersion, setAppVersion]=useState(APP_VERSION);
  useEffect(()=>{ if(window.electronAPI?.getVersion) window.electronAPI.getVersion().then(v=>{ if(v) setAppVersion(v); }); },[]);
  const [contextMenu, setContextMenu]=useState(null);
  const [deleteConfirm, setDeleteConfirm]=useState(null); // {id, title}
  const [userMenuOpen, setUserMenuOpen]=useState(false);
  const userMenuRef=useRef(null);
  const hoverTimerRef=useRef(null);

  // Part 4e: employees fetched from API; falls back to localStorage then DEFAULT_EMPLOYEES
  const [employees, setEmployees]=useState(()=>loadEmployees()||DEFAULT_EMPLOYEES);
  useEffect(()=>{
    fetch(`${API_URL}/api/employees`)
      .then(r=>r.ok?r.json():null)
      .then(data=>{
        if(Array.isArray(data)&&data.length>0) {
          setEmployees(data);
        } else if(Array.isArray(data)&&data.length===0) {
          // Auto-seed on first run — send DEFAULT_EMPLOYEES in the body
          const seedHeaders = {'Content-Type':'application/json'};
          if(authToken) seedHeaders['Authorization'] = `Bearer ${authToken}`;
          fetch(`${API_URL}/api/employees/seed`,{
            method:'POST',
            headers: seedHeaders,
            body:JSON.stringify(DEFAULT_EMPLOYEES),
          })
            .then(r=>r.ok?r.json():null)
            .then(seeded=>{ if(Array.isArray(seeded)&&seeded.length>0) setEmployees(seeded); })
            .catch(()=>{});
        }
      })
      .catch(()=>{}); // silently fall back to localStorage/DEFAULT_EMPLOYEES
  },[employeesVer]);

  useEffect(() => {
    if (LOCAL_MODE) return;
    const headers = authToken ? { Authorization: `Bearer ${authToken}` } : {};
    fetch(`${API_URL}/api/events`, { headers, signal: AbortSignal.timeout(8000) })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const mapped = data.map(e => ({
            ...e,
            date: new Date(e.date + 'T00:00:00'),
            endDate: e.endDate ? new Date(e.endDate + 'T00:00:00') : null
          }));
          setUserEventsRaw(mapped);
        }
      }).catch(console.error);
  }, [authToken]);

  const savedPrefs=loadPrefs();
  const [prefs, setPrefs]=useState({...TWEAK_DEFAULTS,...savedPrefs});

  // Undo-aware setter
  const setUserEvents=useCallback((newEvents, skipHistory=false)=>{
    if(!skipHistory) {
      setUndoStack(prev=>[...prev.slice(-19), userEvents]);
      setRedoStack([]);
    }
    setUserEventsRaw(newEvents);
  },[userEvents]);

  const undo=useCallback(()=>{
    setUndoStack(prev=>{ if(prev.length===0) return prev; const top=prev[prev.length-1]; setRedoStack(r=>[userEvents,...r.slice(0,19)]); setUserEventsRaw(top); return prev.slice(0,-1); });
  },[userEvents]);
  const redo=useCallback(()=>{
    setRedoStack(prev=>{ if(prev.length===0) return prev; const top=prev[0]; setUndoStack(s=>[...s.slice(-19),userEvents]); setUserEventsRaw(top); return prev.slice(1); });
  },[userEvents]);

  // Feature 2: Hover card helpers
  // FIX: capture rect synchronously — React nullifies e.currentTarget after
  // the handler returns, so calling getBoundingClientRect inside setTimeout
  // always throws "Cannot read properties of null".
  const showHover=useCallback((ev, domEvent)=>{
    clearTimeout(hoverTimerRef.current);
    let rect;
    try { rect = domEvent.currentTarget ? domEvent.currentTarget.getBoundingClientRect() : null; } catch(e) { return; }
    if(!rect) return;
    hoverTimerRef.current=setTimeout(()=>{ setHoverCard({event:ev, rect}); }, 400);
  },[]);
  const hideHover=useCallback(()=>{
    clearTimeout(hoverTimerRef.current);
    setHoverCard(null);
  },[]);

  // Persist
  useEffect(()=>{ savePrefs(prefs); },[prefs]);
  useEffect(()=>{ localStorage.setItem('sdc_view_date',viewDate.toISOString()); },[viewDate]);
  useEffect(()=>{ if(!saveUserEvents(userEvents)) setToast('⚠️ Events not saved — browser storage may be full'); },[userEvents]);
  useEffect(()=>{ localStorage.setItem('sdc_scheduler_events', JSON.stringify(schedulerEvents)); },[schedulerEvents]);

  // Server health check — poll every 30s, show banner when offline
  useEffect(()=>{
    if(LOCAL_MODE) return;
    const check=()=>{
      fetch(`${API_URL}/api/health`,{signal:AbortSignal.timeout(5000)})
        .then(()=>setServerOnline(true))
        .catch(()=>setServerOnline(false));
    };
    check();
    const id=setInterval(check,30000);
    return ()=>clearInterval(id);
  },[]);

  // Close user menu on outside click
  useEffect(()=>{
    if(!userMenuOpen) return;
    const handler=(e)=>{ if(userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener('mousedown', handler);
    return ()=>document.removeEventListener('mousedown', handler);
  },[userMenuOpen]);

  // Theme + accent
  useEffect(()=>{
    document.documentElement.setAttribute('data-theme',prefs.theme||'light');
    const acc=ACCENT_SWATCHES.find(s=>s.value===prefs.accent)||ACCENT_SWATCHES[0];
    document.documentElement.style.setProperty('--accent',acc.value);
    document.documentElement.style.setProperty('--accent-ink',acc.ink);
    document.documentElement.style.setProperty('--accent-soft',acc.soft);
  },[prefs.theme,prefs.accent]);

  // Edit-mode protocol
  useEffect(()=>{
    const h=(e)=>{ const d=e.data||{}; if(d.type==='__activate_edit_mode') setTweaksOpen(true); if(d.type==='__deactivate_edit_mode') setTweaksOpen(false); };
    window.addEventListener('message',h);
    try { window.parent.postMessage({type:'__edit_mode_available'},'*'); } catch {}
    return ()=>window.removeEventListener('message',h);
  },[]);

  // Seeded events
  const seeded=useMemo(()=>{
    const year=viewDate.getFullYear();
    return seedAllEvents([year-1,year,year+1], employees);
  },[viewDate.getFullYear(), employeesVer, employees]);

  // Expand recurring user events + scheduler tasks from SDC Scheduler
  const allEvents=useMemo(()=>{
    const rs=new Date(viewDate.getFullYear()-1,0,1);
    const re=new Date(viewDate.getFullYear()+2,11,31);
    const expandedUser=expandAll(userEvents,rs,re);
    // Scheduler events: normalize date strings → Date objects.
    // endDate is intentionally set to null — tasks often span months and would
    // render as stacked full-width banners across every row. Show as chips on
    // start date only; full date range is visible in the event detail panel.
    const schedulerVisible=schedulerEvents
      .filter(e=>{ const d=new Date(e.date); return d>=rs && d<=re; })
      .map(e=>({
        ...e,
        date:    new Date(e.date),
        endDate: null,
      }));
    if(myEventsOnly) return [...expandedUser.filter(e=>!e.seeded), ...schedulerVisible];
    return [...seeded,...expandedUser,...schedulerVisible];
  },[seeded,userEvents,schedulerEvents,viewDate.getFullYear(),myEventsOnly]);

  // Browser notification polling
  useEffect(()=>{
    if(!('Notification' in window)) return;
    const check=()=>{
      if(Notification.permission!=='granted') return;
      const now=new Date();
      allEvents.forEach(ev=>{
        if(!ev.notify||ev.seeded) return;
        const evDate=new Date(ev.date);
        if(ev.time){ const[h,m]=ev.time.split(':').map(Number); evDate.setHours(h,m,0,0); }
        const triggerMs=evDate.getTime()-Number(ev.notify)*60000;
        const key=`${ev.id}-${ev.notify}`;
        if(!notifiedRef.current.has(key) && Math.abs(now.getTime()-triggerMs)<65000) {
          notifiedRef.current.add(key);
          try {
            const notifTitle = `📅 ${ev.title}`;
            const notifBody  = `In ${ev.notify} min${ev.location ? ' — ' + ev.location : ''}`;
            if (window.electronAPI?.showNotification) {
              window.electronAPI.showNotification({ source: 'calendar', type: 'reminder', title: notifTitle, body: notifBody, icon: '📅' });
            } else if ('Notification' in window && Notification.permission === 'granted') {
              new Notification(notifTitle, { body: notifBody, icon: 'assets/sdc-logo.png' });
            }
          } catch {}
        }
      });
    };
    check();
    const id=setInterval(check,60000);
    return ()=>clearInterval(id);
  },[allEvents]);

  // Request notification permission on first interaction
  const requestNotifPermission=()=>{
    if('Notification' in window && Notification.permission==='default') {
      Notification.requestPermission().then(p=>{ if(p==='granted') setToast('Notifications enabled!'); });
    }
  };

  // Feature 14+5: Enhanced keyboard shortcuts
  useEffect(()=>{
    const h=(e)=>{
      if(e.target.matches('input,textarea,select')) return;
      if(e.ctrlKey||e.metaKey) {
        if(e.key==='z'&&!e.shiftKey){ e.preventDefault(); undo(); return; }
        if((e.key==='y')||(e.key==='z'&&e.shiftKey)){ e.preventDefault(); redo(); return; }
      }
      if(e.key==='Escape'){ setModal(null); setDayModal(null); setShortcutsOpen(false); setJumpOpen(false); setContextMenu(null); return; }
      if(e.key==='?'){ setShortcutsOpen(true); return; }
      if(e.key==='ArrowLeft')  setViewDate(d=>viewMode==='day'?addDays(d,-1):viewMode==='week'?addDays(d,-7):addMonths(d,-1));
      else if(e.key==='ArrowRight') setViewDate(d=>viewMode==='day'?addDays(d,1):viewMode==='week'?addDays(d,7):addMonths(d,1));
      else if(e.key.toLowerCase()==='t') setViewDate(new Date());
      else if(e.key.toLowerCase()==='n'&&!modal) setModal({mode:'new',date:viewDate});
      else if(e.key.toLowerCase()==='m') setViewMode('month');
      else if(e.key.toLowerCase()==='w') setViewMode('week');
      else if(e.key.toLowerCase()==='d') { setViewMode('day'); setViewDate(new Date()); }
      else if(e.key==='1') setViewMode('month');
      else if(e.key==='2') setViewMode('week');
      else if(e.key==='3') { setViewMode('day'); setViewDate(new Date()); }
    };
    window.addEventListener('keydown',h);
    return ()=>window.removeEventListener('keydown',h);
  },[modal,viewDate,viewMode,undo,redo]);

  const handleSave=async (ev)=>{
    if (LOCAL_MODE) {
      setUserEvents(prev=>{ const i=prev.findIndex(x=>x.id===ev.id); if(i>=0){ const c=[...prev]; c[i]=ev; return c; } return [...prev,ev]; });
      setModal(null);
      requestNotifPermission();
      return;
    }
    const isNew = !userEvents.some(x => x.id === ev.id);
    const url = isNew ? `${API_URL}/api/events` : `${API_URL}/api/events/${ev.id}`;
    const method = isNew ? 'POST' : 'PUT';
    try {
      await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` },
        body: JSON.stringify({
          ...ev,
          date: ev.date.toISOString().split('T')[0],
          endDate: ev.endDate ? ev.endDate.toISOString().split('T')[0] : null
        })
      });
      const r = await fetch(`${API_URL}/api/events`, { headers: { Authorization: `Bearer ${authToken}` } });
      const data = await r.json();
      if (Array.isArray(data)) {
        setUserEventsRaw(data.map(e => ({ ...e, date: new Date(e.date + 'T00:00:00'), endDate: e.endDate ? new Date(e.endDate + 'T00:00:00') : null })));
      }
      setModal(null);
      requestNotifPermission();
    } catch (e) {
      setToast('Failed to save event to server.');
    }
  };

  const handleDelete=async (id)=>{
    if (LOCAL_MODE) {
      setUserEvents(prev=>prev.filter(x=>x.id!==id));
      setModal(null);
      return;
    }
    try {
      await fetch(`${API_URL}/api/events/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${authToken}` } });
      setUserEventsRaw(prev => prev.filter(x => x.id !== id));
      setModal(null);
    } catch (e) {
      setToast('Failed to delete event.');
    }
  };
  const handleDrop=(evId, newDate)=>{
    setUserEvents(prev=>prev.map(ev=>{ if(ev.id!==evId) return ev; const nd=new Date(newDate); if(ev.endDate){ const dur=ev.endDate-ev.date; return {...ev,date:nd,endDate:new Date(nd.getTime()+dur)}; } return {...ev,date:nd}; }));
    setToast('Event moved');
  };
  const handleImport = async (events) => {
    if (LOCAL_MODE) {
      setUserEvents(prev=>[
        ...prev.filter(ev=>!String(ev.id).includes('paylocity')),
        ...events
      ]);
      setToast(`${events.length} events imported (local)`);
      return;
    }

    try {
      setToast(`Saving ${events.length} events to database...`);
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${authToken}` };

      // 1. Fetch all current events from backend
      const r = await fetch(`${API_URL}/api/events`, { headers });
      const current = await r.json();

      // 2. Delete old Paylocity records sequentially
      if (Array.isArray(current)) {
        const toDelete = current.filter(ev => String(ev.id).includes('paylocity'));
        for (const ev of toDelete) {
          await fetch(`${API_URL}/api/events/${ev.id}`, { method: 'DELETE', headers });
        }
      }

      // 3. POST new events
      for (const ev of events) {
        await fetch(`${API_URL}/api/events`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...ev,
            date: ev.date instanceof Date ? ev.date.toISOString().split('T')[0] : String(ev.date),
            endDate: ev.endDate ? (ev.endDate instanceof Date ? ev.endDate.toISOString().split('T')[0] : String(ev.endDate)) : null
          })
        });
      }

      // 4. Reload userEvents state from backend
      const r2 = await fetch(`${API_URL}/api/events`, { headers });
      const finalData = await r2.json();
      if (Array.isArray(finalData)) {
        setUserEventsRaw(finalData.map(e => ({ ...e, date: new Date(e.date + 'T00:00:00'), endDate: e.endDate ? new Date(e.endDate + 'T00:00:00') : null })));
      }

      setToast(`${events.length} events saved to shared database!`);
    } catch (err) {
      setToast('Failed to save events to database.');
    }
  };

  const handleClearPaylocity = async () => {
    if (LOCAL_MODE) {
      setUserEvents(prev=>prev.filter(ev=>!String(ev.id).includes('paylocity')));
      setToast(`Paylocity records cleared (local)`);
      return;
    }
    try {
      const headers = { Authorization: `Bearer ${authToken}` };
      const r = await fetch(`${API_URL}/api/events`, { headers });
      const current = await r.json();

      if (Array.isArray(current)) {
        const toDelete = current.filter(ev => String(ev.id).includes('paylocity'));
        for (const ev of toDelete) {
          await fetch(`${API_URL}/api/events/${ev.id}`, { method: 'DELETE', headers });
        }
      }

      const r2 = await fetch(`${API_URL}/api/events`, { headers });
      const finalData = await r2.json();
      if (Array.isArray(finalData)) {
        setUserEventsRaw(finalData.map(e => ({ ...e, date: new Date(e.date + 'T00:00:00'), endDate: e.endDate ? new Date(e.endDate + 'T00:00:00') : null })));
      }
      setToast('Paylocity records removed from shared database.');
    } catch (err) {
      setToast('Failed to clear records from server.');
    }
  };

  const handleSaveEmployees=(emps)=>{ saveEmployees(emps); setEmployeesVer(v=>v+1); setEmpModal(false); setToast('Directory saved'); };

  // Feature 13+16: Pin toggle
  const handleTogglePin=(ev)=>{
    setUserEvents(userEvents.map(e=>e.id===ev.id?{...e,pinned:!e.pinned}:e));
  };

  // Feature 25: Drag-drop in time grid
  const handleDropWithTime=(evId, day, newTime)=>{
    setUserEvents(userEvents.map(ev=>{
      if(ev.id!==evId) return ev;
      const nd=new Date(day); if(ev.endDate){ const dur=ev.endDate-ev.date; return {...ev,date:nd,time:newTime,endDate:new Date(nd.getTime()+dur)}; }
      return {...ev,date:nd,time:newTime};
    }));
    setToast('Event moved');
  };

  // Feature 17: Touch swipe gestures
  useEffect(()=>{
    let startX=0, startY=0;
    const onStart=(e)=>{ startX=e.touches[0].clientX; startY=e.touches[0].clientY; };
    const onEnd=(e)=>{
      const dx=e.changedTouches[0].clientX-startX;
      const dy=e.changedTouches[0].clientY-startY;
      if(Math.abs(dx)>60&&Math.abs(dx)>Math.abs(dy)*1.5){
        if(dx<0) setViewDate(d=>viewMode==='day'?addDays(d,1):viewMode==='week'?addDays(d,7):addMonths(d,1));
        else setViewDate(d=>viewMode==='day'?addDays(d,-1):viewMode==='week'?addDays(d,-7):addMonths(d,-1));
      }
    };
    document.addEventListener('touchstart',onStart,{passive:true});
    document.addEventListener('touchend',onEnd,{passive:true});
    return ()=>{ document.removeEventListener('touchstart',onStart); document.removeEventListener('touchend',onEnd); };
  },[viewDate,viewMode]);

  // Nav title for topbar
  const navTitle=()=>{
    if(viewMode==='month') return `${MONTHS[viewDate.getMonth()]} ${viewDate.getFullYear()}`;
    if(viewMode==='week') {
      const ws=startOfWeek(viewDate,prefs.weekStart);
      const we=addDays(ws,6);
      return ws.getMonth()===we.getMonth() ? `${MONTHS[ws.getMonth()]} ${ws.getFullYear()}` : `${MONTHS_SHORT[ws.getMonth()]} – ${MONTHS_SHORT[we.getMonth()]} ${we.getFullYear()}`;
    }
    return fmtDateLong(viewDate);
  };

  const tz=prefs.timezone||null;

  return (
    <div className={`app density-${prefs.density} ${prefs.showWeekends?'':'weekend-hidden'}`} style={{gridTemplateColumns:`${prefs.sidebarWidth||300}px 6px 1fr`}}>
      <Sidebar
        viewDate={viewDate} setViewDate={setViewDate} allEvents={allEvents}
        activeCats={activeCats} setActiveCats={setActiveCats}
        search={search} setSearch={setSearch}
        prefs={prefs} setPrefs={setPrefs}
        onNewEvent={()=>setModal({mode:'new',date:viewDate})}
        onOpenEvent={(ev)=>setModal({mode:'edit',event:ev})}
        weekStart={prefs.weekStart}
        onOpenDirectory={()=>setEmpModal(true)}
        onOpenImportExport={()=>setImportExportModal(true)}
        onUndo={undo} onRedo={redo}
        canUndo={undoStack.length>0} canRedo={redoStack.length>0}
        myEventsOnly={myEventsOnly} setMyEventsOnly={setMyEventsOnly}
        authUser={authUser} onSignOut={onSignOut}
        appVersion={appVersion}
      />
      <Resizer width={prefs.sidebarWidth||300} onChange={w=>setPrefs(p=>({...p,sidebarWidth:w}))}/>
      <div className="main">
        {/* Server offline banner */}
        {!LOCAL_MODE&&!serverOnline&&(
          <div style={{background:'#FFF3CD',borderBottom:'1px solid #FFC107',padding:'7px 16px',display:'flex',alignItems:'center',gap:8,fontSize:13,color:'#856404',flexShrink:0,zIndex:10}}>
            <span>⚠️</span>
            <span><strong>Server offline</strong> — changes may not save. Check that the Node.js server is running on port 3001.</span>
          </div>
        )}
        {/* Feature 4: Jump-to-date topbar */}
        <div className="topbar" style={{position:'relative'}}>
          <div className="month-title" style={{cursor:'pointer',userSelect:'none'}} onClick={()=>setJumpOpen(j=>!j)} title="Click to jump to date">
            <span>{viewMode==='month'?MONTHS[viewDate.getMonth()]:viewMode==='day'?MONTHS_SHORT[viewDate.getMonth()]:''}</span>
            {viewMode==='month'&&<span className="yr">{viewDate.getFullYear()}</span>}
            {viewMode==='week'&&<span style={{fontSize:18,color:'var(--ink-3)'}}>{navTitle()}</span>}
            {viewMode==='day'&&<span style={{fontSize:18,color:'var(--ink-3)'}}>{fmtDateLong(viewDate)}</span>}
            <span style={{fontSize:14,color:'var(--accent)',marginLeft:6,opacity:0.7}}>▾</span>
          </div>
          {jumpOpen&&(
            <div style={{position:'absolute',top:'100%',left:24,zIndex:60,background:'var(--bg-elev)',border:'1px solid var(--line)',borderRadius:8,boxShadow:'var(--shadow-md)',padding:12}}>
              <input type="month" className="input" style={{width:180}}
                defaultValue={`${viewDate.getFullYear()}-${String(viewDate.getMonth()+1).padStart(2,'0')}`}
                onChange={e=>{ const [y,m]=e.target.value.split('-'); setViewDate(new Date(+y,+m-1,1)); setJumpOpen(false); }}
              />
              <div style={{fontSize:11,color:'var(--ink-3)',marginTop:6,textAlign:'center'}}>or press T for today</div>
            </div>
          )}
          <div className="view-switcher">
            <button className={viewMode==='month'?'active':''} onClick={()=>setViewMode('month')} title="Month (M)">Month</button>
            <button className={viewMode==='week'?'active':''} onClick={()=>setViewMode('week')} title="Week (W)">Week</button>
            <button className={viewMode==='day'?'active':''} onClick={()=>{ setViewMode('day'); setViewDate(new Date()); }} title="Day (D)">Day</button>
          </div>
          <button className="today-btn" onClick={()=>setViewDate(new Date())}>Today</button>
          <div className="nav-btns">
            <button className="iconbtn" onClick={()=>setViewDate(d=>viewMode==='day'?addDays(d,-1):viewMode==='week'?addDays(d,-7):addMonths(d,-1))} aria-label="Previous">{Icon.chev('left')}</button>
            <button className="iconbtn" onClick={()=>setViewDate(d=>viewMode==='day'?addDays(d,1):viewMode==='week'?addDays(d,7):addMonths(d,1))} aria-label="Next">{Icon.chev('right')}</button>
          </div>
          {/* Feature 5: Keyboard shortcuts button */}
          <button className="iconbtn" onClick={()=>setShortcutsOpen(true)} title="Keyboard shortcuts (?)">?</button>
          <button className="iconbtn" onClick={()=>setTweaksOpen(t=>!t)} title="Settings">{Icon.settings}</button>
          <button className="iconbtn ss-topbar-btn" onClick={()=>setSchedOpen(true)} title="SDC Scheduler Sync">
            <span style={{fontSize:16,lineHeight:1}}>📅</span>
            {schedulerEvents.length > 0 && <span className="ss-topbar-badge">{schedulerEvents.length}</span>}
          </button>
          {authUser && (
            <div className="user-badge" ref={userMenuRef}>
              <div style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',padding:'4px 6px',borderRadius:8,transition:'background .15s'}} onClick={()=>setUserMenuOpen(o=>!o)}>
                <div className="user-avatar">{authUser.name?.[0]?.toUpperCase() || '?'}</div>
                <div className="user-info">
                  <div className="user-name">{authUser.name}</div>
                  <div className="user-role">{authUser.role}</div>
                </div>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{color:'var(--ink-3)',transform:userMenuOpen?'rotate(180deg)':'',transition:'transform .2s',flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div className={`user-menu${userMenuOpen?' open':''}`}>
                {authUser.role === 'admin' && (
                  <button onClick={()=>{ setAdminOpen(true); setUserMenuOpen(false); }}>Admin Panel</button>
                )}
                <button onClick={()=>{ onSignOut(); setUserMenuOpen(false); }}>Sign Out</button>
              </div>
            </div>
          )}
        </div>
        {/* Feature 10: Month Summary Bar */}
        {viewMode==='month'&&<MonthSummaryBar viewDate={viewDate} allEvents={allEvents} activeCats={activeCats} setActiveCats={setActiveCats}/>}
        <div className="grid-wrap">
          {viewMode==='month'&&(
            <MonthGrid
              viewDate={viewDate} events={allEvents} activeCats={activeCats} search={search}
              weekStart={prefs.weekStart} showWeekends={prefs.showWeekends} density={prefs.density}
              onOpenEvent={(ev)=>setModal({mode:'edit',event:ev})}
              onNewEventOnDate={(d)=>setModal({mode:'new',date:d})}
              onSeeMore={(d,list)=>setDayModal({date:d,events:list})}
              onDropOnDate={handleDrop}
              timezone={tz}
              onHover={showHover} onHoverEnd={hideHover}
              onContextMenu={(ev,x,y)=>setContextMenu({event:ev,x,y})}
              showWeekNumbers={prefs.showWeekNumbers}
            />
          )}
          {viewMode==='week'&&(
            <WeekView
              viewDate={viewDate} events={allEvents} activeCats={activeCats} search={search}
              weekStart={prefs.weekStart} showWeekends={prefs.showWeekends}
              onOpenEvent={(ev)=>setModal({mode:'edit',event:ev})}
              onNewEventOnDate={(d)=>setModal({mode:'new',date:d})}
              timezone={tz}
              onHover={showHover} onHoverEnd={hideHover}
              onDropWithTime={handleDropWithTime}
            />
          )}
          {viewMode==='day'&&(
            <DayView
              viewDate={viewDate} events={allEvents} activeCats={activeCats} search={search}
              onOpenEvent={(ev)=>setModal({mode:'edit',event:ev})}
              onNewEventOnDate={(d)=>setModal({mode:'new',date:d})}
              timezone={tz}
              onHover={showHover} onHoverEnd={hideHover}
              onDropWithTime={handleDropWithTime}
            />
          )}
        </div>
      </div>

      {/* Feature 18: Mobile Bottom Nav */}
      <div className="mobile-bottom-nav">
        <button className={viewMode==='month'?'active':''} onClick={()=>setViewMode('month')}>📅<span>Month</span></button>
        <button className={viewMode==='week'?'active':''} onClick={()=>setViewMode('week')}>📆<span>Week</span></button>
        <button onClick={()=>setModal({mode:'new',date:new Date()})}>➕<span>New</span></button>
        <button onClick={()=>setEmpModal(true)}>👥<span>People</span></button>
        <button onClick={()=>setTweaksOpen(true)}>⚙️<span>Settings</span></button>
      </div>

      {modal&&<EventModal mode={modal.mode} event={modal.event} date={modal.date} allEvents={allEvents} onClose={()=>setModal(null)} onSave={handleSave} onDelete={handleDelete} timezone={tz} employees={employees}/>}
      {dayModal&&<DayModal date={dayModal.date} events={dayModal.events} onClose={()=>setDayModal(null)} onOpenEvent={(ev)=>setModal({mode:'edit',event:ev})} onNewOnDate={(d)=>setModal({mode:'new',date:d})}/>}
      {empModal&&<EmployeeModal employees={employees} onSave={handleSaveEmployees} onClose={()=>setEmpModal(false)}/>}
      {importExportModal&&<ImportExportModal allEvents={allEvents} userEvents={userEvents} onImport={handleImport} onClearPaylocity={handleClearPaylocity} onClose={()=>setImportExportModal(false)}/>}
      <TweaksPanel open={tweaksOpen} onClose={()=>setTweaksOpen(false)} prefs={prefs} setPrefs={setPrefs}/>
      {adminOpen && <AdminPanel authToken={authToken} onClose={()=>setAdminOpen(false)}/>}
      {schedOpen && <SchedulerPanel onClose={()=>setSchedOpen(false)} onSync={setSchedulerEvents} currentEvents={schedulerEvents}/>}
      {toast&&<Toast msg={toast} onDone={()=>setToast(null)}/>}
      {/* Feature 2: Hover Card */}
      {hoverCard&&<HoverCard event={hoverCard.event} anchorRect={hoverCard.rect}/>}
      {/* Feature 5: Keyboard Shortcuts */}
      {shortcutsOpen&&<KeyboardShortcuts onClose={()=>setShortcutsOpen(false)}/>}
      {/* Feature 16: Context Menu */}
      {contextMenu&&<ContextMenu x={contextMenu.x} y={contextMenu.y} event={contextMenu.event}
        onEdit={()=>{ setModal({mode:'edit',event:contextMenu.event}); setContextMenu(null); }}
        onDelete={()=>{ setDeleteConfirm({id:contextMenu.event.id,title:contextMenu.event.title}); setContextMenu(null); }}
        onPin={()=>{ handleTogglePin(contextMenu.event); setContextMenu(null); }}
        onClose={()=>setContextMenu(null)}/>}
      {deleteConfirm&&<DeleteConfirmModal title={deleteConfirm.title} onConfirm={()=>{ handleDelete(deleteConfirm.id); setDeleteConfirm(null); }} onCancel={()=>setDeleteConfirm(null)}/>}
    </div>
  );
}

// ─── AppShell — handles auth, shows login or calendar ─────────
function App() {
  // All hooks declared unconditionally — rules of hooks compliance
  const [resolvedUser,  setResolvedUser]  = useState(LOCAL_USER);
  const [authToken,     setAuthToken]     = useState(() => LOCAL_MODE ? null : (getStoredAuth()?.token || null));
  const [authUser,      setAuthUser]      = useState(null);
  const [authLoading,   setAuthLoading]   = useState(!LOCAL_MODE && !!(getStoredAuth()?.token));
  const [allowedCats,   setAllowedCats]   = useState(null);

  // Resolve real SSO user from shell when in LOCAL_MODE
  useEffect(() => {
    if (!LOCAL_MODE) return;
    if (window.electronAPI?.authGetStatus) {
      window.electronAPI.authGetStatus().then(status => {
        if (status?.isAuthenticated && status.user) {
          setResolvedUser(u => ({ ...u, name: status.user.name || u.name, email: status.user.email || u.email }));
        }
      }).catch(() => {});
    }
    // The shell's IPC channel only ever carries name/email — never a role.
    // The REAL role/allowedCategories come from this app's own backend,
    // which now resolves them from the sdc_session cookie the shell set
    // (see server/middleware/requireAuth.js, fixed 2026-08-20 to stop
    // handing every shell user the same hardcoded admin identity). Same-
    // origin request, so the cookie rides along with no Authorization
    // header needed. On any failure (offline, cookie not set yet, server
    // unreachable) this silently keeps the LOCAL_USER admin defaults
    // already in state — the same behavior as before this fix, not a new
    // failure mode.
    fetch(`${API_URL}/auth/me`, { credentials: 'include', signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error('unauth'); return r.json(); })
      .then(data => {
        setResolvedUser(u => ({ ...u, role: data.role, allowedCategories: data.allowedCategories }));
        setAllowedCats(new Set(data.allowedCategories));
      })
      .catch(() => {});
  }, []);

  // Verify JWT token when not in LOCAL_MODE
  useEffect(() => {
    if (LOCAL_MODE || !authToken) { setAuthLoading(false); return; }
    fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${authToken}` }, signal: AbortSignal.timeout(8000) })
      .then(r => { if (!r.ok) throw new Error('unauth'); return r.json(); })
      .then(data => { setAuthUser(data); setAllowedCats(new Set(data.allowedCategories)); setAuthLoading(false); })
      .catch(() => { localStorage.removeItem('sdc_auth_token'); setAuthToken(null); setAuthLoading(false); });
  }, [authToken]);

  const handleAuthReady = (token) => { localStorage.setItem('sdc_auth_token', token); setAuthToken(token); };
  const handleSignOut   = () => { localStorage.removeItem('sdc_auth_token'); setAuthToken(null); setAuthUser(null); setAllowedCats(null); };

  if (LOCAL_MODE) {
    // allowedCats starts null and is set once /auth/me resolves above — fall
    // back to the LOCAL_USER admin defaults only until then, not forever.
    return <CalendarApp authToken={null} authUser={resolvedUser} allowedCats={allowedCats || new Set(LOCAL_USER.allowedCategories)} onSignOut={()=>{ window.location.reload(); }} />;
  }
  if (!authToken)  return <LoginScreen onAuthReady={handleAuthReady} />;
  if (authLoading) return <div className="login-screen"><div className="login-spinner"></div></div>;
  return <CalendarApp authToken={authToken} authUser={authUser} allowedCats={allowedCats} onSignOut={handleSignOut} />;
}

// Wrap with ErrorBoundary for export
function AppWithBoundary() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

export default AppWithBoundary;
