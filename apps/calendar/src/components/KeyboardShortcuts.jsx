import React from 'react';
import { Icon } from '../constants.jsx';

function KeyboardShortcuts({ onClose }) {
  const shortcuts = [
    ['T', 'Go to today'],['N', 'New event'],['M', 'Month view'],['W', 'Week view'],['D', 'Day view'],
    ['←/→', 'Prev/Next period'],['Ctrl+Z', 'Undo'],['Ctrl+Y', 'Redo'],['Esc', 'Close modal'],['?', 'This help'],
  ];
  return (
    <div className="scrim" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal" style={{width:'min(420px,calc(100vw - 32px))'}}>
        <div className="modal-head"><h2>Keyboard Shortcuts</h2><button className="iconbtn" onClick={onClose}>{Icon.x}</button></div>
        <div className="modal-body">
          {shortcuts.map(([k,d])=>(
            <div key={k} style={{display:'flex',alignItems:'center',gap:16,padding:'8px 0',borderBottom:'1px solid var(--line)'}}>
              <kbd style={{background:'var(--bg-tint)',border:'1px solid var(--line-strong)',borderRadius:6,padding:'3px 10px',fontSize:12,fontFamily:'var(--font-mono)',fontWeight:600,minWidth:60,textAlign:'center',flexShrink:0}}>{k}</kbd>
              <span style={{fontSize:14,color:'var(--ink-2)'}}>{d}</span>
            </div>
          ))}
        </div>
        <div className="modal-foot"><div className="spacer"/><button className="btn primary" onClick={onClose}>Got it</button></div>
      </div>
    </div>
  );
}

export default KeyboardShortcuts;
