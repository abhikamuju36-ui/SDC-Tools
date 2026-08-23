import React, { useEffect } from 'react';

function ContextMenu({ x, y, event, onEdit, onDelete, onPin, onClose }) {
  useEffect(()=>{
    const h = () => onClose();
    window.addEventListener('click', h);
    return () => window.removeEventListener('click', h);
  }, [onClose]);
  return (
    <div style={{position:'fixed',left:x,top:y,zIndex:300,background:'var(--bg-elev)',border:'1px solid var(--line)',borderRadius:8,boxShadow:'var(--shadow-lg)',minWidth:160,overflow:'hidden',animation:'rise .1s ease'}}>
      {[
        {label:`✏️ Edit "${event.title.substring(0,20)}"`, action:onEdit, disabled: event.seeded||event.readOnly},
        {label: event.pinned ? '📌 Unpin' : '📌 Pin', action:onPin, disabled: event.readOnly},
        {label:'🗑️ Delete', action:onDelete, danger:true, disabled: event.seeded||event.readOnly},
      ].map((item,i) => (
        <button key={i} disabled={item.disabled}
          style={{display:'block',width:'100%',padding:'9px 14px',border:0,background:'transparent',textAlign:'left',fontSize:13,cursor:item.disabled?'not-allowed':'pointer',color:item.danger?'#C0392B':item.disabled?'var(--ink-4)':'var(--ink-2)'}}
          onMouseEnter={e=>{if(!item.disabled)e.target.style.background='var(--bg-tint)'}}
          onMouseLeave={e=>{e.target.style.background='transparent'}}
          onClick={e=>{e.stopPropagation();if(!item.disabled){item.action();onClose();}}}
        >{item.label}</button>
      ))}
    </div>
  );
}

export default ContextMenu;
