import React from 'react';
import { CATMAP, DOW_LONG, MONTHS, fmtTime, fmtDateLong, isSameDay } from '../utils.js';
import { Icon } from '../constants.jsx';
import { ssPctColor } from './TimeGrid.jsx';

function getJobNum(sheetName) {
  if (!sheetName) return null;
  const m = String(sheetName).match(/^(\d{3,6})/);
  return m ? m[1] : null;
}

function DayModal({ date, events, onClose, onOpenEvent, onNewOnDate }) {
  const schedEvents = events.filter(e => e.source === 'scheduler');
  const regEvents   = events.filter(e => e.source !== 'scheduler');

  const RegChip = ({ev}) => {
    const cat = CATMAP[ev.category];
    const fg  = ev.color||cat.sw, bg = ev.color?(ev.color+'22'):cat.swBg;
    return (
      <div className="day-modal-chip" style={{'--chip-fg':fg,'--chip-bg':bg}} onClick={()=>{ onClose(); onOpenEvent(ev); }}>
        {!ev.allDay&&ev.time&&<span style={{fontSize:11,opacity:0.7,flexShrink:0}}>{fmtTime(ev.time)}</span>}
        <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{ev.title}</span>
        {ev.pinned&&<span style={{fontSize:10}}>📌</span>}
      </div>
    );
  };

  const SSChip = ({ev}) => {
    const pct   = parseInt(ev.pctComplete)||0;
    const color = ssPctColor(pct);
    return (
      <div className="day-modal-ss-chip" onClick={()=>{ onClose(); onOpenEvent(ev); }}>
        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:5}}>
          <span className="ss-badge" style={{background:color,flexShrink:0}}>SS</span>
          {getJobNum(ev.sheetName)&&<span className="ss-job-num" style={{flexShrink:0}}>{getJobNum(ev.sheetName)}</span>}
          <span style={{fontSize:12,fontWeight:600,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',color:'var(--ink)'}}>{ev.title}</span>
          {ev.pctComplete&&<span style={{fontSize:11,fontWeight:700,color,flexShrink:0}}>{ev.pctComplete}</span>}
        </div>
        <div style={{height:4,background:'var(--line)',borderRadius:2,overflow:'hidden',marginBottom:5}}>
          <div style={{height:'100%',width:`${Math.min(pct,100)}%`,background:color,borderRadius:2,transition:'width 0.3s'}}/>
        </div>
        <div style={{display:'flex',gap:10,fontSize:10,color:'var(--ink-3)',flexWrap:'wrap',alignItems:'center'}}>
          {ev.sheetName&&<span style={{fontWeight:500,color:'var(--ink-2)'}}>📋 {ev.sheetName.replace(/^\d{3,6}[-–\s]*/,'').trim()}</span>}
          {ev.manager&&<span>👤 {ev.manager}</span>}
          {ev.duration&&<span>⏱ {ev.duration}</span>}
          {ev.status&&<span style={{color:ev.status.toLowerCase().includes('complete')?'#1B8A3F':'var(--ink-3)',fontWeight:ev.status.toLowerCase().includes('complete')?600:400}}>● {ev.status}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="scrim" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal" style={{width:'min(520px,calc(100vw - 32px))'}} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div>
            <h2 style={{margin:0}}>{DOW_LONG[date.getDay()]}, {MONTHS[date.getMonth()]} {date.getDate()}</h2>
            <div style={{fontSize:12,color:'var(--ink-3)',marginTop:2}}>{events.length} event{events.length!==1?'s':''}{schedEvents.length>0?` · ${schedEvents.length} from Scheduler`:''}</div>
          </div>
          <button className="iconbtn" onClick={onClose} aria-label="Close">{Icon.x}</button>
        </div>
        <div className="modal-body" style={{gap:0,padding:'12px 16px',maxHeight:'60vh',overflowY:'auto'}}>

          {regEvents.length > 0 && (
            <div style={{marginBottom: schedEvents.length>0?16:0}}>
              {regEvents.length > 0 && schedEvents.length > 0 && (
                <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--ink-3)',marginBottom:6,paddingLeft:2}}>Calendar Events</div>
              )}
              <div style={{display:'flex',flexDirection:'column',gap:4}}>
                {regEvents.map(ev=><RegChip key={ev.id} ev={ev}/>)}
              </div>
            </div>
          )}

          {schedEvents.length > 0 && (
            <div>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',color:'#1574C4',marginBottom:6,paddingLeft:2,display:'flex',alignItems:'center',gap:6}}>
                <span className="ss-badge" style={{background:'#1574C4'}}>SCH</span> Scheduler Tasks ({schedEvents.length})
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                {schedEvents.map(ev=><SSChip key={ev.id} ev={ev}/>)}
              </div>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <div className="spacer"/>
          <button className="btn" onClick={onClose}>Close</button>
          <button className="btn primary" onClick={()=>{ onClose(); onNewOnDate(date); }}>{Icon.plus} New event</button>
        </div>
      </div>
    </div>
  );
}

export default DayModal;
