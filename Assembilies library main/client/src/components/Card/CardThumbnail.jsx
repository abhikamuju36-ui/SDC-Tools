/**
 * CardThumbnail.jsx
 * Thumbnail container for AssemblyCard.
 */
import { useState } from 'react';
import API_BASE from '../../utils/apiBase';

function StandardBadge({ standard, preference }) {
  if (standard === 'Yes') return <span className="std-badge std-yes">SDC STANDARD</span>;
  if (preference === 'Yes') return <span className="std-badge std-pref">PREFERRED</span>;
  return null;
}


export default function CardThumbnail({ 
  src, 
  alt, 
  standard, 
  preference, 
  selected, 
  onToggle 
}) {
  const [imgErrored, setImgErrored] = useState(false);

  return (
    <div className="card-thumb">
      {src && !imgErrored ? (
        <img
          src={src.startsWith('/') ? `${API_BASE}${src}` : src}
          alt={alt}
          onError={() => setImgErrored(true)}
        />

      ) : (
        <svg width="40" height="40" fill="none" stroke="var(--border-strong)" viewBox="0 0 24 24" style={{ opacity: 0.5 }}>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )}
      <div className="badge-std">
        <StandardBadge standard={standard} preference={preference} />
      </div>
      <div className="card-check" onClick={e => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={e => onToggle(alt, e.target.checked)}
          style={{ accentColor: 'var(--sdc-blue)', cursor: 'pointer', width: 15, height: 15 }}
        />
      </div>
    </div>
  );
}
