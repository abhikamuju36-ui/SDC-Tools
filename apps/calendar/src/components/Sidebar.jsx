import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CATEGORIES, CATMAP, MONTHS_SHORT, startOfMonth, endOfMonth, ymd, fmtTime, fmtDateShort } from '../utils.js';
import { Icon, APP_VERSION } from '../constants.jsx';
import MiniCal from './MiniCal.jsx';
import BirthdaySpotlight from './BirthdaySpotlight.jsx';

// ─── Resizer ──────────────────────────────────────────────────
export function Resizer({ width, onChange }) {
  const [dragging, setDragging]=useState(false);
  const ref=useRef({x:0,w:0});
  useEffect(()=>{
    if(!dragging) return;
    const onMove=(e)=>{ const dx=e.clientX-ref.current.x; onChange(Math.max(220,Math.min(520,ref.current.w+dx))); };
    const onUp=()=>setDragging(false);
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onUp);
    document.body.style.cursor='col-resize';
    document.body.style.userSelect='none';
    return ()=>{ window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); document.body.style.cursor=''; document.body.style.userSelect=''; };
  },[dragging,onChange]);
  return (
    <div className={`resizer ${dragging?'dragging':''}`} onMouseDown={e=>{ ref.current={x:e.clientX,w:width}; setDragging(true); e.preventDefault(); }} onDoubleClick={()=>onChange(300)} role="separator" title="Drag · double-click to reset">
      <div className="resizer-grip"/>
    </div>
  );
}

const SHAPES = { holiday:'★', payday:'●', birthday:'♥', meeting:'■', company:'▲', deadline:'◆', personal:'○', vacation:'🌴' };

