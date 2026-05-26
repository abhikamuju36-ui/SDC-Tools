import React from 'react';
import { TIMEZONES } from '../utils.js';
import { Icon, ACCENT_SWATCHES } from '../constants.jsx';

function TweaksPanel({ open, onClose, prefs, setPrefs }) {
  if (!open) return null;
  const set=(k,v)=>{
    const next={...prefs,[k]:v};
    setPrefs(next);
    try { window.parent.postMessage({type:'__edit_mode_set_keys',edits:{[k]:v}},'*'); } catch {}
  };
  const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div className="tweaks">
      <div className="tweaks-head">
        <div className="t">Tweaks</div>
        <button className="iconbtn" style={{height:24,width:24,border:0,background:'transparent'}} onClick={onClose} aria-label="Close tweaks">{Icon.x}</button>
      </div>
      <div className="tweaks-body">
        <div className="tweak">
          <label>Accent color</label>
          <div className="swatches">
            {ACCENT_SWATCHES.map(s=>(
              <div key={s.name} className={`sw-chip ${prefs.accent===s.value?'active':''}`} title={s.name} style={{background:s.value}} onClick={()=>set('accent',s.value)}/>
            ))}
          </div>
        </div>
        <div className="tweak">
          <label>Theme</label>
          <div className="seg">
            <button className={prefs.theme==='light'?'active':''} onClick={()=>set('theme','light')}>Light</button>
            <button className={prefs.theme==='dark'?'active':''} onClick={()=>set('theme','dark')}>Dark</button>
          </div>
        </div>
        <div className="tweak">
          <label>Week starts</label>
          <div className="seg">
            <button className={prefs.weekStart===0?'active':''} onClick={()=>set('weekStart',0)}>Sunday</button>
            <button className={prefs.weekStart===1?'active':''} onClick={()=>set('weekStart',1)}>Monday</button>
          </div>
        </div>
        <div className="tweak">
          <label>Density</label>
          <div className="seg">
            <button className={prefs.density==='compact'?'active':''} onClick={()=>set('density','compact')}>Compact</button>
            <button className={prefs.density==='normal'?'active':''} onClick={()=>set('density','normal')}>Normal</button>
            <button className={prefs.density==='comfy'?'active':''} onClick={()=>set('density','comfy')}>Comfy</button>
          </div>
        </div>
        <div className="tweak">
          <label>Weekends</label>
          <div className="seg">
            <button className={prefs.showWeekends?'active':''} onClick={()=>set('showWeekends',true)}>Show</button>
            <button className={!prefs.showWeekends?'active':''} onClick={()=>set('showWeekends',false)}>Hide</button>
          </div>
        </div>
        <div className="tweak">
          <label>Week numbers</label>
          <div className="seg">
            <button className={prefs.showWeekNumbers?'active':''} onClick={()=>set('showWeekNumbers',true)}>Show</button>
            <button className={!prefs.showWeekNumbers?'active':''} onClick={()=>set('showWeekNumbers',false)}>Hide</button>
          </div>
        </div>
        <div className="tweak">
          <label>Display timezone</label>
          <select className="input tweak-select" value={prefs.timezone||tz} onChange={e=>set('timezone',e.target.value)}>
            {TIMEZONES.map(t=><option key={t} value={t}>{t.replace('_',' ')}</option>)}
          </select>
          <div style={{fontSize:11,color:'var(--ink-3)',marginTop:3}}>Browser: {tz}</div>
        </div>
      </div>
    </div>
  );
}

export default TweaksPanel;
