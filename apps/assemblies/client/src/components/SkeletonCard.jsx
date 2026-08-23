export default function SkeletonCard() {
  return (
    <div className="gallery-card" style={{ cursor: 'default' }}>
      <div className="card-thumb">
        <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 0 }} />
      </div>
      <div className="card-meta">
        <div className="skeleton" style={{ height: 12, width: 80, marginBottom: 10, borderRadius: 3 }} />
        <div className="skeleton" style={{ height: 16, width: '95%', marginBottom: 6, borderRadius: 3 }} />
        <div className="skeleton" style={{ height: 16, width: '70%', marginBottom: 16, borderRadius: 3 }} />
        <div style={{ display: 'flex', gap: 10 }}>
          <div className="skeleton" style={{ height: 14, width: 60, borderRadius: 4 }} />
          <div className="skeleton" style={{ height: 14, width: 40, borderRadius: 4 }} />
        </div>
      </div>
    </div>
  );
}
