// Draft Emails tab — vendor list w/ inline expand

function buildEmailBody(e, job) {
  return `Subject: SDC Job ${job?.id || ''} — Expedite Request\n\n${e.vendor} Procurement Team,\n\nReference: SDC Job ${job?.id || ''} (${job?.name || ''})\nBuild Start (firm baseline): ${job?.buildStart || ''}\n\nWe have ${e.pos} open purchase order${e.pos>1?'s':''} with promised dates that conflict with our firm build start. Please confirm whether expedite is achievable, and provide updated promise dates within 48 hours.\n\nIf expedite is not feasible, please propose alternates. We can split-ship partial qtys against the build start date.\n\nRegards,\n${job?.buyer || 'Procurement'}\nProcurement, Stevens Design & Controls`;
}

function copyToClipboard(text, onDone) {
  navigator.clipboard.writeText(text).then(() => { if (onDone) onDone(); });
}

function EmailsTab({ data, job }) {
  const [open, setOpen] = React.useState(null);
  const [copied, setCopied] = React.useState(null);
  const overdueCount = (data?.emails || []).filter(e => e.overdue).length;

  const onCopyAll = () => {
    const all = (data?.emails || []).map(e => buildEmailBody(e, job)).join('\n\n' + '─'.repeat(60) + '\n\n');
    copyToClipboard(all, () => { setCopied('all'); setTimeout(() => setCopied(null), 2000); });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%', overflow: 'hidden' }}>
      {/* Header section */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: 'var(--fg-0)', margin: 0, letterSpacing: '-0.02em' }}>Vendor Emails</h1>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 4 }}>
            {(data?.emails || []).length} supplier follow-ups ready · {overdueCount} overdue · auto-drafted from open POs
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12 }} onClick={onCopyAll}>
            <window.IconCopy size={14} /> {copied === 'all' ? 'Copied' : 'Copy All'}
          </button>
          <button className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 12 }}>
            <window.IconSparkle size={14} /> Send Wave
          </button>
        </div>
      </div>

      <div className="panel" style={{ flex: 1, overflow: 'auto', border: '1px solid var(--border-soft)' }}>
        {(data?.emails || []).map((e, i) => (
          <EmailRow key={i} e={e} job={job} open={open === i} onToggle={() => setOpen(open === i ? null : i)}/>
        ))}
      </div>
    </div>
  );
}

function EmailRow({ e, job, open, onToggle }) {
  const [copied, setCopied] = React.useState(false);
  const body = buildEmailBody(e, job);

  const onCopy = (ev) => {
    ev.stopPropagation();
    copyToClipboard(body, () => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  return (
    <div style={{ borderBottom: '1px solid var(--border-soft)' }}>
      <div className="row-hover" onClick={onToggle} style={{
        display: 'grid', gridTemplateColumns: '3px 40px 1.5fr 1fr auto auto', gap: 16, padding: '12px 20px',
        alignItems: 'center', cursor: 'pointer',
      }}>
        {/* Status Line */}
        <div style={{ width: 3, height: 40, borderRadius: 1.5, background: e.overdue ? 'var(--threat)' : 'var(--sdc-blue)' }}/>
        
        {/* Avatar */}
        <window.VendorAvatar vendor={e.vendor} size={30} />

        {/* Vendor Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--fg-0)' }}>{e.vendor}</span>
            {e.overdue && <window.StatusBadge status="OVERDUE" />}
          </div>
          <span className="mono" style={{ fontSize: 11, color: 'var(--fg-2)' }}>{e.pos} PO{e.pos>1?'s':''}</span>
        </div>

        {/* Contacts */}
        <span className="mono" style={{ fontSize: 11, color: 'var(--fg-3)', textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(e.contacts || []).join(', ')}
        </span>

        {/* Actions */}
        <button className="btn-secondary" onClick={(ev) => { ev.stopPropagation(); onToggle(); }} style={{ padding: '4px 10px', fontSize: 11, gap: 4 }}>
          <window.IconMail size={12} /> {open ? 'Close' : 'Preview'}
        </button>
        <button className="btn-secondary" onClick={onCopy} style={{ padding: '4px 10px', fontSize: 11, gap: 4 }}>
          <window.IconCopy size={12} /> {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {open && (
        <div style={{ padding: '0 20px 20px 59px', display: 'grid', gap: 12 }} className="fade-in">
          <div style={{ background: 'var(--bg-3)', border: '1px solid var(--border-soft)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-1)', fontSize: 11, fontWeight: 600, color: 'var(--fg-2)', display: 'flex', justifyContent: 'space-between' }}>
              <span>Email Draft</span>
              <span className="mono" style={{ fontWeight: 400 }}>Expedite Request — Job {job?.id}</span>
            </div>
            <pre className="mono" style={{
              margin: 0, padding: 16, fontSize: 12, lineHeight: 1.6,
              color: 'var(--fg-1)', whiteSpace: 'pre-wrap', border: 'none',
              background: 'transparent'
            }}>{body}</pre>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" onClick={onCopy}>
              <window.IconCopy size={14} /> {copied ? 'Copied to Clipboard' : 'Copy Email Body'}
            </button>
            <a href={`mailto:${(e.contacts || []).join(',')}?subject=${encodeURIComponent(`SDC Job ${job?.id||''} — Expedite Request`)}&body=${encodeURIComponent(body)}`}
               className="btn-primary" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', fontSize: 13, borderRadius: 6 }}
               onClick={ev => ev.stopPropagation()}>
              <window.IconMail size={14} stroke="white" /> Open in Mail Client
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

window.EmailsTab = EmailsTab;
