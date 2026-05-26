import React from 'react';
import { DOW_LONG, MONTHS, isSameDay, fmtDateLong } from '../utils.js';
import TimeGrid from './TimeGrid.jsx';

function DayView({ viewDate, events, activeCats, search, onOpenEvent, onNewEventOnDate, timezone, onHover, onHoverEnd, onDropWithTime }) {
  const today=new Date();
  const days=[viewDate];
  return (
    <div className="view-wrap">
      <div className="tg-header-row">
        <div className="tg-time-col"/>
        <div className={`tg-day-head ${isSameDay(viewDate,today)?'today':''}`} style={{flex:1}}>
          <span className="tg-dow">{DOW_LONG[viewDate.getDay()]}</span>
          <span className={`tg-dnum ${isSameDay(viewDate,today)?'today':''}`}>{viewDate.getDate()}</span>
          <span className="tg-month">{MONTHS[viewDate.getMonth()]} {viewDate.getFullYear()}</span>
        </div>
      </div>
      <TimeGrid days={days} events={events} activeCats={activeCats} search={search} showWeekends={true}
        onOpenEvent={onOpenEvent} onNewEventOnDate={onNewEventOnDate} timezone={timezone} viewDate={viewDate}
        onHover={onHover} onHoverEnd={onHoverEnd} onDropWithTime={onDropWithTime}/>
    </div>
  );
}

export default DayView;
