import { useState, useCallback } from 'react';
import { useDiagramStore } from '../store/useDiagramStore.js';
import { DeviceIcon } from './DeviceIcons.jsx';
import {
  NETWORK_DEVICE_MAP,
  RANGE_LABELS,
  CHASSIS_TYPE_META,
  CHASSIS_MODULE_TYPES
} from './IOMapConstants.js';
import { _saveModField } from './IOMapHelpers.js';

export function NetworkTab({ project, networkData }) {
  const store = useDiagramStore.getState;
  const netCfg = project?.networkConfig ?? {};
  const { allModules, sortedChassis, subnet, controllerIp } = networkData;
  const [editingId, setEditingId] = useState(null);
  const [showAddModule, setShowAddModule] = useState(false);
  const [showAddChassis, setShowAddChassis] = useState(false);

  const handleSubnetChange = useCallback((val) => {
    store().updateNetworkConfig({ subnet: val });
  }, []);

  const handleControllerIpChange = useCallback((val) => {
    store().updateNetworkConfig({ controllerIp: val });
  }, []);

  const ethernetModules = allModules.filter(m => m.bus === 'ethernet');
  const iolinkModules = allModules.filter(m => m.bus === 'iolink');

  const ethernetByType = {};
  for (const mod of ethernetModules) {
    const mapping = NETWORK_DEVICE_MAP[mod.deviceType];
    const key = mapping?.rangeKey ?? 'generic';
    if (!ethernetByType[key]) ethernetByType[key] = [];
    ethernetByType[key].push(mod);
  }

  return (
    <>
      {/* ── Network Summary ──────────────────────────────────────────── */}
      <div className="io-map__summary">
        <div className="io-map__counts">
          <div className="io-map__count-badge" style={{ borderColor: '#1574C4' }}>
            <span className="io-map__count-num" style={{ color: '#1574C4' }}>{ethernetModules.length}</span>
            <span className="io-map__count-label">EtherNet/IP</span>
          </div>
          <div className="io-map__count-badge" style={{ borderColor: '#0072B5' }}>
            <span className="io-map__count-num" style={{ color: '#0072B5' }}>{iolinkModules.length}</span>
            <span className="io-map__count-label">IO-Link</span>
          </div>
          <div className="io-map__count-badge" style={{ borderColor: '#061d39' }}>
            <span className="io-map__count-num" style={{ color: '#061d39' }}>{sortedChassis.length}</span>
            <span className="io-map__count-label">Backplane</span>
          </div>
          <div className="io-map__count-badge io-map__count-badge--total">
            <span className="io-map__count-num">{ethernetModules.length + iolinkModules.length + sortedChassis.length}</span>
            <span className="io-map__count-label">Total</span>
          </div>
        </div>
      </div>

      {/* ── Subnet Configuration ─────────────────────────────────────── */}
      <div className="net__config-bar">
        <div className="net__config-field">
          <label className="net__config-label">Base Subnet</label>
          <input
            className="net__config-input"
            value={netCfg.subnet || '10.1.60'}
            onChange={e => handleSubnetChange(e.target.value)}
            placeholder="10.1.60"
          />
        </div>
        <div className="net__config-field">
          <label className="net__config-label">Controller IP</label>
          <input
            className="net__config-input"
            value={netCfg.controllerIp || '10.1.60.10'}
            onChange={e => handleControllerIpChange(e.target.value)}
            placeholder="10.1.60.10"
          />
        </div>
        <div className="net__config-field">
          <label className="net__config-label">Controller Slot</label>
          <input
            className="net__config-input net__config-input--narrow"
            type="number"
            value={netCfg.controllerSlot ?? 0}
            onChange={e => store().updateNetworkConfig({ controllerSlot: parseInt(e.target.value) || 0 })}
            min={0}
          />
        </div>
        <div className="net__ip-legend">
          <span className="net__ip-legend-title">IP Ranges:</span>
          {Object.entries(netCfg.ipRanges ?? {}).map(([key, range]) => {
            const meta = RANGE_LABELS[key];
            if (!meta) return null;
            return (
              <span key={key} className="net__ip-range-chip" style={{ borderColor: meta.color }}>
                <span style={{ color: meta.color, fontWeight: 700 }}>.{range.start}+</span>
                <span>{meta.label}</span>
              </span>
            );
          })}
        </div>
      </div>

      {/* ── EtherNet/IP Modules ──────────────────────────────────────── */}
      <div className="io-map__section">
        <div className="io-map__section-header" style={{ borderLeftColor: '#1574C4' }}>
          <span className="io-map__section-title">
            <span style={{ fontSize: 16 }}>🌐</span>
            EtherNet/IP Devices
          </span>
          <span className="io-map__section-count" style={{ color: '#1574C4' }}>{ethernetModules.length}</span>
          <button className="net__add-btn" onClick={() => setShowAddModule(true)} title="Add manual module">+ Add</button>
        </div>

        {ethernetModules.length === 0 && !showAddModule && (
          <div className="io-map__empty" style={{ padding: '16px 20px' }}>
            <p>No EtherNet/IP devices detected.</p>
            <p style={{ color: '#64748b', fontSize: 12 }}>
              Add servo axes, vision systems, or robots to your state machines — they will appear here automatically with auto-assigned IPs.
            </p>
          </div>
        )}

        {ethernetModules.length > 0 && (
          <table className="io-map__table">
            <thead>
              <tr>
                <th className="io-map__th" style={{ width: 32 }}>#</th>
                <th className="io-map__th" style={{ width: 130 }}>Module Name</th>
                <th className="io-map__th" style={{ width: 120 }}>IP Address</th>
                <th className="io-map__th" style={{ width: 140 }}>Catalog Number</th>
                <th className="io-map__th io-map__th--station">Station</th>
                <th className="io-map__th">Device</th>
                <th className="io-map__th" style={{ width: 70 }}>RPI (ms)</th>
                <th className="io-map__th" style={{ width: 60 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {ethernetModules.map((mod, i) => {
                const mapping = NETWORK_DEVICE_MAP[mod.deviceType];
                const rangeLabel = RANGE_LABELS[mapping?.rangeKey ?? 'generic'];
                const isEditing = editingId === mod.id;

                return (
                  <tr key={mod.id} className={`io-map__row${isEditing ? ' net__row--editing' : ''}`}>
                    <td className="io-map__td io-map__td--num">{i + 1}</td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={mod.name}
                          onChange={e => {
                            if (mod.isManual || mod.isAuto) {
                              const mods = [...(netCfg.modules ?? [])];
                              const existing = mods.find(m => m.id === mod.id);
                              if (existing) {
                                store().updateNetworkModule(mod.id, { name: e.target.value });
                              } else {
                                store().addNetworkModule({ ...mod, id: undefined, linkedDeviceId: mod.linkedDeviceId, name: e.target.value });
                              }
                            }
                          }} />
                      ) : (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          {mod.deviceType && <DeviceIcon type={mod.deviceType} size={14} />}
                          <code className="net__module-name">{mod.name}</code>
                        </span>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input net__inline-input--ip" value={mod.ipAddress}
                          onChange={e => _saveModField(store, netCfg, mod, 'ipAddress', e.target.value)} />
                      ) : (
                        <code className="net__ip">{mod.ipAddress}</code>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={mod.catalogNumber} placeholder="e.g. 2198-H025-ERS2"
                          onChange={e => _saveModField(store, netCfg, mod, 'catalogNumber', e.target.value)} />
                      ) : (
                        <span className="net__catalog">{mod.catalogNumber || <span className="io-map__zero">—</span>}</span>
                      )}
                    </td>
                    <td className="io-map__td io-map__td--station">
                      {mod.station && <span className="io-map__station-badge">{mod.station}</span>}
                    </td>
                    <td className="io-map__td" style={{ fontSize: 11, color: '#5a6a7e' }}>
                      {mod.deviceName || mod.deviceType || '—'}
                    </td>
                    <td className="io-map__td" style={{ textAlign: 'center', fontSize: 11 }}>
                      {isEditing ? (
                        <input className="net__inline-input net__inline-input--narrow" type="number"
                          value={Math.round((mod.rpiUs ?? 10000) / 1000)}
                          onChange={e => _saveModField(store, netCfg, mod, 'rpiUs', (parseInt(e.target.value) || 10) * 1000)} />
                      ) : (
                        <span>{Math.round((mod.rpiUs ?? 10000) / 1000)}</span>
                      )}
                    </td>
                    <td className="io-map__td" style={{ textAlign: 'center' }}>
                      <button
                        className="net__edit-btn"
                        onClick={() => setEditingId(isEditing ? null : mod.id)}
                        title={isEditing ? 'Done' : 'Edit'}
                      >
                        {isEditing ? '✓' : '✎'}
                      </button>
                      {mod.isManual && !mod.isAuto && (
                        <button className="net__delete-btn" onClick={() => store().deleteNetworkModule(mod.id)} title="Remove">✕</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {showAddModule && (
          <AddModuleForm
            onAdd={(data) => { store().addNetworkModule(data); setShowAddModule(false); }}
            onCancel={() => setShowAddModule(false)}
            subnet={subnet}
          />
        )}
      </div>

      {/* ── Backplane / Chassis Layout ───────────────────────────────── */}
      <div className="io-map__section">
        <div className="io-map__section-header" style={{ borderLeftColor: '#061d39' }}>
          <span className="io-map__section-title">
            <span style={{ fontSize: 16 }}>📦</span>
            Backplane / Chassis Layout
          </span>
          <span className="io-map__section-count" style={{ color: '#061d39' }}>{sortedChassis.length}</span>
          <button className="net__add-btn" onClick={() => setShowAddChassis(true)} title="Add chassis module">+ Add</button>
        </div>

        {sortedChassis.length === 0 && !showAddChassis && (
          <div className="io-map__empty" style={{ padding: '16px 20px' }}>
            <p>No backplane modules defined.</p>
            <p style={{ color: '#64748b', fontSize: 12 }}>
              Add DI/DO/AI/AO/Safety modules to define the local chassis layout. Slot 0 is typically the controller.
            </p>
          </div>
        )}

        <div className="net__chassis-visual">
          <div className="net__chassis-slot net__chassis-slot--controller">
            <div className="net__chassis-slot-num">0</div>
            <div className="net__chassis-slot-label">CPU</div>
            <div className="net__chassis-slot-cat" style={{ fontSize: 8 }}>{controllerIp}</div>
          </div>
          {sortedChassis.map(slot => {
            const meta = CHASSIS_TYPE_META[slot.type] ?? CHASSIS_TYPE_META.OTHER;
            return (
              <div key={slot.id} className="net__chassis-slot" style={{ borderTopColor: meta.color }}>
                <div className="net__chassis-slot-num">{slot.slot}</div>
                <div className="net__chassis-slot-label" style={{ color: meta.color }}>{slot.type}</div>
                <div className="net__chassis-slot-cat" title={slot.catalogNumber}>{slot.name || slot.catalogNumber || '—'}</div>
              </div>
            );
          })}
        </div>

        {sortedChassis.length > 0 && (
          <table className="io-map__table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th className="io-map__th" style={{ width: 48 }}>Slot</th>
                <th className="io-map__th" style={{ width: 80 }}>Type</th>
                <th className="io-map__th" style={{ width: 120 }}>Name</th>
                <th className="io-map__th" style={{ width: 150 }}>Catalog Number</th>
                <th className="io-map__th">Description</th>
                <th className="io-map__th" style={{ width: 60 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedChassis.map(slot => {
                const meta = CHASSIS_TYPE_META[slot.type] ?? CHASSIS_TYPE_META.OTHER;
                const isEditing = editingId === slot.id;
                return (
                  <tr key={slot.id} className={`io-map__row${isEditing ? ' net__row--editing' : ''}`}>
                    <td className="io-map__td" style={{ textAlign: 'center', fontWeight: 700 }}>
                      {isEditing ? (
                        <input className="net__inline-input net__inline-input--narrow" type="number" value={slot.slot ?? 0}
                          onChange={e => store().updateChassisModule(slot.id, { slot: parseInt(e.target.value) || 0 })} min={0} />
                      ) : slot.slot}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <select className="net__inline-select" value={slot.type}
                          onChange={e => store().updateChassisModule(slot.id, { type: e.target.value })}>
                          {CHASSIS_MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      ) : (
                        <span className="net__type-badge" style={{ background: meta.color }}>{meta.label}</span>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={slot.name || ''} placeholder="e.g. DI_1"
                          onChange={e => store().updateChassisModule(slot.id, { name: e.target.value })} />
                      ) : (
                        <code>{slot.name || '—'}</code>
                      )}
                    </td>
                    <td className="io-map__td">
                      {isEditing ? (
                        <input className="net__inline-input" value={slot.catalogNumber || ''} placeholder="e.g. 5069-IB16/A"
                          onChange={e => store().updateChassisModule(slot.id, { catalogNumber: e.target.value })} />
                      ) : (
                        <span className="net__catalog">{slot.catalogNumber || '—'}</span>
                      )}
                    </td>
                    <td className="io-map__td" style={{ fontSize: 11, color: '#5a6a7e' }}>
                      {isEditing ? (
                        <input className="net__inline-input" value={slot.description || ''} placeholder="Description"
                          onChange={e => store().updateChassisModule(slot.id, { description: e.target.value })} />
                      ) : (slot.description || '—')}
                    </td>
                    <td className="io-map__td" style={{ textAlign: 'center' }}>
                      <button className="net__edit-btn" onClick={() => setEditingId(isEditing ? null : slot.id)}
                        title={isEditing ? 'Done' : 'Edit'}>
                        {isEditing ? '✓' : '✎'}
                      </button>
                      <button className="net__delete-btn" onClick={() => store().deleteChassisModule(slot.id)} title="Remove">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        {showAddChassis && (
          <AddChassisForm
            onAdd={(data) => { store().addChassisModule(data); setShowAddChassis(false); }}
            onCancel={() => setShowAddChassis(false)}
            nextSlot={(sortedChassis.length > 0 ? Math.max(...sortedChassis.map(s => s.slot ?? 0)) + 1 : 1)}
          />
        )}
      </div>

      {/* ── IP Address Map ───────────────────────── */}
      {(ethernetModules.length > 0 || sortedChassis.length > 0) && (
        <div className="io-map__section">
          <div className="io-map__section-header" style={{ borderLeftColor: '#5a6a7e' }}>
            <span className="io-map__section-title">
              <span style={{ fontSize: 16 }}>📋</span>
              IP Address Summary
            </span>
          </div>
          <div className="net__ip-summary">
            <div className="net__ip-row net__ip-row--header">
              <span className="net__ip-addr">{controllerIp}</span>
              <span className="net__ip-name">Controller (PLC)</span>
              <span className="net__ip-type-badge" style={{ background: '#061d39' }}>CPU</span>
            </div>
            {ethernetModules.map(mod => {
              const mapping = NETWORK_DEVICE_MAP[mod.deviceType];
              const rl = RANGE_LABELS[mapping?.rangeKey ?? 'generic'];
              return (
                <div key={mod.id} className="net__ip-row">
                  <span className="net__ip-addr">{mod.ipAddress}</span>
                  <span className="net__ip-name">{mod.name}</span>
                  {mod.station && <span className="io-map__station-badge" style={{ fontSize: 9 }}>{mod.station}</span>}
                  {mod.catalogNumber && <span className="net__catalog" style={{ fontSize: 10 }}>{mod.catalogNumber}</span>}
                  <span className="net__ip-type-badge" style={{ background: rl?.color ?? '#8896a8' }}>{rl?.label ?? mod.deviceType}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

function AddModuleForm({ onAdd, onCancel, subnet }) {
  const [name, setName] = useState('');
  const [ip, setIp] = useState(`${subnet}.`);
  const [catalog, setCatalog] = useState('');
  const [deviceType, setDeviceType] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="net__add-form">
      <div className="net__add-form-title">Add EtherNet/IP Module</div>
      <div className="net__add-form-fields">
        <input className="net__add-input" value={name} onChange={e => setName(e.target.value)} placeholder="Module name (e.g. cam03_S06Inspect)" />
        <input className="net__add-input" value={ip} onChange={e => setIp(e.target.value)} placeholder="IP address" />
        <input className="net__add-input" value={catalog} onChange={e => setCatalog(e.target.value)} placeholder="Catalog # (optional)" />
        <select className="net__add-input" value={deviceType} onChange={e => setDeviceType(e.target.value)}>
          <option value="">Device type...</option>
          <option value="servoDrive">Servo Drive</option>
          <option value="camera">Camera / Vision</option>
          <option value="robot">Robot</option>
          <option value="vfd">VFD / Conveyor</option>
          <option value="ioLink">IO-Link Master</option>
          <option value="hmi">HMI Panel</option>
          <option value="safety">Safety Device</option>
          <option value="generic">Other</option>
        </select>
        <input className="net__add-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" />
      </div>
      <div className="net__add-form-actions">
        <button className="net__add-form-btn net__add-form-btn--save" disabled={!name || !ip}
          onClick={() => onAdd({ name, ipAddress: ip, catalogNumber: catalog, bus: 'ethernet', deviceType, description: desc })}>
          Add Module
        </button>
        <button className="net__add-form-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function AddChassisForm({ onAdd, onCancel, nextSlot }) {
  const [slot, setSlot] = useState(nextSlot);
  const [name, setName] = useState('');
  const [type, setType] = useState('DI');
  const [catalog, setCatalog] = useState('');
  const [desc, setDesc] = useState('');

  return (
    <div className="net__add-form">
      <div className="net__add-form-title">Add Backplane Module</div>
      <div className="net__add-form-fields">
        <input className="net__add-input net__add-input--narrow" type="number" value={slot} onChange={e => setSlot(parseInt(e.target.value) || 0)} placeholder="Slot #" min={0} />
        <select className="net__add-input" value={type} onChange={e => setType(e.target.value)}>
          {CHASSIS_MODULE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <input className="net__add-input" value={name} onChange={e => setName(e.target.value)} placeholder="Name (e.g. DI_1)" />
        <input className="net__add-input" value={catalog} onChange={e => setCatalog(e.target.value)} placeholder="Catalog # (e.g. 5069-IB16/A)" />
        <input className="net__add-input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Description (optional)" />
      </div>
      <div className="net__add-form-actions">
        <button className="net__add-form-btn net__add-form-btn--save"
          onClick={() => onAdd({ slot, name, type, catalogNumber: catalog, description: desc })}>
          Add Module
        </button>
        <button className="net__add-form-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