// ─── Sidebar ──────────────────────────────────────────────────
function Sidebar({ viewDate, setViewDate, allEvents, activeCats, setActiveCats, search, setSearch, onNewEvent, onOpenEvent, weekStart, onOpenDirectory, onOpenImportExport, onUndo, onRedo, canUndo, canRedo, myEventsOnly, setMyEventsOnly, authUser, onSignOut, appVersion, prefs, setPrefs }) {
  const [collapsed, setCollapsed]=useState({mini:false,cats:false,upcoming:false});

  const eventsByDay=useMemo(()=>{
    const m=new Map();
    allEvents.forEach(e=>{ if(!activeCats.has(e.category)) return; const k=ymd(e.date); if(!m.has(k)) m.set(k,[]); m.get(k).push(e); });
    return m;
  },[allEvents,activeCats]);

  // Feature 7: View counts for current month
  const viewCounts=useMemo(()=>{
    const c={}; CATEGORIES.forEach(cat=>{ c[cat.id]=0; });
    const som=startOfMonth(viewDate), eom=endOfMonth(viewDate);
    allEvents.filter(e=>e.date>=som&&e.date<=eom).forEach(e=>{ c[e.category]=(c[e.category]||0)+1; });
    return c;
  },[allEvents,viewDate]);

  // Feature 23: Next 7 days upcoming
  const upcoming=useMemo(()=>{
    const now=new Date(); now.setHours(0,0,0,0);
    const week=new Date(now); week.setDate(week.getDate()+7);
    return allEvents.filter(e=>activeCats.has(e.category)).filter(e=>e.date>=now&&e.date<=week).filter(e=>!search||e.title.toLowerCase().includes(search.toLowerCase())).sort((a,b)=>a.date-b.date).slice(0,8);
  },[allEvents,activeCats,search,viewDate]);

  // Feature 8: Next payday
  const nextPayday=useMemo(()=>{
    const now=new Date(); now.setHours(0,0,0,0);
    return allEvents.filter(e=>e.category==='payday'&&e.date>=now).sort((a,b)=>a.date-b.date)[0];
  },[allEvents]);

  // Feature 9: Birthdays this week
  const upcomingBirthdays=useMemo(()=>{
    const now=new Date(); now.setHours(0,0,0,0);
    const week=new Date(now); week.setDate(week.getDate()+7);
    return allEvents.filter(e=>e.category==='birthday'&&e.date>=now&&e.date<=week).sort((a,b)=>a.date-b.date);
  },[allEvents]);

  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="assets/sdc-logo.png" alt="SDC" className="brand-logo"/>
        <div>
          <div className="brand-title">Centralized Calendar</div>
          <div className="brand-sub">SDC Automation · {new Date().getFullYear()} <span className="brand-version">v{appVersion||APP_VERSION}</span></div>
        </div>
      </div>
      <div className="sidebar-inner">
        <button className="btn-new" onClick={onNewEvent}>{Icon.plus} New event</button>
        <div className="search">
          {Icon.search}
          <input type="search" placeholder="Search events…" value={search} onChange={e=>setSearch(e.target.value)}/>
        </div>
        {/* Feature 11: My Events Only toggle */}
        <button
          onClick={()=>setMyEventsOnly(m=>!m)}
          style={{width:'100%',padding:'7px 12px',border:'1px solid var(--side-line-strong)',borderRadius:'var(--radius)',background:myEventsOnly?'var(--accent)':'transparent',color:myEventsOnly?'#fff':'var(--side-ink-2)',fontSize:12,fontWeight:500,textAlign:'left',display:'flex',alignItems:'center',gap:8,transition:'all .15s'}}
        >
          <span>{myEventsOnly ? '✓' : '○'}</span> My Events Only
        </button>

        {/* Feature 6: Collapsible Mini Cal */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}} onClick={()=>setCollapsed(c=>({...c,mini:!c.mini}))}>
            <div className="section-label" style={{margin:0}}>Mini Calendar</div>
            <span style={{color:'var(--side-ink-3)',fontSize:12,display:'inline-block',transform:collapsed.mini?'rotate(-90deg)':'rotate(0deg)',transition:'transform .2s'}}>▾</span>
          </div>
          {!collapsed.mini&&<MiniCal viewDate={viewDate} onJump={setViewDate} eventsByDay={eventsByDay} selectedDate={viewDate} weekStart={weekStart}/>}
        </div>

        {/* Feature 6+7: Collapsible Categories with view counts */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}} onClick={()=>setCollapsed(c=>({...c,cats:!c.cats}))}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <div className="section-label" style={{margin:0}}>Categories</div>
              <span style={{fontSize:9,color:'var(--side-ink-3)',fontWeight:400,textTransform:'none',letterSpacing:'normal'}}>(this month)</span>
            </div>
            <span style={{color:'var(--side-ink-3)',fontSize:12,display:'inline-block',transform:collapsed.cats?'rotate(-90deg)':'rotate(0deg)',transition:'transform .2s'}}>▾</span>
          </div>
          {!collapsed.cats&&(
            <div className="filters" style={{marginTop:8}}>
              {CATEGORIES.map(cat=>{
                const active=activeCats.has(cat.id);
                return (
                  <label key={cat.id} className="filter">
                    <input type="checkbox" checked={active} onChange={e=>{ const next=new Set(activeCats); if(e.target.checked) next.add(cat.id); else next.delete(cat.id); setActiveCats(next); }}/>
                    <span className="swatch" style={{'--sw':cat.sw}}>{SHAPES[cat.id]||'●'}</span>
                    <span>{cat.label}</span>
                    <span className="count">{viewCounts[cat.id]||0}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Feature 8: Payday Countdown */}
        {nextPayday&&(
          <div style={{background:'var(--side-bg-elev)',border:'1px solid var(--side-line-strong)',borderRadius:8,padding:'10px 12px',display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:22}}>💰</div>
            <div>
              <div style={{fontSize:11,color:'var(--side-ink-3)',textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:600}}>Next Payday</div>
              <div style={{fontSize:14,fontWeight:700,color:'var(--side-ink)'}}>{fmtDateShort(nextPayday.date)}</div>
              <div style={{fontSize:12,color:'var(--cat-payday)'}}>
                {Math.ceil((nextPayday.date-new Date())/86400000)===0?'🎉 Today!':
                 Math.ceil((nextPayday.date-new Date())/86400000)===1?'Tomorrow!':
                 `in ${Math.ceil((nextPayday.date-new Date())/86400000)} days`}
              </div>
            </div>
          </div>
        )}

        {/* Feature 9: Birthday Spotlight */}
        {upcomingBirthdays.length>0&&(
          <BirthdaySpotlight birthdays={upcomingBirthdays} />
        )}

        {/* Feature 6+23: Collapsible Upcoming / Next 7 Days */}
        <div>
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer',userSelect:'none'}} onClick={()=>setCollapsed(c=>({...c,upcoming:!c.upcoming}))}>
            <div className="section-label" style={{margin:0}}>Next 7 Days</div>
            <span style={{color:'var(--side-ink-3)',fontSize:12,display:'inline-block',transform:collapsed.upcoming?'rotate(-90deg)':'rotate(0deg)',transition:'transform .2s'}}>▾</span>
          </div>
          {!collapsed.upcoming&&(
            <div className="upcoming" style={{marginTop:8}}>
              {upcoming.length===0&&<div style={{fontSize:12,color:'var(--side-ink-3)'}}>Nothing in the next 7 days.</div>}
              {upcoming.map(e=>{
                const cat=CATMAP[e.category];
                return (
                  <div key={e.id} className="up-item" onClick={()=>onOpenEvent(e)}>
                    <div className="up-date"><div className="m">{MONTHS_SHORT[e.date.getMonth()]}</div><div className="d">{e.date.getDate()}</div></div>
                    <div><div className="up-title">{e.title}</div><div className="up-meta"><span className="up-dot" style={{'--sw':e.color||cat.sw}}></span><span>{!e.allDay&&e.time?fmtTime(e.time):cat.label}</span></div></div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="sidebar-tools">
          <button className="tool-btn" onClick={onOpenDirectory} title="Employee Directory">{Icon.users} Directory</button>
          <button className="tool-btn" onClick={onOpenImportExport} title="Import / Export">{Icon.download} Import/Export</button>
          <button className="tool-btn" onClick={() => setPrefs(p => ({ ...p, theme: (prefs?.theme === 'dark') ? 'light' : 'dark' }))} title={prefs?.theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
            {prefs?.theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
          <button className={`tool-btn ${!canUndo?'disabled':''}`} onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)">{Icon.undo}</button>
          <button className={`tool-btn ${!canRedo?'disabled':''}`} onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Y)">{Icon.redo}</button>
        </div>

        {/* Feature 24: User Profile */}
        {authUser&&(
          <div style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderTop:'1px solid var(--side-line)',marginTop:'auto',flexShrink:0}}>
            <div style={{width:32,height:32,borderRadius:'50%',background:'var(--accent)',color:'#fff',display:'grid',placeItems:'center',fontSize:12,fontWeight:700,flexShrink:0}}>
              {(authUser.name||authUser.email||'U').charAt(0).toUpperCase()}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:'var(--side-ink)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{authUser.name||authUser.email}</div>
              <div style={{fontSize:10,color:'var(--side-ink-3)',textTransform:'uppercase',letterSpacing:'0.1em'}}>{authUser.role||'User'}</div>
            </div>
            <button style={{border:0,background:'transparent',color:'var(--side-ink-3)',cursor:'pointer',fontSize:12}} onClick={onSignOut} title="Sign out">↪</button>
          </div>
        )}
      </div>
    </aside>
  );
}

export default Sidebar;
