export const IO_SECTION_META = {
  digitalInput:  { label: 'Digital Inputs',  abbr: 'DI', color: '#5a9a48' },
  digitalOutput: { label: 'Digital Outputs', abbr: 'DO', color: '#1574C4' },
  analogInput:   { label: 'Analog Inputs',   abbr: 'AI', color: '#0072B5' },
  analogOutput:  { label: 'Analog Outputs',  abbr: 'AO', color: '#E8A317' },
  internal:      { label: 'Internal Tags',   abbr: 'INT', color: '#5a6a7e' },
};

export const IO_ORDER = ['digitalInput', 'digitalOutput', 'analogInput', 'analogOutput', 'internal'];

export const CATEGORY_META = {
  Pneumatic: { label: 'Pneumatic Devices', color: '#1574C4', iconType: 'PneumaticLinearActuator' },
  Servo:     { label: 'Servo Axes',        color: '#061d39', iconType: 'ServoAxis' },
  Robot:     { label: 'Robots',            color: '#1264a8', iconType: 'Robot' },
  Conveyor:  { label: 'Conveyors',         color: '#0072B5', iconType: 'Conveyor' },
  Vision:    { label: 'Vision Systems',    color: '#E8A317', iconType: 'VisionSystem' },
  Sensor:    { label: 'Sensors',           color: '#5a6a7e', iconType: 'DigitalSensor' },
  Logic:     { label: 'Timers & Parameters', color: '#8896a8', iconType: 'Timer' },
  Custom:    { label: 'Custom Devices',    color: '#5a6a7e', iconType: 'Custom' },
};

export const NETWORK_DEVICE_MAP = {
  ServoAxis:      { bus: 'ethernet', rangeKey: 'servoDrive', prefix: 'sd' },
  VisionSystem:   { bus: 'ethernet', rangeKey: 'camera',     prefix: 'cam' },
  Robot:          { bus: 'ethernet', rangeKey: 'robot',      prefix: 'r' },
  Conveyor:       { bus: 'ethernet', rangeKey: 'vfd',        prefix: 'fd' },
};

export const ETHERNET_DEVICE_TYPES = new Set(Object.keys(NETWORK_DEVICE_MAP));

export const CHASSIS_MODULE_TYPES = [
  { value: 'DI',       label: 'Digital Input',        color: '#5a9a48' },
  { value: 'DO',       label: 'Digital Output',       color: '#1574C4' },
  { value: 'DI_SAFE',  label: 'Safety Digital Input',  color: '#5a9a48' },
  { value: 'DO_SAFE',  label: 'Safety Digital Output',  color: '#1574C4' },
  { value: 'AI',       label: 'Analog Input',          color: '#0072B5' },
  { value: 'AO',       label: 'Analog Output',         color: '#E8A317' },
  { value: 'TC',       label: 'Thermocouple',          color: '#E8A317' },
  { value: 'RTD',      label: 'RTD',                   color: '#E8A317' },
  { value: 'SERIAL',   label: 'Serial Comm',           color: '#5a6a7e' },
  { value: 'OTHER',    label: 'Other',                 color: '#8896a8' },
];

export const CHASSIS_TYPE_META = {};
for (const t of CHASSIS_MODULE_TYPES) CHASSIS_TYPE_META[t.value] = t;

export const BUS_META = {
  ethernet:  { label: 'EtherNet/IP', color: '#1574C4', icon: '🌐' },
  iolink:    { label: 'IO-Link',     color: '#0072B5', icon: '🔗' },
  backplane: { label: 'Backplane',   color: '#061d39', icon: '📦' },
};

export const RANGE_LABELS = {
  servoDrive: { label: 'Servo Drives', icon: 'ServoAxis', color: '#061d39' },
  camera: { label: 'Vision / Cameras', icon: 'VisionSystem', color: '#E8A317' },
  robot: { label: 'Robots', icon: 'Robot', color: '#1264a8' },
  vfd: { label: 'VFDs / Conveyors', icon: 'Conveyor', color: '#0072B5' },
  ioLink: { label: 'IO-Link Masters', icon: 'DigitalSensor', color: '#0072B5' },
  hmi: { label: 'HMI Panels', icon: 'Parameter', color: '#5a6a7e' },
  safety: { label: 'Safety Devices', icon: 'DigitalSensor', color: '#dc2626' },
  generic: { label: 'Other Devices', icon: 'Custom', color: '#8896a8' },
};
