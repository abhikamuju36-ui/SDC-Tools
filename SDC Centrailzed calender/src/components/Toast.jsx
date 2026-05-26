import React, { useEffect } from 'react';

function Toast({ msg, onDone }) {
  useEffect(()=>{ const id=setTimeout(onDone,3000); return ()=>clearTimeout(id); },[onDone]);
  return <div className="toast">{msg}</div>;
}

export default Toast;
