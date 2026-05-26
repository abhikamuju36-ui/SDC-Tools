import React, { useState } from 'react';
import { MONTHS, MONTHS_SHORT } from '../utils.js';
import { Icon } from '../constants.jsx';

function EmployeeModal({ employees, onSave, onClose }) {
  const [list, setList]=useState(()=>employees.map((e,i)=>({...e,_id:i})));
  const [editing, setEditing]=useState(null);
  const [form, setForm]=useState({name:'',role:'',email:'',bMonth:1,bDay:1,id:''});

  const startEdit=(e)=>{
    setEditing(e._id);
    setForm({name:e.name,role:e.role,email:e.email||'',bMonth:e.bMonth||1,bDay:e.bDay||1,id:e.id||''});
  };

  const saveEdit=()=>{
    if(!form.name.trim()) return;
    setList(l=>l.map(e=>e._id===editing?{...e,...form,name:form.name.trim()}:e));
    setEditing(null);
  };

  const addNew=()=>{
    if(!form.name.trim()) return;
    const _id=Date.now();
    setList(l=>[...l,{...form,name:form.name.trim(),_id}]);
    setForm({name:'',role:'',email:'',bMonth:1,bDay:1,id:''});
    setEditing(null);
  };

  const del=(id)=>setList(l=>l.filter(e=>e._id!==id));
  const saveAll=()=>onSave(list.map(({_id,...rest})=>rest));

  return (
    <div className="scrim" onClick={e=>{ if(e.target===e.currentTarget) onClose(); }}>
      <div className="modal emp-modal" role="dialog" aria-modal="true" style={{width:'min(800px, calc(100vw - 32px))'}}>
        <div className="modal-head"><h2>Employee Directory</h2><button className="iconbtn" onClick={onClose} aria-label="Close">{Icon.x}</button></div>

        <div className="modal-body" style={{padding:0,maxHeight:'50vh',overflowY:'auto'}}>
          <table className="emp-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Job Title</th>
                <th>Email</th>
                <th>Birthday</th>
                <th style={{textAlign:'right'}}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.map(e=>(
                <tr key={e._id}>
                  {editing===e._id ? (
                    <td colSpan={6}>
                      <div className="emp-edit-form" style={{padding:'12px',background:'var(--bg-tint)',borderRadius:6,margin:'4px 0',display:'flex',flexDirection:'column',gap:8}}>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                          <input className="input" placeholder="Name" value={form.name} onChange={x=>setForm(f=>({...f,name:x.target.value}))} autoFocus/>
                          <input className="input" placeholder="Job Title" value={form.role} onChange={x=>setForm(f=>({...f,role:x.target.value}))}/>
                          <input className="input" placeholder="Employee ID" value={form.id||''} onChange={x=>setForm(f=>({...f,id:x.target.value}))}/>
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                          <input className="input" placeholder="Email" value={form.email||''} onChange={x=>setForm(f=>({...f,email:x.target.value}))}/>
                          <select className="input" value={form.bMonth} onChange={x=>setForm(f=>({...f,bMonth:+x.target.value}))}>
                            {MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
                          </select>
                          <input className="input" type="number" min="1" max="31" placeholder="Day" value={form.bDay} onChange={x=>setForm(f=>({...f,bDay:+x.target.value}))}/>
                        </div>
                        <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                          <button className="btn primary btn-sm" onClick={saveEdit}>Save</button>
                          <button className="btn btn-sm" onClick={()=>setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <React.Fragment>
                      <td style={{fontFamily:'var(--font-mono)',fontSize:12,color:'var(--ink-3)'}}>{e.id || '—'}</td>
                      <td style={{fontWeight:600}}>{e.name}</td>
                      <td>{e.role}</td>
                      <td style={{color:'var(--ink-3)',fontSize:12}}>{e.email || '—'}</td>
                      <td>{e.bMonth && e.bDay ? `${MONTHS_SHORT[e.bMonth-1]} ${e.bDay}` : '—'}</td>
                      <td>
                        <div style={{display:'flex',gap:4,justifyContent:'flex-end'}}>
                          <button className="iconbtn btn-sm" onClick={()=>startEdit(e)} title="Edit">{Icon.edit}</button>
                          <button className="iconbtn btn-sm danger" onClick={()=>del(e._id)} title="Delete">{Icon.trash}</button>
                        </div>
                      </td>
                    </React.Fragment>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="emp-add">
          <div className="section-label" style={{padding:'0 0 8px',color:'var(--ink-3)'}}>Add new employee</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
            <input className="input" placeholder="Full name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
            <input className="input" placeholder="Job Title" value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}/>
            <input className="input" placeholder="Employee ID" value={form.id||''} onChange={e=>setForm(f=>({...f,id:e.target.value}))}/>
          </div>
          <div className="row" style={{marginTop:6,gap:8,gridTemplateColumns:'1fr 1fr 1fr'}}>
            <input className="input" placeholder="Email" value={form.email||''} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/>
            <select className="input" value={form.bMonth} onChange={e=>setForm(f=>({...f,bMonth:+e.target.value}))}>{MONTHS.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select>
            <input className="input" type="number" min="1" max="31" value={form.bDay} onChange={e=>setForm(f=>({...f,bDay:+e.target.value}))} placeholder="Day"/>
          </div>
          <button className="btn primary" style={{marginTop:8,width:'100%'}} onClick={addNew} disabled={!form.name.trim()}>{Icon.plus} Add employee</button>
        </div>

        <div className="modal-foot">
          <div className="spacer"/>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={saveAll}>Save directory</button>
        </div>
      </div>
    </div>
  );
}

export default EmployeeModal;
