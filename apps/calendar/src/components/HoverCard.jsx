import React from 'react';
import { CATMAP, fmtDateLong, fmtTime } from '../utils.js';

function HoverCard({ event, anchorRect }) {
  const cat = CATMAP[event.category] || CATMAP['personal'];
  const style = {
    position: 'fixed',
    left: Math.min(anchorRect.left, window.innerWidth - 280),
    top: anchorRect.bottom + 6,
    zIndex: 200,
    width: 260,
    background: 'var(--bg-elev)',
    border: '1px solid var(--line)',
    borderRadius: 10,
    boxShadow: 'var(--shadow-lg)',
    padding: '12px 14px',
    pointerEvents: 'none',
    animation: 'rise .15s ease',
  };
  return (
    <div style={style}>
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
        <div style={{width:10,height:10,borderRadius:'50%',background:event.color||cat.sw,flexShrink:0}}/>
        <div style={{fontWeight:700,fontSize:13,color:'var(--ink)',lineHeight:1.2,flex:1}}>{event.title}</div>
      </div>
      <div style={{fontSize:12,color:'var(--ink-3)',marginBottom:4}}>{fmtDateLong(event.date instanceof Date ? event.date : new Date(event.date))}</div>
      {event.time && <div style={{fontSize:12,color:'var(--ink-2)'}}>{fmtTime(event.time)}{event.endTime ? ` – ${fmtTime(event.endTime)}` : ''}</div>}
      <div style={{fontSize:11,color:cat.sw,marginTop:4,fontWeight:500}}>{cat.label}</div>
      {event.location && <div style={{fontSize:12,color:'var(--ink-3)',marginTop:4,display:'flex',alignItems:'center',gap:4}}>📍 {event.location}</div>}
      {event.description && <div style={{fontSize:12,color:'var(--ink-3)',marginTop:4,overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>{event.description}</div>}
    </div>
  );
}

export default HoverCard;
