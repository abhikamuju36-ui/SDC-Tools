import React, { useState } from 'react';
import { fmtDateShort } from '../utils.js';

function BirthdaySpotlight({ birthdays }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? birthdays : birthdays.slice(0, 3);
  const extra = birthdays.length - 3;
  return (
    <div style={{background:'var(--side-bg-elev)',border:'1px solid var(--side-line-strong)',borderRadius:8,padding:'10px 12px'}}>
      <div style={{fontSize:11,color:'var(--side-ink-3)',textTransform:'uppercase',letterSpacing:'0.1em',fontWeight:600,marginBottom:6}}>🎂 Birthdays This Week</div>
      {shown.map(e=>(
        <div key={e.id} style={{fontSize:13,color:'var(--side-ink)',padding:'3px 0',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>{e.title.replace("'s Birthday",'')}</span>
          <span style={{fontSize:11,color:'var(--side-ink-3)',flexShrink:0,marginLeft:8}}>{fmtDateShort(e.date)}</span>
        </div>
      ))}
      {extra > 0 && (
        <button
          onClick={()=>setExpanded(x=>!x)}
          style={{marginTop:6,fontSize:11,color:'var(--accent)',background:'transparent',border:'none',cursor:'pointer',padding:0,fontWeight:500,textDecoration:'underline'}}
        >
          {expanded ? '▲ Show less' : `+${extra} more`}
        </button>
      )}
    </div>
  );
}

export default BirthdaySpotlight;
