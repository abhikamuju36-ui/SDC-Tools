import React, { useState } from 'react';
import { CATEGORIES, CATMAP, MONTHS, fmtDateLong, fmtDateShort, fmtTime, isSameDay, ymd, parseYMD, detectConflicts, loadEmployees } from '../utils.js';
import { Icon } from '../constants.jsx';
import { ssPctColor } from './TimeGrid.jsx';

function DeleteConfirmModal({ title, onConfirm, onCancel }) {
  return (
    <div className="scrim" onClick={e=>{ if(e.target===e.currentTarget) onCancel(); }}>
      <div className="modal" style={{width:'min(380px,calc(100vw - 32px))'}} role="dialog" aria-modal="true">
        <div className="modal-head"><h2>Delete Event</h2><button className="iconbtn" onClick={onCancel}>{Icon.x}</button></div>
        <div className="modal-body">
          <p style={{margin:0,fontSize:14,color:'var(--ink-2)'}}>Delete <strong>"{title}"</strong>? This action cannot be undone.</p>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <div className="spacer"/>
          <button className="btn danger" onClick={onConfirm}>{Icon.trash} Delete</button>
        </div>
      </div>
    </div>
  );
}

function EventModal({ mode, event, date, allEvents, onClose, onSave, onDelete, timezone, employees }) {
  const defaultDate=date||new Date();
  const initial=mode==='edit' ? {...event} : {
    id:`user-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
    title:'', date:defaultDate, category:'personal',
    allDay:true, time:'', endTime:'', endDate:null,
    location:'', description:'', repeat:'none',
    attendees:'', url:'', color:'', notify:'', pinned:false,
  };
  const [form, setForm]=useState(initial);
  const [conflicts, setConflicts]=useState([]);
  const [showConflict, setShowConflict]=useState(false);
  const [recurEditMode, setRecurEditMode]=useState(null);
  const [confirmingDelete, setConfirmingDelete]=useState(false);
  const [detailLevel, setDetailLevel]=useState('detailed');
  const [viewMode, setViewMode]=useState('view');
  const isSeeded=event&&event.seeded;
  const isScheduler=event&&event.source==='scheduler';
  const isPaylocity=event && (String(event.id).startsWith('paylocity') || (event.description && String(event.description).startsWith('Paylocity Time Off Report')));
  const isReadOnly=isSeeded||isScheduler;
  const up=(k,v)=>{ if(isReadOnly) return; setForm(f=>({...f,[k]:v})); };
  const cat=CATMAP[form.category]||CATMAP['personal'];
  const emps=employees || loadEmployees() || [];

  const submit=(force=false)=>{
    if(!form.title.trim()) return;
    const saveData={
      ...form,
      title:form.title.trim(),
      date:form.date instanceof Date ? form.date : parseYMD(form.date),
      endDate:form.endDate?(form.endDate instanceof Date?form.endDate:parseYMD(form.endDate)):null,
    };
    if(!force) {
      const found=detectConflicts(saveData, allEvents);
      if(found.length>0){ setConflicts(found); setShowConflict(true); return; }
    }
    onSave(saveData);
  };

  // Feature 20: Recurring edit dialog
  if (event?.isRecurringInstance && mode==='edit' && !recurEditMode) return (
    <div className="scrim" onClick={e=>{if(e.target===e.currentTarget)onClose()}}>
      <div className="modal" style={{width:'min(400px,calc(100vw - 32px))'}}>
        <div className="modal-head"><h2>Edit Recurring Event</h2><button className="iconbtn" onClick={onClose}>{Icon.x}</button></div>
        <div className="modal-body">
          <p style={{fontSize:14,color:'var(--ink-2)',margin:0}}>This event repeats. What would you like to edit?</p>
        </div>
        <div className="modal-foot" style={{flexDirection:'column',gap:8,alignItems:'stretch'}}>
          <button className="btn" style={{textAlign:'left',padding:'12px 16px',height:'auto'}} onClick={()=>setRecurEditMode('this')}>
            <div style={{fontWeight:600}}>This event only</div>
            <div style={{fontSize:12,color:'var(--ink-3)',marginTop:2}}>Only change {fmtDateShort(event.date)}</div>
          </button>
          <button className="btn" style={{textAlign:'left',padding:'12px 16px',height:'auto'}} onClick={()=>setRecurEditMode('all')}>
            <div style={{fontWeight:600}}>All events in series</div>
            <div style={{fontSize:12,color:'var(--ink-3)',marginTop:2}}>Change every occurrence</div>
          </button>
          <button className="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );

  if (showConflict) return (
    <div className="scrim" onClick={e=>{ if(e.target===e.currentTarget){setShowConflict(false); onClose();} }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head"><h2>Scheduling Conflict</h2><button className="iconbtn" onClick={()=>setShowConflict(false)} aria-label="Back">{Icon.x}</button></div>
        <div className="modal-body">
          <div className="conflict-banner">{Icon.warn}<span>{conflicts.length} overlapping event{conflicts.length>1?'s':''} on this day:</span></div>
          {conflicts.map(c=><div key={c.id} className="conflict-item"><strong>{c.title}</strong> — {fmtTime(c.time,timezone)}{c.endTime?` – ${fmtTime(c.endTime,timezone)}`:''}</div>)}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={()=>setShowConflict(false)}>Go back</button>
          <div className="spacer"/>
          <button className="btn primary" onClick={()=>{ setShowConflict(false); submit(true); }}>Save anyway</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="scrim" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{mode==='edit'?(isScheduler?'Scheduler Task':isSeeded?'Event details':'Edit event'):'New event'}</h2>
          <button className="iconbtn" onClick={onClose} aria-label="Close">{Icon.x}</button>
        </div>

        {isSeeded ? (
          <React.Fragment>
            <div className="detail-head" style={{borderBottom:0,paddingBottom:0}}>
              <div className="detail-swatch" style={{'--sw':form.color||cat.sw}}></div>
              <div style={{flex:1}}>
                <h3 className="detail-title">{form.title}</h3>
                <div className="detail-when">{fmtDateLong(form.date)}{form.endDate&&!isSameDay(form.date,new Date(form.endDate))?` – ${fmtDateLong(new Date(form.endDate))}`:''}</div>
              </div>
            </div>
            <div className="detail-body">
              <div className="detail-row"><div className="k">Category</div><div style={{display:'flex',alignItems:'center',gap:8}}><span style={{width:8,height:8,borderRadius:'50%',background:cat.sw,display:'inline-block'}}></span>{cat.label}</div></div>
              {form.time&&<div className="detail-row"><div className="k">Time</div><div>{fmtTime(form.time,timezone)}{form.endTime?` – ${fmtTime(form.endTime,timezone)}`:''}</div></div>}
              {form.location&&<div className="detail-row"><div className="k">Location</div><div>{form.location}</div></div>}
              {form.url&&<div className="detail-row"><div className="k">Link</div><div><a href={form.url} target="_blank" rel="noopener noreferrer" className="detail-link">{form.url}</a></div></div>}
              {form.meta?.role&&<div className="detail-row"><div className="k">Team</div><div>{form.meta.role}</div></div>}
              {form.kind&&<div className="detail-row"><div className="k">Type</div><div>{form.kind==='federal'?'US Federal Holiday':'SDC Observed'}</div></div>}
              {form.description&&<div className="detail-row"><div className="k">Notes</div><div>{form.description}</div></div>}
              <div style={{fontSize:12,color:'var(--ink-3)',marginTop:8,fontStyle:'italic'}}>Seeded events are read-only. Add a personal note for this day using "New event".</div>
            </div>
            <div className="modal-foot"><div className="spacer"/><button className="btn primary" onClick={onClose}>Close</button></div>
          </React.Fragment>
        ) : isScheduler ? (
          <React.Fragment>
            <div className="detail-head" style={{borderBottom:0,paddingBottom:0,display:'flex',alignItems:'center',gap:12}}>
              <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                <span className="ss-badge" style={{background:'#1574C4',padding:'4px 8px',borderRadius:6,color:'#fff',fontWeight:700,textAlign:'center',fontSize:11}}>SCH</span>
                {form.isMilestone && <span style={{background:'rgba(21,116,196,0.1)',color:'#1574C4',padding:'2px 6px',borderRadius:4,fontWeight:600,fontSize:10,textAlign:'center'}}>MILESTONE</span>}
              </div>
              <div style={{flex:1}}>
                <h3 className="detail-title" style={{margin:0}}>{form.title}</h3>
                <div className="detail-when" style={{marginTop:4}}>{fmtDateLong(form.date)}{form.endDate&&!isSameDay(form.date,new Date(form.endDate))?` – ${fmtDateLong(new Date(form.endDate))}`:''}</div>
              </div>
            </div>

            <div className="detail-body" style={{paddingTop:12}}>
              <div className="detail-row"><div className="k">Project</div><div style={{fontWeight:600,color:'var(--ink)'}}>{form.project || '—'}</div></div>
              <div className="detail-row"><div className="k">Phase</div><div style={{fontWeight:500,color:'var(--ink)',textTransform:'capitalize'}}>{form.phase || '—'}</div></div>
              <div className="detail-row"><div className="k">Assignee</div><div>{form.assignee ? `👤 ${form.assignee}` : '—'}</div></div>
              {(form.progress > 0) && (
                <div className="detail-row">
                  <div className="k">Progress</div>
                  <div style={{display:'flex',alignItems:'center',gap:10,flex:1}}>
                    <div style={{height:6,background:'var(--line)',borderRadius:3,overflow:'hidden',flex:1}}>
                      <div style={{height:'100%',width:`${Math.min(form.progress||0,100)}%`,background:ssPctColor(form.progress+'%'),borderRadius:3}}/>
                    </div>
                    <span style={{fontSize:11,fontWeight:700,color:ssPctColor(form.progress+'%')}}>{form.progress}%</span>
                  </div>
                </div>
              )}
              <div className="detail-row"><div className="k">Start Date</div><div>{fmtDateLong(form.date)}</div></div>
              <div className="detail-row"><div className="k">End Date</div><div>{form.endDate ? fmtDateLong(new Date(form.endDate)) : '—'}</div></div>
              {form.description && (
                <div className="detail-row" style={{flexDirection:'column',alignItems:'flex-start',gap:6,marginTop:4}}>
                  <div className="k">Notes</div>
                  <div style={{background:'var(--bg-elev)',padding:'12px 14px',borderRadius:8,width:'100%',fontSize:13,lineHeight:1.5,whiteSpace:'pre-wrap',border:'1px solid var(--line)',color:'var(--ink-2)',maxHeight:'200px',overflowY:'auto'}}>
                    {form.description}
                  </div>
                </div>
              )}
            </div>

            <div style={{margin:'0 20px 12px',padding:'10px 14px',background:'rgba(21,116,196,0.07)',border:'1px solid rgba(21,116,196,0.2)',borderRadius:8,display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#1574C4'}}>
              <span className="ss-badge" style={{background:'#1574C4'}}>SCH</span>
              <span>This task is synced from <strong>SDC Scheduler</strong> and is <strong>read-only</strong>. Edit it in the Scheduler app.</span>
            </div>

            <div className="modal-foot">
              <div className="spacer"/>
              <button className="btn primary" onClick={onClose}>Close</button>
            </div>
          </React.Fragment>
        ) : (isPaylocity && viewMode === 'view') ? (
          <React.Fragment>
            {(() => {
              const data = {};
              if (form.description) {
                form.description.split('\n').forEach(line => {
                  const clean = (prefix) => line.replace(prefix, '').trim();
                  if (line.startsWith('Employee Number:')) data.empNo = clean('Employee Number:');
                  else if (line.startsWith('Employee #:')) data.empNo = clean('Employee #:');
                  else if (line.startsWith('Employee ID:')) data.empNo = clean('Employee ID:');
                  else if (line.startsWith('Employee:')) data.employee = clean('Employee:');
                  else if (line.startsWith('Type:')) data.type = clean('Type:');
                  else if (line.startsWith('Hours:')) data.hours = clean('Hours:');
                  else if (line.startsWith('Status:')) data.status = clean('Status:');
                });
              }
              const isApproved = data.status?.toLowerCase().includes('approved');
              const isPending  = data.status?.toLowerCase().includes('pending');

              let statusColor  = 'var(--ink-2)';
              let statusBg     = 'var(--bg-elev)';
              let statusBorder = '1px solid var(--line)';

              if (isApproved) {
                statusColor  = '#27AE60';
                statusBg     = '#E8F8F5';
                statusBorder = '1px solid #27AE60';
              } else if (isPending) {
                statusColor  = '#E67E22';
                statusBg     = '#FDF5E6';
                statusBorder = '1px solid #E67E22';
              }

              return (
                <React.Fragment>
                  <div className="detail-head" style={{borderBottom:0,paddingBottom:0,display:'flex',alignItems:'center',gap:12}}>
                    <div style={{display:'flex',flexDirection:'column',gap:4,flexShrink:0}}>
                      <span className="cat-pill active" style={{'--sw':'#27AE60','--sw-bg':'#E8F8F5',padding:'4px 8px',borderRadius:6,color:'#27AE60',fontWeight:700,textAlign:'center',fontSize:11,border:'1px solid #27AE60'}}>PTO</span>
                    </div>
                    <div style={{flex:1}}>
                      <h3 className="detail-title" style={{margin:0}}>{form.title}</h3>
                      <div className="detail-when" style={{marginTop:4}}>{fmtDateLong(form.date)}{form.endDate&&!isSameDay(form.date,new Date(form.endDate))?` – ${fmtDateLong(new Date(form.endDate))}`:''}</div>
                    </div>
                  </div>

                  <div style={{margin:'12px 20px 4px',display:'flex',gap:6,background:'var(--bg-elev)',padding:4,borderRadius:20,border:'1px solid var(--line)',width:'max-content'}}>
                    {['Simple', 'Short', 'Detailed'].map(lvl => (
                      <button
                        key={lvl}
                        type="button"
                        className={`btn btn-sm`}
                        style={{
                          padding:'4px 16px',
                          borderRadius:16,
                          fontSize:12,
                          fontWeight:600,
                          border:'none',
                          background:detailLevel===lvl.toLowerCase()?'#27AE60':'transparent',
                          color:detailLevel===lvl.toLowerCase()?'#fff':'var(--ink-3)',
                          cursor:'pointer',
                          transition:'all 0.2s'
                        }}
                        onClick={()=>setDetailLevel(lvl.toLowerCase())}
                      >
                        {lvl}
                      </button>
                    ))}
                  </div>

                  <div className="detail-body" style={{paddingTop:8}}>
                    <div className="detail-row"><div className="k">Employee Name</div><div style={{fontWeight:600,color:'var(--ink)'}}>{data.employee || '—'}</div></div>
                    <div className="detail-row"><div className="k">Start Date</div><div>{fmtDateLong(form.date)}</div></div>
                    <div className="detail-row"><div className="k">End Date</div><div>{form.endDate ? fmtDateLong(new Date(form.endDate)) : fmtDateLong(form.date)}</div></div>

                    {(detailLevel === 'short' || detailLevel === 'detailed') && (
                      <React.Fragment>
                        <div className="detail-row"><div className="k">Employee Number</div><div>{data.empNo || '—'}</div></div>
                        <div className="detail-row"><div className="k">Hours</div><div style={{fontWeight:600}}>{data.hours ? `⏱ ${data.hours}` : '—'}</div></div>
                        <div className="detail-row">
                          <div className="k">Status</div>
                          <span style={{background:statusBg,color:statusColor,padding:'4px 12px',borderRadius:12,fontSize:12,fontWeight:700,border:statusBorder}}>
                            {data.status || 'Unknown'}
                          </span>
                        </div>
                      </React.Fragment>
                    )}

                    {detailLevel === 'detailed' && (
                      <div className="detail-row"><div className="k">Description</div><div style={{fontWeight:500,color:'var(--ink-2)'}}>{data.type || 'Time Off'}</div></div>
                    )}
                  </div>

                  <div className="modal-foot">
                    <button className="btn danger" onClick={()=>setConfirmingDelete(true)}>{Icon.trash} Delete</button>
                    <button className="btn btn-sm" onClick={()=>{ const newPinned = !form.pinned; setForm(f=>({...f, pinned: newPinned})); onSave({...form, pinned: newPinned}); }} title="Pin this event" style={{color:form.pinned?'#F39C12':'var(--ink-3)',borderColor:form.pinned?'#F39C12':'var(--line-strong)'}}>
                      {form.pinned ? '📌 Pinned' : '📌 Pin'}
                    </button>
                    <div className="spacer"/>
                    <button className="btn" onClick={()=>setViewMode('edit')} style={{display:'flex',alignItems:'center',gap:4}}>✏️ Edit</button>
                    <button className="btn primary" onClick={onClose}>Close</button>
                  </div>
                  {confirmingDelete&&<DeleteConfirmModal title={form.title} onConfirm={()=>onDelete(form.id)} onCancel={()=>setConfirmingDelete(false)}/>}
                </React.Fragment>
              );
            })()}
          </React.Fragment>
        ) : (
          <React.Fragment>
            <div className="modal-body">
              <input className="input title-input" placeholder="Add title" autoFocus value={form.title} onChange={e=>up('title',e.target.value)} onKeyDown={e=>{ if(e.key==='Enter') submit(); }} />

              <div className="field">
                <label>Category</label>
                <div className="cat-grid">
                  {CATEGORIES.map(c=>(
                    <button key={c.id} type="button" className={`cat-pill ${form.category===c.id?'active':''}`} style={{'--sw':c.sw,'--sw-bg':c.swBg}} onClick={()=>up('category',c.id)}>
                      <span className="dot"></span>{c.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>Start date</label>
                  <input type="date" className="input" value={form.date instanceof Date?ymd(form.date):form.date} onChange={e=>up('date',parseYMD(e.target.value))} />
                </div>
                <div className="field">
                  <label>End date <span style={{fontWeight:400,textTransform:'none'}}>(multi-day)</span></label>
                  <input type="date" className="input" value={form.endDate?(form.endDate instanceof Date?ymd(form.endDate):form.endDate):''} onChange={e=>up('endDate',e.target.value?parseYMD(e.target.value):null)} />
                </div>
              </div>

              <div className="row">
                <div className="field">
                  <label>Repeat</label>
                  <select className="input" value={form.repeat} onChange={e=>up('repeat',e.target.value)}>
                    <option value="none">Doesn't repeat</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </div>
                <div className="field">
                  <label>Reminder</label>
                  <select className="input" value={form.notify||''} onChange={e=>up('notify',e.target.value)}>
                    <option value="">None</option>
                    <option value="5">5 minutes before</option>
                    <option value="15">15 minutes before</option>
                    <option value="30">30 minutes before</option>
                    <option value="60">1 hour before</option>
                    <option value="1440">1 day before</option>
                  </select>
                </div>
              </div>

              <div className="toggle-row">
                <div className={`toggle ${form.allDay?'on':''}`} onClick={()=>up('allDay',!form.allDay)} role="switch" aria-checked={form.allDay}></div>
                <span>All-day event</span>
              </div>

              {!form.allDay&&(
                <div className="row">
                  <div className="field"><label>Starts</label><input type="time" className="input" value={form.time||''} onChange={e=>up('time',e.target.value)}/></div>
                  <div className="field"><label>Ends</label><input type="time" className="input" value={form.endTime||''} onChange={e=>up('endTime',e.target.value)}/></div>
                </div>
              )}

              <div className="field">
                <label>Location</label>
                <input className="input" placeholder="Add location or meeting room" value={form.location||''} onChange={e=>up('location',e.target.value)}/>
              </div>

              <div className="field">
                <label>Meeting link / URL</label>
                <input className="input" placeholder="https://…" value={form.url||''} onChange={e=>up('url',e.target.value)} type="url"/>
              </div>

              <div className="row">
                <div className="field">
                  <label>Attendees</label>
                  <input className="input" list="employees-list" placeholder="Comma-separated names" value={form.attendees||''} onChange={e=>up('attendees',e.target.value)}/>
                  <datalist id="employees-list">
                    {emps.map(emp => {
                      const emailStr = emp.email || `${emp.name.toLowerCase().replace(/\s+/g, '.')}@sdcautomation.com`;
                      return (
                        <option key={emp.name} value={emailStr}>{emp.name} ({emailStr})</option>
                      );
                    })}
                  </datalist>
                </div>
                <div className="field">
                  <label>Custom color</label>
                  <div className="color-row">
                    <input type="color" className="color-pick" value={form.color||'#1574C4'} onChange={e=>up('color',e.target.value)}/>
                    {form.color&&<button className="btn btn-sm" onClick={()=>up('color','')}>Use category color</button>}
                  </div>
                </div>
              </div>

              <div className="field">
                <label>Description</label>
                <textarea className="input" rows="3" placeholder="Add notes…" value={form.description||''} onChange={e=>up('description',e.target.value)}/>
              </div>

              {mode==='edit'&&event?.creatorName&&(
                <div style={{fontSize:11,color:'var(--ink-3)',padding:'0 0 4px',display:'flex',alignItems:'center',gap:4}}>
                  {Icon.users} Created by <strong style={{color:'var(--ink-2)'}}>{event.creatorName}</strong>
                </div>
              )}
            </div>

            {isScheduler && (
              <div style={{margin:'0 20px 12px',padding:'10px 14px',background:'rgba(21,116,196,0.07)',border:'1px solid rgba(21,116,196,0.2)',borderRadius:8,display:'flex',alignItems:'center',gap:8,fontSize:12,color:'#1574C4'}}>
                <span className="ss-badge" style={{background:'#1574C4'}}>SCH</span>
                <span>This task is synced from <strong>SDC Scheduler</strong> and is <strong>read-only</strong>.</span>
              </div>
            )}
            <div className="modal-foot">
              {mode==='edit'&&!isReadOnly&&<button className="btn danger" onClick={()=>setConfirmingDelete(true)}>{Icon.trash} Delete</button>}
              {!isReadOnly&&<button className="btn btn-sm" onClick={()=>up('pinned',!form.pinned)} title="Pin this event" style={{color:form.pinned?'#F39C12':'var(--ink-3)',borderColor:form.pinned?'#F39C12':'var(--line-strong)'}}>
                {form.pinned ? '📌 Pinned' : '📌 Pin'}
              </button>}
              <div className="spacer"/>
              <button className="btn" onClick={onClose}>{isReadOnly?'Close':'Cancel'}</button>
              {!isReadOnly&&<button className="btn primary" onClick={()=>submit()} disabled={!form.title.trim()}>{mode==='edit'?'Save changes':'Create event'}</button>}
            </div>
            {confirmingDelete&&<DeleteConfirmModal title={form.title} onConfirm={()=>onDelete(form.id)} onCancel={()=>setConfirmingDelete(false)}/>}
          </React.Fragment>
        )}
      </div>
    </div>
  );
}

export default EventModal;
