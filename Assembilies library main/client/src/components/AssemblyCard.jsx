import { memo } from 'react';
import CardThumbnail from './Card/CardThumbnail';
import { cleanValue, toTitleCase, getCategoryColor } from '../utils/formatters';

function AssemblyCard({ assembly, onClick, selected = false, onToggle }) {
  const { 
    partno, job_id, job_name, description, category, 
    sdc_standard, picture_link, preference
  } = assembly;

  const categoryColor = getCategoryColor(category);

  return (
    <div
      className={`gallery-card group${selected ? ' card-selected' : ''}`}
      onClick={() => onClick(assembly)}
    >
      <CardThumbnail
        src={picture_link}
        alt={partno}
        standard={sdc_standard}
        preference={preference}
        selected={selected}
        onToggle={onToggle}
      />

      <div className="card-meta">
        <div className="card-pn-row">
          <span className="pn-cell" style={{ fontSize: 13, fontWeight: 600 }}>{cleanValue(partno)}</span>
          {job_id && (
            <span className="muted mono px-1.5 py-0.5 bg-white/5 rounded border border-white/10" style={{ fontSize: 10 }}>
              {job_id}
            </span>
          )}
        </div>
        <div className="card-desc" style={{ WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden', minHeight: '2.5em' }}>
          {cleanValue(description || job_name)}
        </div>
        <div className="card-sub">
          {category && (
            <span className={`badge badge-${categoryColor}`} style={{ fontSize: 10 }}>
              {toTitleCase(category)}
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {/* Action buttons could go here */}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(AssemblyCard);
