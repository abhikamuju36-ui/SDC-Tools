import { getDeviceTags, buildProgramName } from '../lib/tagNaming.js';
import { DEVICE_TYPES } from '../lib/deviceTypes.js';
import { IO_ORDER, NETWORK_DEVICE_MAP } from './IOMapConstants.js';

export function classifyTag(tag) {
  const u = tag.usage;
  const dt = tag.dataType;
  if (u === 'Input' && (dt === 'REAL' || dt === 'INT' || dt === 'DINT')) return 'analogInput';
  if (u === 'Input') return 'digitalInput';
  if (u === 'Output' && (dt === 'REAL' || dt === 'INT' || dt === 'DINT')) return 'analogOutput';
  if (u === 'Output') return 'digitalOutput';
  return 'internal';
}

export function buildAll(project) {
  const sms = project?.stateMachines ?? [];
  const deviceList = [];
  const ioSections = {};
  for (const key of IO_ORDER) ioSections[key] = [];

  for (const sm of sms) {
    const stationLabel = `S${String(sm.stationNumber ?? 0).padStart(2, '0')}`;
    const programName = buildProgramName(sm.stationNumber ?? 0, sm.name ?? 'Unknown');
    const smName = sm.displayName ?? sm.name ?? '';
    const devices = (sm.devices ?? []).filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId);

    for (const device of devices) {
      const typeInfo = DEVICE_TYPES[device.type];
      const tags = getDeviceTags(device);

      let di = 0, dout = 0, ai = 0, ao = 0;
      for (const tag of tags) {
        const cls = classifyTag(tag);
        if (cls === 'digitalInput') di++;
        else if (cls === 'digitalOutput') dout++;
        else if (cls === 'analogInput') ai++;
        else if (cls === 'analogOutput') ao++;
      }

      deviceList.push({
        id: device.id,
        name: device.displayName ?? device.name,
        type: device.type,
        typeLabel: typeInfo?.label ?? device.type,
        category: typeInfo?.category ?? 'Custom',
        station: stationLabel,
        smName,
        program: programName,
        smId: sm.id,
        sensorArrangement: device.sensorArrangement ?? '',
        io: { di, do: dout, ai, ao },
      });

      for (const tag of tags) {
        const section = classifyTag(tag);
        ioSections[section].push({
          tagName: tag.name,
          dataType: tag.dataType,
          description: tag.description,
          deviceName: device.displayName ?? device.name,
          deviceType: typeInfo?.label ?? device.type,
          station: stationLabel,
          program: programName,
          smId: sm.id,
          deviceId: device.id,
          usage: tag.usage,
          preMs: tag.preMs,
        });
      }
    }
  }

  for (const key of IO_ORDER) {
    ioSections[key].sort((a, b) => {
      if (a.station !== b.station) return a.station.localeCompare(b.station);
      return a.tagName.localeCompare(b.tagName);
    });
  }

  deviceList.sort((a, b) => {
    if (a.station !== b.station) return a.station.localeCompare(b.station);
    return a.name.localeCompare(b.name);
  });

  const IO_CATEGORIES = {
    Pneumatic: ['PneumaticLinearActuator', 'PneumaticRotaryActuator', 'PneumaticGripper', 'PneumaticVacGenerator'],
    Servo:     ['ServoAxis'],
    Robot:     ['Robot'],
    Conveyor:  ['Conveyor'],
    Vision:    ['VisionSystem'],
    Sensor:    ['DigitalSensor', 'AnalogSensor'],
    Logic:     ['Timer', 'Parameter'],
    Custom:    ['Custom'],
  };
  const devicesByCategory = {};
  for (const [cat, types] of Object.entries(IO_CATEGORIES)) {
    const devs = deviceList.filter(d => types.includes(d.type));
    if (devs.length > 0) devicesByCategory[cat] = devs;
  }
  const allGroupedTypes = Object.values(IO_CATEGORIES).flat();
  const ungrouped = deviceList.filter(d => !allGroupedTypes.includes(d.type));
  if (ungrouped.length > 0) devicesByCategory['Custom'] = [...(devicesByCategory['Custom'] ?? []), ...ungrouped];

  return { deviceList, devicesByCategory, ioSections };
}

