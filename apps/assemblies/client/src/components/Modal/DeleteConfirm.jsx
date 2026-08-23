/**
 * DeleteConfirm.jsx
 * Password confirmation for deleting a record.
 */
import { useState } from 'react';

export default function DeleteConfirm({ onConfirm, onCancel }) {
  const [password, setPassword] = useState('');

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <input
        type="password"
        placeholder="Password"
        autoFocus
        value={password}
        onChange={e => setPassword(e.target.value)}
        style={{ 
          height: 26, padding: '0 8px', border: '1px solid var(--red)', 
          borderRadius: 'var(--radius-sm)', fontSize: 12, background: 'var(--surface)', 
          color: 'var(--ink)', fontFamily: 'inherit', outline: 'none', width: 120 
        }}
      />
      <button 
        className="btn btn-sm" 
        style={{ background: 'var(--red)', color: '#fff', borderColor: 'var(--red)' }} 
        onClick={() => onConfirm(password)} 
        disabled={!password}
      >
        Confirm
      </button>
      <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
