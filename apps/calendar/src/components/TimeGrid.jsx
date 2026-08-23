import React, { useState, useEffect, useRef, useMemo } from 'react';
import { CATMAP, HOUR_H, isSameDay, ymd, timeToMin, layoutTimeEvents, fmtTime } from '../utils.js';

// Helper: progress colour for SS events
function ssPctColor(pct) {
  const p = parseInt(pct) || 0;
  if (p >= 100) return '#1B8A3F';
  if (p >= 75)  return '#2E9E55';
  if (p >= 50)  return '#E07B00';
  if (p >= 25)  return '#C0510A';
  return '#B71C1C';
}

function TimeGrid({ days, events, activeCats, search, showWeekends, onOpenEvent, onNewEventOnDate, timezone, viewDate, onHover, onHoverEnd, onDropWithTime }) {
  const today=new Date();
  const nowRef=useRef(null);
  const [nowTop, setNowTop]=useState(()=>{ const n=new Date(); return (n.getHours()*60+n.getMinutes())/60*HOUR_H; });
  const draggedEventId=useRef(null);
  const [expandedGroups, setExpandedGroups]=useState(new Set());
  const MAX_CAL=2;
  const MAX_GROUPS=3;

  useEffect(()=>{
    const tick=()=>{ const n=new Date(); setNowTop((n.getHours()*60+n.getMinutes())/60*HOUR_H); };
    const id=setInterval(tick,60000);
    return ()=>clearInterval(id);
  },[]);

  useEffect(()=>{ if(nowRef.current) nowRef.current.scrollIntoView({block:'center',behavior:'smooth'}); },[]);

  const filtered=events.filter(e=>activeCats.has(e.category)).filter(e=>!search||e.title.toLowerCase().includes(search.toLowerCase()));

  const byDay=useMemo(()=>{
    const m=new Map();
    days.forEach(d=>{ m.set(ymd(d),{allDay:[],timed:[]}); });
    filtered.forEach(ev=>{
      const k=ymd(ev.date);
      if(!m.has(k)) return;
      if(ev.allDay||!ev.time) m.get(k).allDay.push(ev);
      else m.get(k).timed.push(ev);
    });
    return m;
  },[filtered, days]);

  const hasTimedEvents=useMemo(()=>[...byDay.values()].some(s=>s.timed.length>0),[byDay]);
  const hasAnySSEvents=useMemo(()=>[...byDay.values()].some(s=>s.allDay.some(e=>e.source==='scheduler')),[byDay]);
  const hours=Array.from({length:24},(_,i)=>i);

  const toggleGroup=(key)=>setExpandedGroups(prev=>{ const n=new Set(prev); n.has(key)?n.delete(key):n.add(key); return n; });

  return (
    <div className="time-grid-wrap">
      {/* Zone 1: Calendar events */}
      <div className="tg-allday-row tg-zone-row">
        <div className="tg-time-col tg-zone-label-col">
          <span>Events</span>
        </div>
        {days.map((d,di)=>{
          const slot=byDay.get(ymd(d))||{allDay:[],timed:[]};
          const isToday=isSameDay(d,today);
          const calEvs=slot.allDay.filter(e=>e.source!=='scheduler');
          const visible=calEvs.slice(0,MAX_CAL);
          const hidden=calEvs.length-MAX_CAL;
          return (
            <div key={di} className={`tg-allday-cell tg-events-cell ${isToday?'today':''}`}>
              {visible.map(ev=>{
                const cat=CATMAP[ev.category];
                const fg=ev.color||cat.sw, bg=ev.color?(ev.color+'22'):cat.swBg;
                return (
                  <div key={ev.id} className="chip" style={{'--chip-fg':fg,'--chip-bg':bg}} onClick={()=>onOpenEvent(ev)} onMouseEnter={(e)=>onHover&&onHover(ev,e)} onMouseLeave={()=>onHoverEnd&&onHoverEnd()} title={ev.title}>
                    <span className="ttl">{ev.title}</span>
                  </div>
                );
              })}
              {hidden>0&&<div className="tg-allday-more">+{hidden} more</div>}
            </div>
          );
        })}
      </div>

      {/* Zone 2: SDC Scheduler tasks grouped by project */}
      {hasAnySSEvents&&(
        <div className="tg-allday-row tg-zone-row tg-tasks-row">
          <div className="tg-time-col tg-zone-label-col tg-tasks-label-col">
            <span>Tasks</span>
          </div>
          {days.map((d,di)=>{
            const slot=byDay.get(ymd(d))||{allDay:[],timed:[]};
            const isToday=isSameDay(d,today);
            const schedTasks=slot.allDay.filter(e=>e.source==='scheduler');
            const groupMap=new Map();
            schedTasks.forEach(ev=>{ const proj=ev.project||'Other'; if(!groupMap.has(proj))groupMap.set(proj,[]); groupMap.get(proj).push(ev); });
            const groups=[...groupMap.entries()];
            const visibleGroups=groups.slice(0,MAX_GROUPS);
            const hiddenGroups=groups.length-MAX_GROUPS;
            return (
              <div key={di} className={`tg-allday-cell tg-tasks-cell ${isToday?'today':''}`}>
                {visibleGroups.map(([proj,evs])=>{
                  const gk=`${ymd(d)}|${proj}`;
                  const expanded=expandedGroups.has(gk);
                  const avgPct=Math.round(evs.reduce((s,e)=>s+(parseInt(e.progress)||0),0)/evs.length);
                  const pColor=avgPct>0?ssPctColor(avgPct+'%'):null;
                  return (
                    <div key={proj} className="tg-task-group">
                      <div className="tg-task-group-hd" onClick={()=>toggleGroup(gk)} title={`${proj} · ${evs.length} task${evs.length!==1?'s':''}`}>
                        <span className="ss-job-num">{proj}</span>
                        <span className="tg-task-count">{evs.length} task{evs.length!==1?'s':''}</span>
                        {avgPct>0&&<span className="ss-pct tg-group-pct" style={pColor?{color:pColor}:{}}>{avgPct}%</span>}
                        <span className="tg-group-chevron">{expanded?'▲':'▼'}</span>
                      </div>
                      {expanded&&evs.map(ev=>{
                        const pColor2=ev.progress>0?ssPctColor(ev.progress+'%'):null;
                        return (
                          <div key={ev.id} className="chip tg-task-chip" style={{'--chip-fg':ev.color||'#1574c4','--chip-bg':(ev.color||'#1574c4')+'22'}} onClick={()=>onOpenEvent(ev)} title={ev.title}>
                            <span className="ttl">{ev.title}</span>
                            {ev.progress>0&&<span className="ss-pct" style={pColor2?{color:pColor2}:{}}>{ev.progress}%</span>}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {hiddenGroups>0&&<div className="tg-allday-more">+{hiddenGroups} more projects</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Time grid */}
      <div className="tg-body">
        <div className="tg-inner" style={{height:`${HOUR_H*24}px`}}>
          <div className="tg-time-col">
            {hours.map(h=>(
              <div key={h} className="tg-hour-label" style={{top:`${h*HOUR_H}px`}}>
                {h===0?'':(h<12?`${h} AM`:h===12?'12 PM':`${h-12} PM`)}
              </div>
            ))}
          </div>

          {days.map((d,di)=>{
            const slot=byDay.get(ymd(d))||{allDay:[],timed:[]};
            const isToday=isSameDay(d,today);
            const laid=layoutTimeEvents(slot.timed);
            return (
              <div
                key={di}
                className={`tg-day-col ${isToday?'today':''}`}
                onClick={(e)=>{ if(!e.target.closest('.tg-event')) { const h=Math.floor(e.nativeEvent.offsetY/HOUR_H); const nd=new Date(d); nd.setHours(h,0,0,0); onNewEventOnDate(nd); } }}
                onDragOver={(e)=>e.preventDefault()}
                onDrop={(e)=>{
                  e.preventDefault();
                  if(!draggedEventId.current||!onDropWithTime) return;
                  const colEl=e.currentTarget;
                  const rect=colEl.getBoundingClientRect();
                  const y=e.clientY - rect.top;
                  const totalMin=Math.round(y/HOUR_H*60/15)*15;
                  const hh=Math.floor(totalMin/60), mm=totalMin%60;
                  const newTime=`${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
                  onDropWithTime(draggedEventId.current, d, newTime);
                  draggedEventId.current=null;
                }}
              >
                {hours.map(h=><div key={h} className="tg-hour-line" style={{top:`${h*HOUR_H}px`}}/>)}

                {laid.map(ev=>{
                  const cat=CATMAP[ev.category];
                  const fg=ev.color||cat.sw, bg=ev.color?(ev.color+'22'):cat.swBg;
                  const top=timeToMin(ev.time)/60*HOUR_H;
                  const dur=ev.endTime?timeToMin(ev.endTime)-timeToMin(ev.time):60;
                  const h=Math.max(dur/60*HOUR_H,22);
                  const w=`${100/ev._totalCols}%`;
                  const l=`${ev._col/ev._totalCols*100}%`;
                  const isMatch=search&&ev.title.toLowerCase().includes(search.toLowerCase());
                  const tgCls=['tg-event'];
                  if(isMatch) tgCls.push('chip-match');
                  else if(search) tgCls.push('chip-dim');
                  return (
                    <div key={ev.id} className={tgCls.join(' ')} style={{top:`${top}px`,height:`${h}px`,left:l,width:w,'--chip-fg':fg,'--chip-bg':bg}} draggable={!ev.seeded} onDragStart={()=>{ draggedEventId.current=ev.id; }} onClick={(e)=>{ e.stopPropagation(); onOpenEvent(ev); }} onMouseEnter={(e)=>onHover&&onHover(ev,e)} onMouseLeave={()=>onHoverEnd&&onHoverEnd()} title={ev.title}>
                      <div className="tg-event-title">{ev.title}{ev.notify&&<span title={`Reminder: ${ev.notify} min before`} style={{fontSize:9,opacity:0.7,marginLeft:3}}>🔔</span>}</div>
                      {h>30&&<div className="tg-event-time">{fmtTime(ev.time,timezone)}{ev.endTime?` – ${fmtTime(ev.endTime,timezone)}`:''}</div>}
                    </div>
                  );
                })}

                {isToday&&<div ref={nowRef} className="tg-now-line" style={{top:`${nowTop}px`}}><div className="tg-now-dot"/></div>}
              </div>
            );
          })}

          {!hasTimedEvents&&(
            <div style={{position:'absolute',top:`${9*HOUR_H}px`,left:'56px',right:0,display:'flex',alignItems:'center',justifyContent:'center',pointerEvents:'none',zIndex:0}}>
              <span style={{fontSize:12,color:'var(--ink-3)',opacity:0.45,background:'var(--bg-elev)',padding:'4px 12px',borderRadius:20,border:'1px dashed var(--line)'}}>
                No timed events — click any slot to schedule one
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { ssPctColor };
export default TimeGrid;