export function buildNetworkDevices(project) {
  const sms = project?.stateMachines ?? [];
  const netCfg = project?.networkConfig ?? {};
  const subnet = netCfg.subnet || '10.1.60';
  const ranges = netCfg.ipRanges ?? {};
  const manualModules = netCfg.modules ?? [];
  const chassis = netCfg.chassis ?? [];

  const discovered = [];
  const counterByRange = {};

  for (const sm of sms) {
    const stationLabel = `S${String(sm.stationNumber ?? 0).padStart(2, '0')}`;
    const devices = (sm.devices ?? []).filter(d => !d._autoVerify && !d._autoVision && !d.crossSmId);

    for (const device of devices) {
      const mapping = NETWORK_DEVICE_MAP[device.type];
      if (!mapping) continue;

      const rangeKey = mapping.rangeKey;
      const range = ranges[rangeKey] ?? { start: 90, prefix: mapping.prefix };
      if (!counterByRange[rangeKey]) counterByRange[rangeKey] = 0;
      counterByRange[rangeKey]++;
      const offset = range.start + counterByRange[rangeKey] - 1;
      const autoIp = `${subnet}.${offset}`;
      const autoName = `${range.prefix}${String(counterByRange[rangeKey]).padStart(2, '0')}_${device.name}`;

      const manual = manualModules.find(m => m.linkedDeviceId === device.id);

      discovered.push({
        id: manual?.id ?? `auto_${device.id}`,
        linkedDeviceId: device.id,
        name: manual?.name || autoName,
        catalogNumber: manual?.catalogNumber || '',
        ipAddress: manual?.ipAddress || autoIp,
        bus: manual?.bus || mapping.bus,
        parentModule: manual?.parentModule || 'Local',
        station: stationLabel,
        smName: sm.displayName ?? sm.name ?? '',
        deviceType: device.type,
        deviceName: device.displayName ?? device.name,
        description: manual?.description || '',
        rpiUs: manual?.rpiUs ?? 10000,
        isManual: !!manual,
        isAuto: true,
      });
    }
  }

  const linkedIds = new Set(discovered.map(d => d.linkedDeviceId));
  const manualOnly = manualModules
    .filter(m => !m.linkedDeviceId || !linkedIds.has(m.linkedDeviceId))
    .map(m => ({
      ...m,
      isManual: true,
      isAuto: false,
      station: m.station || '',
      smName: '',
      deviceName: m.deviceType || '',
    }));

  const allModules = [...discovered, ...manualOnly];

  allModules.sort((a, b) => {
    if (a.bus !== b.bus) return (a.bus === 'ethernet' ? 0 : 1) - (b.bus === 'ethernet' ? 0 : 1);
    return (a.ipAddress || '').localeCompare(b.ipAddress || '', undefined, { numeric: true });
  });

  const sortedChassis = [...chassis].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0));

  return { allModules, sortedChassis, subnet, controllerIp: netCfg.controllerIp || `${subnet}.10` };
}

export function _saveModField(store, netCfg, mod, field, value) {
  const modules = netCfg.modules ?? [];
  const existing = modules.find(m => m.id === mod.id);
  if (existing) {
    store().updateNetworkModule(mod.id, { [field]: value });
  } else {
    store().addNetworkModule({
      linkedDeviceId: mod.linkedDeviceId,
      name: mod.name,
      catalogNumber: mod.catalogNumber,
      ipAddress: mod.ipAddress,
      bus: mod.bus,
      parentModule: mod.parentModule,
      station: mod.station,
      deviceType: mod.deviceType,
      description: mod.description,
      rpiUs: mod.rpiUs,
      [field]: value,
    });
  }
}
