import React, { useState } from 'react';
import { CATMAP, DOW_SHORT, startOfMonth, endOfMonth, isSameDay, ymd, daysBetween, getWeekNum, fmtTime, rotateDow } from '../utils.js';
import { ssPctColor } from './TimeGrid.jsx';

function MonthGrid({ viewDate, events, activeCats, search, weekStart, showWeekends, density, onOpenEvent, onNewEventOnDate, onSeeMore, onDropOnDate, timezone, onHover, onHoverEnd, onContextMenu, showWeekNumbers }) {
  const today=new Date();
  const som=startOfMonth(viewDate), eom=endOfMonth(viewDate);
  const lead=(som.getDay()-weekStart+7)%7;
  const cells=[];
  for(let i=0;i<lead;i++){ const d=new Date(som); d.setDate(d.getDate()-(lead-i)); cells.push({d,out:true}); }
  for(let i=1;i<=eom.getDate();i++) cells.push({d:new Date(viewDate.getFullYear(),viewDate.getMonth(),i),out:false});
  while(cells.length%7!==0){ const last=cells[cells.length-1].d; const d=new Date(last); d.setDate(d.getDate()+1); cells.push({d,out:true}); }

  const filteredEvents=events.filter(e=>activeCats.has(e.category)).filter(e=>!search||e.title.toLowerCase().includes(search.toLowerCase()));
  const byDay=new Map();
  filteredEvents.forEach(ev=>{
    if(ev.endDate && !isSameDay(new Date(ev.date), new Date(ev.endDate))) return;
    const k=ymd(ev.date);
    if(!byDay.has(k)) byDay.set(k,[]);
    byDay.get(k).push(ev);
  });
  byDay.forEach(list=>list.sort((a,b)=>{ const pinDiff=(b.pinned?1:0)-(a.pinned?1:0); if(pinDiff!==0)return pinDiff; if(a.allDay!==b.allDay) return a.allDay?-1:1; return (a.time||'').localeCompare(b.time||''); }));

  const multiDayEvents=filteredEvents.filter(ev=>ev.endDate && !isSameDay(new Date(ev.date), new Date(ev.endDate)));

  const cols=showWeekends?7:5;
  const filteredCells=showWeekends ? cells : cells.filter(c=>c.d.getDay()!==0&&c.d.getDay()!==6);
  const weeks=[];
  for(let i=0;i<filteredCells.length;i+=cols) weeks.push(filteredCells.slice(i,i+cols));

  const maxChips=density==='compact'?2:density==='comfy'?4:3;
  const BANNER_H=22, CELL_NUM_H=28;

  const dowLabels=rotateDow(weekStart, showWeekends?DOW_SHORT:DOW_SHORT.filter((_,i)=>{ const dow=(weekStart+i)%7; return dow!==0&&dow!==6; }));

  const [dragId, setDragId]=useState(null);
  const [dragOver, setDragOver]=useState(null);

  return (
    <div className={showWeekends?'':'weekend-hidden'}>
      <div className="dow-row" style={{gridTemplateColumns:showWeekNumbers?`32px repeat(${cols},1fr)`:`repeat(${cols},1fr)`}}>
        {showWeekNumbers&&<div className="dow wk-num-col">Wk</div>}
        {Array.from({length:cols},(_,i)=>{
          const realDow=(weekStart+i)%7;
          const isWknd=realDow===0||realDow===6;
          return <div key={i} className={`dow${isWknd?' weekend':''}`}>{DOW_SHORT[(weekStart+i)%7]}</div>;
        })}
      </div>
      <div className="cal-grid">
        {weeks.map((weekCells,wi)=>{
          const wStart=weekCells[0].d;
          const wEnd=weekCells[weekCells.length-1].d;

          const mdInWeek=multiDayEvents.filter(ev=>{
            const es=new Date(ev.date), ee=new Date(ev.endDate);
            return es<=wEnd && ee>=wStart;
          });
          const laneAssign=[];
          mdInWeek.forEach(ev=>{
            const es=new Date(ev.date), ee=new Date(ev.endDate);
            const cs=Math.max(0, daysBetween(wStart,es));
            const ce=Math.min(cols-1, daysBetween(wStart,ee));
            let lane=0;
            while(laneAssign.some(a=>a.lane===lane && a.cs<=ce && a.ce>=cs)) lane++;
            laneAssign.push({ev,cs,ce,lane});
          });
          const numLanes=laneAssign.length>0?Math.max(...laneAssign.map(a=>a.lane))+1:0;
          const chipOffset=numLanes*BANNER_H;

          return (
            <div key={wi} className="week-row" style={{'--cols':cols,'--banner-offset':`${chipOffset}px`,gridTemplateColumns:showWeekNumbers?`32px repeat(${cols},1fr)`:`repeat(${cols},1fr)`}}>
              {showWeekNumbers&&<div className="wk-num-cell">{getWeekNum(weekCells[0].d)}</div>}
              {weekCells.map((c,di)=>{
                const list=byDay.get(ymd(c.d))||[];
                const isToday=isSameDay(c.d,today);
                const isWknd=c.d.getDay()===0||c.d.getDay()===6;
                const cls=['cell'];
                if(c.out) cls.push('out');
                if(isToday) cls.push('today');
                if(isWknd) cls.push('weekend');
                if(dragOver&&isSameDay(c.d,dragOver)) cls.push('drag-over');
                const shown=list.slice(0,maxChips);
                const extra=list.length-shown.length;
                return (
                  <div
                    key={di}
                    className={cls.join(' ')}
                    onClick={(e)=>{ if(e.target.closest('.chip,.event-banner,.chip-more')) return; onNewEventOnDate(c.d); }}
                    onDragOver={(e)=>{ e.preventDefault(); setDragOver(c.d); }}
                    onDragLeave={()=>setDragOver(null)}
                    onDrop={(e)=>{ e.preventDefault(); setDragOver(null); if(dragId) onDropOnDate(dragId,c.d); setDragId(null); }}
                  >
                    <div className={`cell-num${isToday?' today-num':''}`}>{c.d.getDate()}</div>
                    {isToday&&<div className="today-label">TODAY</div>}
                    <div className="chips" style={{paddingTop:`${chipOffset}px`}}>
                      {shown.map(ev=>{
                        const cat=CATMAP[ev.category];
                        const schedColor=ev.source==='scheduler'&&ev.progress>0?ssPctColor(ev.progress+'%'):null;
                        const fg=schedColor||(ev.color||cat.sw), bg=schedColor?(schedColor+'22'):(ev.color?(ev.color+'22'):cat.swBg);
                        const isMatch=search&&ev.title.toLowerCase().includes(search.toLowerCase());
                        const chipCls=['chip'];
                        if(ev.pinned) chipCls.push('pinned');
                        if(isMatch) chipCls.push('chip-match');
                        else if(search) chipCls.push('chip-dim');
                        return (
                          <div
                            key={ev.id}
                            className={chipCls.join(' ')}
                            style={{'--chip-fg':fg,'--chip-bg':bg}}
                            draggable={!ev.seeded && !ev.readOnly}
                            onDragStart={(e)=>{ e.stopPropagation(); setDragId(ev.id); e.dataTransfer.effectAllowed='move'; }}
                            onClick={(e)=>{ e.stopPropagation(); onOpenEvent(ev); }}
                            onMouseEnter={(e)=>onHover&&onHover(ev,e)}
                            onMouseLeave={()=>onHoverEnd&&onHoverEnd()}
                            onContextMenu={(e)=>{ e.preventDefault(); e.stopPropagation(); onContextMenu&&onContextMenu(ev,e.clientX,e.clientY); }}
                            title={ev.title}
                          >
                            {!ev.allDay&&ev.time&&<span className="t">{fmtTime(ev.time,timezone).replace(' ','').toLowerCase()}</span>}
                            {ev.source==='scheduler'&&<span className="ss-badge" style={{background:'#1574C4'}} title={ev.project||'Scheduler'}>SCH</span>}
                            <span className="ttl">{ev.title}</span>
                            {ev.source==='scheduler'&&ev.progress>0&&<span className="ss-pct">{ev.progress}%</span>}
                            {ev.repeat&&ev.repeat!=='none'&&<span className="chip-recur">↻</span>}
                            {ev.notify&&<span title={`Reminder: ${ev.notify} min before`} style={{fontSize:9,opacity:0.7}}>🔔</span>}
                            {ev.pinned&&<span style={{fontSize:9}}>📌</span>}
                          </div>
                        );
                      })}
                      {extra>0&&<div className="chip-more" onClick={(e)=>{ e.stopPropagation(); onSeeMore(c.d,[...list]); }}>+{extra} more</div>}
                    </div>
                  </div>
                );
              })}

              {/* Multi-day banners */}
              {laneAssign.map(({ev,cs,ce,lane},li)=>{
                const cat=CATMAP[ev.category];
                const fg=ev.color||cat.sw, bg=ev.color?(ev.color+'22'):cat.swBg;
                const isStart=new Date(ev.date)>=wStart;
                const isEnd=new Date(ev.endDate)<=wEnd;
                return (
                  <div
                    key={li}
                    className={`event-banner${isStart?' banner-start':''}${isEnd?' banner-end':''}`}
                    style={{
                      left:`calc(${cs}/${cols}*100%)`,
                      width:`calc(${ce-cs+1}/${cols}*100%)`,
                      top:`${CELL_NUM_H+lane*BANNER_H}px`,
                      '--chip-fg':fg,'--chip-bg':bg,
                    }}
                    onClick={(e)=>{ e.stopPropagation(); onOpenEvent(ev); }}
                    title={ev.title}
                  >
                    {isStart&&<span className="banner-title">{ev.title}</span>}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MonthGrid;
