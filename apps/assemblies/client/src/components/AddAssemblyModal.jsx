import { useState, useEffect, useCallback } from 'react';
import { PREDEFINED_CATEGORIES } from '../constants';

function FieldLabel({ children, required }) {
  return (
    <div className="field-label">
      {children}{required && <span className="req">*</span>}
    </div>
  );
}

export default function AddAssemblyModal({ open, onClose, onAdd }) {
  const [partno,      setPartno]      = useState('');
  const [jobId,       setJobId]       = useState('');
  const [jobName,     setJobName]     = useState('');
  const [description, setDescription] = useState('');
  const [category,    setCategory]    = useState('');
  const [showAdd,     setShowAdd]     = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [comments,    setComments]    = useState('');
  const [updatedBy,   setUpdatedBy]   = useState('');
  const [modelLink,   setModelLink]   = useState('');
  const [pictureLink, setPictureLink] = useState('');
  const [preference,  setPreference]  = useState('');
  const [sdcStandard, setSdcStandard] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  useEffect(() => {
    if (open) {
      setPartno(''); setJobId(''); setJobName(''); setDescription('');
      setCategory(''); setShowAdd(false); setNewCategory('');
      setComments(''); setUpdatedBy(''); setModelLink(''); setPictureLink('');
      setPreference(''); setSdcStandard(''); setSaving(false); setError('');
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!partno.trim()) { setError('Part number is required.'); return; }
    setSaving(true); setError('');
    try {
      const finalCategory = showAdd && newCategory.trim() ? newCategory.trim() : category;
      await onAdd({
        partno: partno.trim(), job_id: jobId.trim() || null, job_name: jobName.trim() || null,
        description: description.trim() || null, category: finalCategory || null,
        comments: comments.trim() || null, updated_by: updatedBy.trim() || null,
        model_link: modelLink.trim() || null, picture_link: pictureLink.trim() || null,
        preference: preference || null, sdc_standard: sdcStandard || null,
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }, [partno, jobId, jobName, description, category, showAdd, newCategory, comments, updatedBy, modelLink, pictureLink, preference, sdcStandard, onAdd, onClose]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-box">
        <div className="modal-head">
          <div>
            <div className="modal-title">Add Assembly Record</div>
            <div className="modal-sub">Create a new entry manually</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Close (Esc)">
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="modal-body custom-scrollbar">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-field">
              <FieldLabel required>Part Number</FieldLabel>
              <input
                autoFocus type="text" className="field-input mono"
                value={partno} placeholder="e.g. ASM-12345"
                onChange={e => { setPartno(e.target.value); setError(''); }}
              />
            </div>
            <div className="form-field">
              <FieldLabel>Job ID</FieldLabel>
              <input type="text" className="field-input mono" value={jobId} onChange={e => setJobId(e.target.value)} placeholder="e.g. 2045" />
            </div>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <FieldLabel>Job Name</FieldLabel>
              <input type="text" className="field-input" value={jobName} onChange={e => setJobName(e.target.value)} placeholder="Project name..." />
            </div>
            <div className="form-field" style={{ gridColumn: '1 / -1' }}>
              <FieldLabel>Description</FieldLabel>
              <textarea className="field-textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="Assembly function and purpose..." />
            </div>
          </div>

          <div className="form-field">
            <FieldLabel>Category</FieldLabel>
            {!showAdd ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <select className="field-select" style={{ flex: 1 }} value={category} onChange={e => setCategory(e.target.value)}>
                  <option value="">None / Uncategorized</option>
                  {PREDEFINED_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <button className="btn btn-ghost btn-sm" style={{ fontWeight: 700 }} onClick={() => setShowAdd(true)}>+ CUSTOM</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <input autoFocus type="text" className="field-input" style={{ flex: 1 }} value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="New category..." />
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', fontWeight: 700 }} onClick={() => setShowAdd(false)}>CANCEL</button>
              </div>
            )}
          </div>

          <div className="form-field">
            <FieldLabel>Comments</FieldLabel>
            <textarea className="field-textarea" rows={3} value={comments} onChange={e => setComments(e.target.value)} placeholder="Technical notes, revision history..." />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div className="form-field">
              <FieldLabel>Updated By</FieldLabel>
              <input type="text" className="field-input" value={updatedBy} onChange={e => setUpdatedBy(e.target.value)} placeholder="Lead Engineer" />
            </div>
            <div className="form-field">
              <FieldLabel>Preference</FieldLabel>
              <div className="toggle-group">
                {['Yes', 'No'].map(opt => (
                  <button key={opt} className={`toggle-btn${preference === opt ? ' on' : ''}`} onClick={() => setPreference(preference === opt ? '' : opt)}>{opt}</button>
                ))}
              </div>
            </div>
            <div className="form-field">
              <FieldLabel>SDC Standard</FieldLabel>
              <div className="toggle-group">
                {['Yes', 'No'].map(opt => (
                  <button key={opt} className={`toggle-btn${sdcStandard === opt ? ' on' : ''}`} onClick={() => setSdcStandard(sdcStandard === opt ? '' : opt)}>{opt}</button>
                ))}
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div className="form-field">
              <FieldLabel>CAD Model Link</FieldLabel>
              <input type="text" className="field-input" value={modelLink} onChange={e => setModelLink(e.target.value)} placeholder="Path or URL..." />
            </div>
            <div className="form-field">
              <FieldLabel>Image Link</FieldLabel>
              <input type="text" className="field-input" value={pictureLink} onChange={e => setPictureLink(e.target.value)} placeholder="Path or URL..." />
            </div>
          </div>
        </div>

        <div className="modal-foot">
          {error && <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 600 }}>{error}</span>}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={saving || !partno.trim()} style={{ height: 38, padding: '0 24px', fontWeight: 700 }}>
            {saving ? 'Creating…' : 'ADD RECORD'}
          </button>
        </div>
      </div>
    </div>
  );
}
