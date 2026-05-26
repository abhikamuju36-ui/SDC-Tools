import React from 'react';
import { CATEGORIES, startOfMonth, endOfMonth } from '../utils.js';

function MonthSummaryBar({ viewDate, allEvents, activeCats, setActiveCats }) {
  const som = startOfMonth(viewDate), eom = endOfMonth(viewDate);
  const monthEvents = allEvents.filter(e => e.date >= som && e.date <= eom);
  const holidays = monthEvents.filter(e => e.category === 'holiday').length;
  const paydays = monthEvents.filter(e => e.category === 'payday').length;
  const birthdays = monthEvents.filter(e => e.category === 'birthday').length;
  const meetings = monthEvents.filter(e => e.category === 'meeting').length;
  const vacations = monthEvents.filter(e => e.category === 'vacation').length;

  const stats = [
    holidays > 0 && { id: 'holiday', icon:'🏛️', label: `${holidays} holiday${holidays>1?'s':''}`, color: 'var(--cat-holiday)' },
    paydays > 0 && { id: 'payday', icon:'💰', label: `${paydays} payday${paydays>1?'s':''}`, color: 'var(--cat-payday)' },
    birthdays > 0 && { id: 'birthday', icon:'🎂', label: `${birthdays} birthday${birthdays>1?'s':''}`, color: 'var(--cat-birthday)' },
    vacations > 0 && { id: 'vacation', icon:'🌴', label: `${vacations} vacation${vacations>1?'s':''}`, color: 'var(--cat-vacation)' },
    meetings > 0 && { id: 'meeting', icon:'📅', label: `${meetings} meeting${meetings>1?'s':''}`, color: 'var(--cat-meeting)' },
  ].filter(Boolean);

  if (stats.length === 0) return null;

  const handlePillClick = (catId) => {
    if (!setActiveCats) return;
    setActiveCats(prev => {
      if (prev.size === 1 && prev.has(catId)) {
        return new Set(CATEGORIES.map(c => c.id));
      }
      return new Set([catId]);
    });
  };

  return (
    <div className="month-summary-bar">
      {stats.map((s,i) => {
        const isIsolated = activeCats.size === 1 && activeCats.has(s.id);
        return (
          <div
            key={i}
            className={`summary-pill ${isIsolated ? 'isolated' : ''}`}
            style={{
              '--pill-color': s.color,
              cursor: 'pointer',
              border: isIsolated ? `2px solid ${s.color}` : '1px solid transparent',
              transform: isIsolated ? 'scale(1.05)' : 'scale(1)',
              boxShadow: isIsolated ? 'var(--shadow-md)' : 'none',
              transition: 'all .2s ease'
            }}
            onClick={() => handlePillClick(s.id)}
            title={isIsolated ? 'Click to show all' : `Show only ${s.id}s`}
          >
            <span>{s.icon}</span><span>{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export default MonthSummaryBar;
