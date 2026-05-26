import React, { useState, useEffect } from 'react';
import { MONTHS, DOW_MINI, startOfMonth, endOfMonth, addMonths, addDays, isSameDay, ymd, rotateDow } from '../utils.js';
import { Icon } from '../constants.jsx';

function MiniCal({ viewDate, onJump, eventsByDay, selectedDate, weekStart }) {
  const [anchor, setAnchor] = useState(()=>new Date(viewDate.getFullYear(), viewDate.getMonth(), 1));
  useEffect(()=>{ setAnchor(new Date(viewDate.getFullYear(), viewDate.getMonth(), 1)); },[viewDate.getFullYear(), viewDate.getMonth()]);

  const today=new Date(), som=startOfMonth(anchor), eom=endOfMonth(anchor);
  const lead=(som.getDay()-weekStart+7)%7;
  const cells=[];
  for(let i=0;i<lead;i++){ const d=new Date(som); d.setDate(d.getDate()-(lead-i)); cells.push({d,out:true}); }
  for(let i=1;i<=eom.getDate();i++) cells.push({d:new Date(anchor.getFullYear(),anchor.getMonth(),i),out:false});
  while(cells.length%7!==0){ const last=cells[cells.length-1].d; const d=new Date(last); d.setDate(d.getDate()+1); cells.push({d,out:true}); }
  const dowLabels=rotateDow(weekStart,DOW_MINI);

  return (
    <div className="mini">
      <div className="mini-head">
        <div className="mini-title">{MONTHS[anchor.getMonth()]} {anchor.getFullYear()}</div>
        <div className="mini-nav">
          <button onClick={()=>setAnchor(addMonths(anchor,-1))} aria-label="Prev">{Icon.chev('left')}</button>
          <button onClick={()=>setAnchor(addMonths(anchor,1))}  aria-label="Next">{Icon.chev('right')}</button>
        </div>
      </div>
      <div className="mini-grid">
        {dowLabels.map((l,i)=><div key={i} className="mini-dow">{l}</div>)}
        {cells.map((c,i)=>{
          const key=ymd(c.d), has=eventsByDay.get(key)?.length>0;
          const cls=['mini-day'];
          if(c.out) cls.push('out');
          if(isSameDay(c.d,today)) cls.push('today');
          if(selectedDate&&isSameDay(c.d,selectedDate)) cls.push('selected');
          if(has) cls.push('has-event');
          return <div key={i} className={cls.join(' ')} onClick={()=>onJump(c.d)}>{c.d.getDate()}</div>;
        })}
      </div>
    </div>
  );
}

export default MiniCal;
