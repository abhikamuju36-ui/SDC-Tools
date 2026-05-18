import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import {
  AXIS_TYPES,
  AXIS_LABELS,
  DEFAULT_LOAD_AXES,
  DEFAULT_UNLOAD_AXES,
  STATION_TYPES
} from './MachineConfigConstants.jsx';

export function SmGeneratorPanel({ stations, sms }) {
  const batchGenerateStateMachines = useDiagramStore(s => s.batchGenerateStateMachines);
  const [showGenerator, setShowGenerator] = useState(false);

  const nonEmpty = useMemo(() => stations.filter(s => s.type !== 'empty'), [stations]);
  const smIdSet = useMemo(() => new Set(sms.map(s => s.id)), [sms]);
  const hasSmSet = useMemo(() => {
    const s = new Set();
    for (const st of nonEmpty) {
      const validSmIds = (st.smIds ?? []).filter(id => smIdSet.has(id));
      if (validSmIds.length > 0) s.add(st.id);
    }
    return s;
  }, [nonEmpty, smIdSet]);
  
  const eligible = useMemo(() => nonEmpty.filter(s => !hasSmSet.has(s.id)), [nonEmpty, hasSmSet]);

  const defaultAxes = (type) => {
    if (type === 'load') return DEFAULT_LOAD_AXES.map(a => ({ ...a }));
    if (type === 'unload') return DEFAULT_UNLOAD_AXES.map(a => ({ ...a }));
    return [];
  };

  const [genConfigs, setGenConfigs] = useState(() => {
    const cfgs = {};
    for (const st of eligible) {
      cfgs[st.id] = {
        checked: true,
        stationType: st.type ?? 'process',
        copyFromSmId: null,
        axes: defaultAxes(st.type),
        verifyType: st.type === 'verify' ? 'vision' : null,
        generateSequence: true,
      };
    }
    return cfgs;
  });

  useEffect(() => {
    setGenConfigs(prev => {
      const next = { ...prev };
      for (const st of eligible) {
        if (!next[st.id]) {
          next[st.id] = {
            checked: true,
            stationType: st.type ?? 'process',
            copyFromSmId: null,
            axes: defaultAxes(st.type),
            verifyType: st.type === 'verify' ? 'vision' : null,
            generateSequence: true,
          };
        }
      }
      for (const key of Object.keys(next)) {
        if (!eligible.find(s => s.id === key)) delete next[key];
      }
      return next;
    });
  }, [eligible]);

  const updateCfg = useCallback((stId, patch) => {
    setGenConfigs(prev => ({ ...prev, [stId]: { ...prev[stId], ...patch } }));
  }, []);

  const checkedCount = useMemo(() => eligible.filter(s => genConfigs[s.id]?.checked).length, [eligible, genConfigs]);

  const handleCheckAll = useCallback((val) => {
    setGenConfigs(prev => {
      const next = { ...prev };
      for (const st of eligible) { if (next[st.id]) next[st.id] = { ...next[st.id], checked: val }; }
      return next;
    });
  }, [eligible]);

  const handleGenerate = useCallback(() => {
    const configs = eligible
      .filter(st => genConfigs[st.id]?.checked)
      .map(st => {
        const c = genConfigs[st.id];
        return {
          stationId: st.id,
          stationNumber: st.number,
          stationName: st.name,
          stationType: c.stationType,
          copyFromSmId: c.copyFromSmId ?? null,
          axes: c.axes ?? [],
          verifyType: c.stationType === 'verify' ? (c.verifyType ?? 'vision') : null,
          generateSequence: c.generateSequence !== false,
        };
      });
    if (configs.length === 0) return;
    batchGenerateStateMachines(configs);
    setShowGenerator(false);
  }, [eligible, genConfigs, batchGenerateStateMachines]);

  if (nonEmpty.length === 0) return null;

  return (
    <div className="sm-gen-panel">
      <button
        className={`sm-gen-panel__toggle${showGenerator ? ' sm-gen-panel__toggle--open' : ''}`}
        onClick={() => setShowGenerator(v => !v)}
      >
        <span className="sm-gen-panel__toggle-icon">{showGenerator ? '▼' : '▶'}</span>
        Generate State Machines
        {!showGenerator && eligible.length > 0 && (
          <span className="sm-gen-panel__badge">{eligible.length} to generate</span>
        )}
        {!showGenerator && eligible.length === 0 && nonEmpty.length > 0 && (
          <span className="sm-gen-panel__badge sm-gen-panel__badge--done">All generated</span>
        )}
      </button>

      {showGenerator && (
        <div className="sm-gen-panel__body">
          <div className="sm-gen-panel__toolbar">
            <button className="sm-gen-panel__tool-btn" onClick={() => handleCheckAll(true)} title="Check all">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#475569" strokeWidth="1.5"/><path d="M4.5 8.5L7 11L11.5 5.5" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </button>
            <button className="sm-gen-panel__tool-btn" onClick={() => handleCheckAll(false)} title="Uncheck all">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#475569" strokeWidth="1.5"/></svg>
            </button>
            <div style={{ flex: 1 }} />
            <span className="sm-gen-panel__count">{checkedCount} of {eligible.length} selected</span>
            <button
              className="sm-gen-panel__generate-btn"
              onClick={handleGenerate}
              disabled={checkedCount === 0}
            >
              Generate {checkedCount} State Machine{checkedCount !== 1 ? 's' : ''}
            </button>
          </div>

          {nonEmpty.filter(st => hasSmSet.has(st.id)).length > 0 && (
            <div className="sm-gen-existing">
              <div className="sm-gen-existing__header">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13z" stroke="#16a34a" strokeWidth="1.5"/><path d="M5.5 8.5L7 10l3.5-4" stroke="#16a34a" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                <span>{nonEmpty.filter(st => hasSmSet.has(st.id)).length} stations already have state machines</span>
              </div>
              <div className="sm-gen-existing__list">
                {nonEmpty.filter(st => hasSmSet.has(st.id)).map(st => {
                  const stType = STATION_TYPES.find(t => t.id === st.type);
                  const linkedSms = (st.smIds ?? []).map(id => sms.find(s => s.id === id)).filter(Boolean);
                  return (
                    <div key={st.id} className="sm-gen-existing__item">
                      <span className="sm-gen-existing__station">S{String(st.number).padStart(2, '0')}</span>
                      <span className="sm-gen-existing__name">{st.name}</span>
                      <span className="sm-gen-table__pill" style={{ background: stType?.color ?? '#94a3b8', fontSize: 10, padding: '1px 6px' }}>
                        {stType?.label ?? st.type}
                      </span>
                      <span className="sm-gen-existing__sms">
                        {linkedSms.map(sm => (
                          <span key={sm.id} className="sm-gen-table__sm-tag">
                            S{String(sm.stationNumber).padStart(2, '0')} {sm.displayName ?? sm.name}
                          </span>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <table className="sm-gen-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}></th>
                <th style={{ width: 44 }}>#</th>
                <th>Name</th>
                <th style={{ width: 90 }}>Type</th>
                <th>Configuration</th>
              </tr>
            </thead>
            <tbody>
              {eligible.map(st => {
                const c = genConfigs[st.id] || {};
                const stType = STATION_TYPES.find(t => t.id === c.stationType) ?? STATION_TYPES[0];

                return (
                  <tr key={st.id} className={c.checked ? 'sm-gen-table__row--selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={c.checked ?? false}
                        onChange={e => updateCfg(st.id, { checked: e.target.checked })}
                      />
                    </td>
                    <td style={{ fontWeight: 700, color: '#64748b' }}>
                      S{String(st.number).padStart(2, '0')}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{st.name}</span>
                    </td>
                    <td>
                      <span className="sm-gen-table__pill" style={{ background: stType.color }}>
                        {stType.label}
                      </span>
                    </td>
                    <td>
                      <div className="sm-gen-table__config-options">
                        <div className="sm-gen-table__mode-row">
                          <label>
                            <input
                              type="radio"
                              name={`mode-${st.id}`}
                              checked={!c.copyFromSmId}
                              onChange={() => updateCfg(st.id, { copyFromSmId: null })}
                            />
                            <span>Generate New</span>
                          </label>
                          {sms.length > 0 && (
                            <label style={{ marginLeft: 12 }}>
                              <input
                                type="radio"
                                name={`mode-${st.id}`}
                                checked={!!c.copyFromSmId}
                                onChange={() => updateCfg(st.id, { copyFromSmId: sms[0].id })}
                              />
                              <span>Copy Existing</span>
                            </label>
                          )}
                        </div>

                        {c.copyFromSmId ? (
                          <div className="sm-gen-table__copy-row">
                            <select
                              value={c.copyFromSmId}
                              onChange={e => updateCfg(st.id, { copyFromSmId: e.target.value })}
                              className="sm-gen-table__select"
                            >
                              {sms.map(sm => (
                                <option key={sm.id} value={sm.id}>
                                  S{String(sm.stationNumber).padStart(2, '0')} {sm.displayName ?? sm.name}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="sm-gen-table__gen-row">
                            {/* Type selector inside config row */}
                            <div className="sm-gen-table__type-select">
                              <span className="sm-gen-table__label-hint">Role:</span>
                              <select
                                value={c.stationType}
                                onChange={e => {
                                  const newType = e.target.value;
                                  const patch = { stationType: newType };
                                  if (newType === 'verify') patch.verifyType = 'vision';
                                  if (newType === 'load') patch.axes = DEFAULT_LOAD_AXES.map(a => ({ ...a }));
                                  if (newType === 'unload') patch.axes = DEFAULT_UNLOAD_AXES.map(a => ({ ...a }));
                                  if (newType === 'process' || newType === 'reject') patch.axes = [];
                                  updateCfg(st.id, patch);
                                }}
                                className="sm-gen-table__select sm-gen-table__select--small"
                              >
                                {STATION_TYPES.filter(t => t.id !== 'empty').map(t => (
                                  <option key={t.id} value={t.id}>{t.label}</option>
                                ))}
                              </select>
                            </div>

                            {/* Verify Mode */}
                            {c.stationType === 'verify' && (
                              <div className="sm-gen-table__verify-options" style={{ marginLeft: 16 }}>
                                <span className="sm-gen-table__label-hint">Verify via:</span>
                                <select
                                  value={c.verifyType ?? 'vision'}
                                  onChange={e => updateCfg(st.id, { verifyType: e.target.value })}
                                  className="sm-gen-table__select sm-gen-table__select--small"
                                >
                                  <option value="vision">Vision Camera</option>
                                  <option value="sensor">Digital Sensor</option>
                                  <option value="mechanical">Pneu Probe</option>
                                </select>
                              </div>
                            )}

                            {/* Axes List */}
                            {(c.stationType === 'load' || c.stationType === 'unload' || c.stationType === 'process' || c.stationType === 'reject') && (
                              <div className="sm-gen-table__axes-section" style={{ marginTop: 6, borderTop: '1px dashed #e2e8f0', paddingTop: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                  <span className="sm-gen-table__label-hint" style={{ marginTop: 2 }}>Axes:</span>
                                  {(c.axes ?? []).map((axis, axIdx) => (
                                    <div key={axIdx} className="sm-gen-table__axis-pill" style={{ display: 'flex', alignItems: 'center', background: '#f1f5f9', border: '1px solid #cbd5e1', borderRadius: 4, padding: '2px 4px', fontSize: 11 }}>
                                      <input
                                        type="text"
                                        value={axis.label}
                                        onChange={e => {
                                          const newAxes = [...c.axes];
                                          newAxes[axIdx].label = e.target.value;
                                          updateCfg(st.id, { axes: newAxes });
                                        }}
                                        style={{ width: 36, border: 'none', background: 'transparent', fontWeight: 700, textAlign: 'center', padding: 0, fontSize: 11 }}
                                        placeholder={`A${axIdx+1}`}
                                      />
                                      <select
                                        value={axis.type}
                                        onChange={e => {
                                          const newAxes = [...c.axes];
                                          newAxes[axIdx].type = e.target.value;
                                          updateCfg(st.id, { axes: newAxes });
                                        }}
                                        style={{ border: 'none', background: 'transparent', color: '#64748b', paddingRight: 0, fontSize: 11 }}
                                      >
                                        {AXIS_TYPES.map(at => (
                                          <option key={at.id} value={at.id}>{at.label}</option>
                                        ))}
                                      </select>
                                      <button
                                        onClick={() => {
                                          const newAxes = c.axes.filter((_, i) => i !== axIdx);
                                          updateCfg(st.id, { axes: newAxes });
                                        }}
                                        style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', marginLeft: 2, padding: '0 2px', fontSize: 12 }}
                                      >×</button>
                                    </div>
                                  ))}
                                  <button
                                    className="sm-gen-table__add-axis-btn"
                                    onClick={() => {
                                      const nextLabel = AXIS_LABELS[c.axes.length] || `A${c.axes.length + 1}`;
                                      const newAxes = [...(c.axes ?? []), { label: nextLabel, type: 'pneumatic' }];
                                      updateCfg(st.id, { axes: newAxes });
                                    }}
                                    style={{ background: '#fff', border: '1px dashed #cbd5e1', borderRadius: 4, padding: '2px 6px', fontSize: 11, color: '#64748b', cursor: 'pointer' }}
                                  >
                                    + Add
                                  </button>
                                </div>
                              </div>
                            )}

                            {/* Generate Sequence Toggle */}
                            {(c.stationType !== 'empty') && (
                              <div className="sm-gen-table__seq-toggle" style={{ marginTop: 6, display: 'flex', alignItems: 'center' }}>
                                <label style={{ display: 'flex', alignItems: 'center', fontSize: 11, color: '#64748b', cursor: 'pointer' }}>
                                  <input
                                    type="checkbox"
                                    checked={c.generateSequence !== false}
                                    onChange={e => updateCfg(st.id, { generateSequence: e.target.checked })}
                                    style={{ marginRight: 4 }}
                                  />
                                  <span>Generate full sequence scaffolding (uncheck for devices only)</span>
                                </label>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
