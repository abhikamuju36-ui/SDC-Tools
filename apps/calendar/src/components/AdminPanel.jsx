import React, { useState, useEffect } from 'react';
import { CATMAP } from '../utils.js';
import { Icon, API_URL } from '../constants.jsx';

function AdminPanel({ authToken, onClose }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [tab, setTab] = useState('users');
  const [saving, setSaving] = useState(null);
  const [noBackend, setNoBackend] = useState(false);

  const ALL_CATS = ['holiday','payday','birthday','meeting','company','deadline','personal'];
  const ROLE_LABELS = { admin:'Admin', hr:'HR', manager:'Manager', employee:'Employee' };

  const headers = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    if (!authToken) { setNoBackend(true); return; }
    const safe = (data) => Array.isArray(data) ? data : [];
    fetch(`${API_URL}/api/admin/users`, { headers })
      .then(r => r.json()).then(d => setUsers(safe(d))).catch(() => setNoBackend(true));
    fetch(`${API_URL}/api/admin/roles`,  { headers })
      .then(r => r.json()).then(d => setRoles(safe(d))).catch(() => {});
  }, []);

  const updateRole = async (userId, newRole) => {
    setSaving(userId);
    await fetch(`${API_URL}/api/admin/users/${userId}/role`, {
      method: 'PUT', headers, body: JSON.stringify({ role: newRole })
    });
    setUsers(u => u.map(x => x.id === userId ? { ...x, role: newRole } : x));
    setSaving(null);
  };

  const toggleCat = async (role, cat) => {
    const r = roles.find(x => x.role === role);
    if (!r) return;
    const cats = r.categories.split(',');
    const next = cats.includes(cat) ? cats.filter(c => c !== cat) : [...cats, cat];
    await fetch(`${API_URL}/api/admin/roles/${role}`, {
      method: 'PUT', headers, body: JSON.stringify({ categories: next })
    });
    setRoles(rs => rs.map(x => x.role === role ? { ...x, categories: next.join(',') } : x));
  };

  return (
    <div className="scrim" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(700px, calc(100vw - 32px))' }}>
        <div className="modal-head">
          <h2>Admin Panel</h2>
          <button className="iconbtn" onClick={onClose}>{Icon.x}</button>
        </div>
        <div style={{ display:'flex', borderBottom:'1px solid var(--line)', padding:'0 20px', background:'var(--bg-tint)' }}>
          {['users','roles'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding:'10px 16px', border:0, background:'transparent', fontWeight:600,
              fontSize:13, textTransform:'uppercase', letterSpacing:'0.06em',
              borderBottom: tab===t ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab===t ? 'var(--accent)' : 'var(--ink-3)', cursor:'pointer'
            }}>{t==='users' ? 'Users' : 'Role Permissions'}</button>
          ))}
        </div>

        {noBackend && (
          <div style={{ margin:'16px 20px', padding:'12px 16px', background:'#FFF8E6', border:'1px solid #F5C518', borderRadius:8, fontSize:13, color:'#7A5800', display:'flex', alignItems:'center', gap:10 }}>
            <span style={{fontSize:18}}>⚠️</span>
            <div>
              <strong>Local Mode — no backend connected.</strong><br/>
              <span style={{color:'#9A7020'}}>User management requires the Node.js server. Set <code>VITE_LOCAL_MODE=false</code> and start the server to manage users.</span>
            </div>
          </div>
        )}
        <div className="modal-body" style={{ maxHeight: 420, overflowY:'auto' }}>
          {tab === 'users' && (
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:13 }}>
              <thead>
                <tr style={{ background:'var(--bg-tint)' }}>
                  {['Name','Email','Role','Last Login'].map(h => (
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontWeight:600, fontSize:11, letterSpacing:'0.1em', textTransform:'uppercase', color:'var(--ink-3)', borderBottom:'1px solid var(--line)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id} style={{ borderBottom:'1px solid var(--line)' }}>
                    <td style={{ padding:'8px 12px', fontWeight:500 }}>{u.name || '—'}</td>
                    <td style={{ padding:'8px 12px', color:'var(--ink-3)', fontSize:12 }}>{u.email}</td>
                    <td style={{ padding:'8px 12px' }}>
                      <select
                        value={u.role}
                        disabled={saving === u.id}
                        onChange={e => updateRole(u.id, e.target.value)}
                        style={{ fontSize:12, padding:'4px 8px', borderRadius:6, border:'1px solid var(--line-strong)', background:'var(--bg)', color:'var(--ink)' }}
                      >
                        {Object.entries(ROLE_LABELS).map(([v,l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </td>
                    <td style={{ padding:'8px 12px', color:'var(--ink-3)', fontSize:12 }}>
                      {u.last_login ? new Date(u.last_login).toLocaleDateString() : 'Never'}
                    </td>
                  </tr>
                ))}
                {users.length === 0 && <tr><td colSpan={4} style={{ padding:20, textAlign:'center', color:'var(--ink-3)' }}>No users yet — they appear after first login.</td></tr>}
              </tbody>
            </table>
          )}

          {tab === 'roles' && (
            <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {roles.map(r => (
                <div key={r.role} style={{ border:'1px solid var(--line)', borderRadius:8, overflow:'hidden' }}>
                  <div style={{ padding:'10px 14px', background:'var(--bg-tint)', fontWeight:700, fontSize:13, textTransform:'uppercase', letterSpacing:'0.06em', borderBottom:'1px solid var(--line)' }}>
                    {ROLE_LABELS[r.role] || r.role}
                  </div>
                  <div style={{ padding:'12px 14px', display:'flex', flexWrap:'wrap', gap:8 }}>
                    {ALL_CATS.map(cat => {
                      const active = r.categories.split(',').includes(cat);
                      const c = CATMAP[cat];
                      return (
                        <button key={cat} onClick={() => toggleCat(r.role, cat)}
                          style={{
                            padding:'5px 12px', borderRadius:999, fontSize:12, fontWeight:500, cursor:'pointer',
                            border: `1px solid ${active ? c.sw : 'var(--line-strong)'}`,
                            background: active ? c.swBg : 'var(--bg)',
                            color: active ? c.sw : 'var(--ink-3)',
                          }}>
                          {c.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <div className="spacer"/>
          <button className="btn primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

export default AdminPanel;
