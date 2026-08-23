import React from 'react';
import { DOW_SHORT, isSameDay, addDays, startOfWeek } from '../utils.js';
import TimeGrid from './TimeGrid.jsx';

function WeekView({ viewDate, events, activeCats, search, weekStart, showWeekends, onOpenEvent, onNewEventOnDate, timezone, onHover, onHoverEnd, onDropWithTime }) {
  const today=new Date();
  const ws=startOfWeek(viewDate, weekStart);
  const allDays=Array.from({length:7},(_,i)=>addDays(ws,i));
  const days=showWeekends ? allDays : allDays.filter(d=>d.getDay()!==0&&d.getDay()!==6);

  return (
    <div className="view-wrap">
      <div className="tg-header-row">
        <div className="tg-time-col"/>
        {days.map((d,i)=>{
          const isToday=isSameDay(d,today);
          return (
            <div key={i} className={`tg-day-head ${isToday?'today':''}`}>
              <span className="tg-dow">{DOW_SHORT[d.getDay()]}</span>
              <span className={`tg-dnum ${isToday?'today':''}`}>{d.getDate()}</span>
            </div>
          );
        })}
      </div>
      <TimeGrid days={days} events={events} activeCats={activeCats} search={search} showWeekends={showWeekends}
        onOpenEvent={onOpenEvent} onNewEventOnDate={onNewEventOnDate} timezone={timezone} viewDate={viewDate}
        onHover={onHover} onHoverEnd={onHoverEnd} onDropWithTime={onDropWithTime}/>
    </div>
  );
}

export default WeekView;
