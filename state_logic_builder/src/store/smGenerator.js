/**
 * SDC State Logic Builder - SM Generators
 * Extracted generation logic to improve store modularity.
 */

import { uid, _getSmArray, _updateProject } from './storeHelpers.js';

/**
 * Auto-generate a Dial_Indexer SM for indexing dial machines.
 * Creates: servo device, 3 states (Wait All Ready → Index → Cycle Complete),
 * and an "AllStationsReady" condition signal.
 */
export function autoGenerateIndexerSM(get, set) {
  const state = get();
  const mc = state.project?.machineConfig ?? {};
  const nestCount = mc.nestCount ?? mc.stations?.length ?? 12;

  const existing = _getSmArray(state).find(sm =>
    sm.name === 'Dial_Indexer' || sm.name === 'DialIndexer' || sm.name === 'Indexer'
  );
  if (existing) return existing.id;

  get()._pushHistory();

  const smId = uid();
  const machineType = mc.machineType ?? 'indexing';
  const smName = machineType === 'indexing' ? 'Dial_Indexer' : 'Indexer';
  const sm = {
    id: smId,
    name: smName,
    displayName: smName,
    stationNumber: 99,
    description: 'Auto-generated indexer — waits for all stations ready, then indexes.',
    devices: [],
    nodes: [],
    edges: [],
    smOutputs: [],
  };

  const deviceId = uid();
  const indexAngle = Math.round((360 / nestCount) * 10000) / 10000;
  const device = {
    id: deviceId,
    type: 'ServoAxis',
    displayName: smName,
    name: smName.replace(/[^a-zA-Z0-9]/g, ''),
    tagStem: smName.replace(/[^a-zA-Z0-9]/g, ''),
    axisNumber: 1,
    motionType: machineType === 'indexing' ? 'rotary' : 'linear',
    positions: [{
      name: 'Index',
      type: 'index',
      moveType: 'Idx',
      defaultValue: indexAngle,
      heads: nestCount,
      isHome: false,
      isRecipe: false,
    }],
    speedProfiles: [
      { name: 'Slow', speed: 100, accel: 1000, decel: 1000 },
      { name: 'Fast', speed: 2500, accel: 25000, decel: 25000 },
    ],
    sensorArrangement: 'none',
  };
  sm.devices.push(device);

  const nodeX = 400;
  const decisionNodeId = uid();
  const indexNodeId = uid();
  const completeNodeId = uid();

  sm.nodes.push({
    id: decisionNodeId,
    type: 'decisionNode',
    position: { x: nodeX, y: 100 },
    data: {
      label: 'Wait All Ready',
      decisionType: 'signal',
      signalName: 'AllStationsReady',
      signalSource: 'All Stations',
      signalType: 'condition',
      exitCount: 1,
      exit1Label: 'Ready',
      autoOpenPopup: false,
      conditions: [{
        signalName: 'AllStationsReady',
        signalSource: 'All Stations',
        signalType: 'condition',
        sensorState: 'on',
      }],
      conditionLogic: 'AND',
    },
  });

  sm.nodes.push({
    id: indexNodeId,
    type: 'stateNode',
    position: { x: nodeX, y: 340 },
    data: {
      stepNumber: 1,
      label: 'Index',
      actions: [{
        id: uid(),
        deviceId: deviceId,
        operation: 'ServoIndex',
        positionName: 'Index',
        indexAngle: indexAngle,
        indexStations: 1,
      }],
      isInitial: false,
    },
  });

  sm.nodes.push({
    id: completeNodeId,
    type: 'stateNode',
    position: { x: nodeX, y: 580 },
    data: {
      stepNumber: 2,
      label: 'Cycle Complete',
      actions: [],
      isInitial: false,
      isComplete: true,
    },
  });

  sm.edges.push({
    id: uid(),
    source: decisionNodeId,
    sourceHandle: 'exit-single',
    target: indexNodeId,
    targetHandle: null,
    type: 'routableEdge',
    animated: false,
    data: { conditionType: 'ready' },
  });

  sm.edges.push({
    id: uid(),
    source: indexNodeId,
    sourceHandle: null,
    target: completeNodeId,
    targetHandle: null,
    type: 'routableEdge',
    animated: false,
    style: { stroke: '#6b7280', strokeWidth: 2 },
    markerEnd: { type: 'ArrowClosed', color: '#6b7280' },
    label: 'Index Complete',
    labelStyle: { fill: '#374151', fontWeight: 500, fontSize: 9, fontFamily: 'Consolas, Menlo, Monaco, monospace' },
    labelBgStyle: { fill: '#f9fafb', fillOpacity: 0.95 },
    data: { conditionType: 'servoAtTarget', label: 'Index Complete', deviceId: deviceId },
  });

  set(s => ({
    project: {
      ...s.project,
      stateMachines: [...s.project.stateMachines, sm],
    },
  }));

  const signals = get().project?.signals ?? [];
  if (!signals.find(s => s.name === 'AllStationsReady')) {
    get().addSignal({
      name: 'AllStationsReady',
      description: 'TRUE when all station SMs are at Cycle Complete — used by Dial Indexer.',
      type: 'condition',
      builtIn: true,
    });
  }

  return smId;
}

/**
 * Batch-generate state machines from an array of station generation configs.
 */
export function batchGenerateStateMachines(get, set, configs) {
  if (!configs || configs.length === 0) return [];
  get()._pushHistory();

  const allSMs = _getSmArray(get());
  const createdSMs = [];
  const newSmIds = []; 

  for (const cfg of configs) {
    const safeName = (cfg.stationName ?? 'Station').replace(/[^a-zA-Z0-9_]/g, '');
    const displayName = cfg.stationName ?? 'Station';

    if (cfg.copyFromSmId) {
      const source = [...allSMs, ...createdSMs].find(sm => sm.id === cfg.copyFromSmId);
      if (!source) continue;

      const deviceIdMap = {};
      const nodeIdMap = {};
      const usedNames = new Set();
      for (const sm of [...allSMs, ...createdSMs]) {
        for (const d of (sm.devices ?? [])) usedNames.add(d.name);
      }

      const newDevices = (source.devices ?? []).map(dev => {
        const newId = uid();
        deviceIdMap[dev.id] = newId;
        let newName = dev.name;
        if (usedNames.has(newName)) {
          let n = 2;
          while (usedNames.has(`${dev.name}${n}`)) n++;
          newName = `${dev.name}${n}`;
        }
        usedNames.add(newName);
        return { ...JSON.parse(JSON.stringify(dev)), id: newId, name: newName, displayName: dev.displayName ?? dev.name };
      });

      const newNodes = (source.nodes ?? []).map(node => {
        const newId = uid();
        nodeIdMap[node.id] = newId;
        const newData = JSON.parse(JSON.stringify(node.data ?? {}));
        if (newData.actions) {
          newData.actions = newData.actions.map(a => ({
            ...a,
            deviceId: a.deviceId === '_tracking' ? '_tracking' : (deviceIdMap[a.deviceId] ?? a.deviceId),
          }));
        }
        return { ...node, id: newId, data: newData, selected: false };
      });

      const newEdges = (source.edges ?? []).map(edge => {
        const ne = JSON.parse(JSON.stringify(edge));
        ne.id = uid();
        ne.source = nodeIdMap[edge.source] ?? edge.source;
        ne.target = nodeIdMap[edge.target] ?? edge.target;
        if (ne.data?.deviceId) ne.data.deviceId = deviceIdMap[ne.data.deviceId] ?? ne.data.deviceId;
        ne.selected = false;
        return ne;
      });

      for (const dev of newDevices) {
        if (dev._sourceNodeId) dev._sourceNodeId = nodeIdMap[dev._sourceNodeId] ?? dev._sourceNodeId;
      }

      const newOutputs = (source.smOutputs ?? []).map(out => ({
        ...JSON.parse(JSON.stringify(out)),
        id: uid(),
        activeNodeId: out.activeNodeId ? (nodeIdMap[out.activeNodeId] ?? out.activeNodeId) : null,
      }));

      const smId = uid();
      createdSMs.push({
        id: smId,
        name: safeName,
        displayName,
        stationNumber: cfg.stationNumber ?? 1,
        description: `Copy of ${source.displayName ?? source.name}`,
        devices: newDevices,
        nodes: newNodes,
        edges: newEdges,
        smOutputs: newOutputs,
      });
      newSmIds.push({ stationId: cfg.stationId, smId });
      continue;
    }

    const smId = uid();
    const sm = {
      id: smId,
      name: safeName,
      displayName,
      stationNumber: cfg.stationNumber ?? 1,
      description: '',
      devices: [],
      nodes: [],
      edges: [],
      smOutputs: [],
    };

    const nodeX = 400;
    let nodeY = 100;
    const yStep = 180;
    const nodeList = []; 
    const seqEnabled = cfg.generateSequence !== false;

    const mkState = (label, opts = {}) => {
      const nid = uid();
      sm.nodes.push({
        id: nid,
        type: 'stateNode',
        position: { x: nodeX, y: nodeY },
        data: {
          stepNumber: 0,
          label,
          actions: opts.actions ?? [],
          isInitial: opts.isInitial ?? false,
          isComplete: opts.isComplete ?? false,
        },
      });
      nodeList.push({ id: nid, type: 'stateNode' });
      nodeY += yStep;
      return nid;
    };

    const mkEdge = (srcId, tgtId, label, extraData = {}) => {
      sm.edges.push({
        id: uid(),
        source: srcId,
        sourceHandle: extraData.sourceHandle ?? null,
        target: tgtId,
        targetHandle: null,
        type: 'routableEdge',
        animated: false,
        style: extraData.style ?? { stroke: '#6b7280', strokeWidth: 2 },
        markerEnd: extraData.markerEnd ?? { type: 'ArrowClosed', color: '#6b7280' },
        label: label ?? '',
        labelStyle: { fill: '#374151', fontWeight: 500, fontSize: 9, fontFamily: 'Consolas, Menlo, Monaco, monospace' },
        labelBgStyle: { fill: '#f9fafb', fillOpacity: 0.95 },
        data: { conditionType: extraData.conditionType ?? 'always', label: label ?? '', ...extraData.data },
      });
    };

    const machineType = get().project?.machineConfig?.machineType ?? 'indexing';
    const homeNodeId = mkState('Home', { isInitial: true });

    if (machineType === 'indexing' && seqEnabled) {
      const waitId = uid();
      sm.nodes.push({
        id: waitId,
        type: 'decisionNode',
        position: { x: nodeX, y: nodeY },
        data: {
          decisionType: 'signal',
          signalName: 'IndexComplete',
          signalSource: 'Dial_Indexer',
          signalSmName: 'Dial_Indexer',
          signalType: 'state',
          exitCount: 1,
          exit1Label: 'Ready',
          stateNumber: 0,
        },
      });
      nodeList.push({ id: waitId, type: 'decisionNode' });
      nodeY += yStep;
    }

    if ((cfg.stationType === 'load' || cfg.stationType === 'unload') && cfg.axes && cfg.axes.length > 0) {
      const axisDevices = []; 
      let axisNum = 1;
      for (const axis of cfg.axes) {
        const devId = uid();
        const axLabel = axis.label || `A${axisNum}`;
        const devName = `${safeName}${axLabel}`;
        const devDisplay = `${displayName} ${axLabel}`;

        if (axis.type === 'pneumatic') {
          const pLbl = axLabel.toLowerCase();
          const isVertPneu = pLbl === 'z' || pLbl.includes('vert');
          const devObj = {
            id: devId, type: 'PneumaticLinearActuator',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sensorArrangement: isVertPneu ? '1-sensor (Ret only)' : '2-sensor (Ext + Ret)',
          };
          if (isVertPneu) {
            devObj.extendDelayMs = 1000;
          }
          sm.devices.push(devObj);
          axisDevices.push({
            devId, label: axLabel, type: 'pneumatic',
            extOp: 'Extend', retOp: 'Retract', extExtra: {}, retExtra: {},
          });
        } else if (axis.type === 'servo') {
          const lbl = axLabel.toLowerCase();
          const isVertical = lbl === 'z' || lbl.includes('vert');
          const isHorizontal = lbl === 'x' || lbl.includes('horiz');
          let positions, extPos, retPos;
          if (isVertical) {
            positions = [
              { name: 'Pick', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
              { name: 'Place', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
              { name: 'Retract', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: true, isRecipe: false },
            ];
            extPos = 'Pick'; retPos = 'Retract';
          } else if (isHorizontal) {
            positions = [
              { name: 'Pick', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: true, isRecipe: false },
              { name: 'Place', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
            ];
            extPos = 'Place'; retPos = 'Pick';
          } else {
            positions = [
              { name: 'Home', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: true, isRecipe: false },
              { name: 'Work', type: 'absolute', moveType: 'Pos', defaultValue: 0, isHome: false, isRecipe: false },
            ];
            extPos = 'Work'; retPos = 'Home';
          }
          sm.devices.push({
            id: devId, type: 'ServoAxis',
            name: devName, displayName: devDisplay,
            tagStem: devName, axisNumber: axisNum, motionType: 'linear',
            positions,
            speedProfiles: [{ name: 'Fast', speed: 0, accel: 0, decel: 0 }],
            sensorArrangement: 'none',
          });
          axisDevices.push({
            devId, label: axLabel, type: 'servo',
            extOp: 'ServoMove', retOp: 'ServoMove',
            extExtra: { positionName: extPos }, retExtra: { positionName: retPos },
          });
        } else if (axis.type === 'gripper') {
          sm.devices.push({
            id: devId, type: 'PneumaticGripper',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sensorArrangement: 'No sensors',
            engageDelayMs: 250,
            disengageDelayMs: 250,
          });
          axisDevices.push({
            devId, label: axLabel, type: 'gripper',
            extOp: 'Engage', retOp: 'Disengage', extExtra: {}, retExtra: {},
          });
        } else if (axis.type === 'vacuum') {
          sm.devices.push({
            id: devId, type: 'PneumaticVacGenerator',
            name: devName, displayName: devDisplay,
            tagStem: devName,
          });
          axisDevices.push({
            devId, label: axLabel, type: 'vacuum',
            extOp: 'VacOn', retOp: 'VacOff', extExtra: {}, retExtra: {},
          });
        } else if (axis.type === 'sensor') {
          sm.devices.push({
            id: devId, type: 'DigitalSensor',
            name: devName, displayName: devDisplay,
            tagStem: devName,
          });
          axisDevices.push({
            devId, label: axLabel, type: 'sensor',
            extOp: 'Verify', retOp: null, extExtra: {}, retExtra: {},
          });
        } else if (axis.type === 'rotary') {
          sm.devices.push({
            id: devId, type: 'PneumaticRotaryActuator',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sensorArrangement: '2-sensor (Ext + Ret)',
          });
          axisDevices.push({
            devId, label: axLabel, type: 'rotary',
            extOp: 'Extend', retOp: 'Retract', extExtra: {}, retExtra: {},
          });
        } else if (axis.type === 'analog') {
          sm.devices.push({
            id: devId, type: 'AnalogSensor',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sensorUnit: 'mm',
            setpoints: [{ id: uid(), name: 'Test', nominal: 10.0, tolerance: 1.0 }],
          });
          axisDevices.push({
            devId, label: axLabel, type: 'analog',
            extOp: 'CheckRange', retOp: null, extExtra: { setpointName: 'Test' }, retExtra: {},
          });
        } else if (axis.type === 'vision') {
          const jobName = `${axLabel}_Inspect`;
          sm.devices.push({
            id: devId, type: 'VisionSystem',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            jobs: [{ id: uid(), name: jobName, outcomes: ['Pass', 'Fail'], numericOutputs: [] }],
          });
          axisDevices.push({
            devId, label: axLabel, type: 'vision',
            extOp: 'VisionInspect', retOp: null,
            extExtra: { jobName, ptFieldName: jobName, outcomes: [{ id: uid(), label: 'Pass' }, { id: uid(), label: 'Fail' }] },
            retExtra: {},
          });
        } else if (axis.type === 'robot') {
          sm.devices.push({
            id: devId, type: 'Robot',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sequences: [
              { id: uid(), number: 1, name: 'Home',  description: 'Move to home / perch position' },
              { id: uid(), number: 2, name: 'Pick',  description: 'Pick part from nest' },
              { id: uid(), number: 3, name: 'Place', description: 'Place part at target' },
            ],
            signals: [
              { id: uid(), number: 1, name: 'OkToEnterDial', group: 'DI', direction: 'output', dataType: 'BOOL' },
              { id: uid(), number: 1, name: 'PartGrip',      group: 'DO', direction: 'input',  dataType: 'BOOL' },
            ],
          });
          axisDevices.push({
            devId, label: axLabel, type: 'robot',
            extOp: 'RunSequence', retOp: null,
            extExtra: { sequenceNumber: 2, sequenceName: 'Pick' },
            retExtra: {},
          });
        } else if (axis.type === 'conveyor') {
          sm.devices.push({
            id: devId, type: 'Conveyor',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            driveType: 'VFD',
            bidirectional: false,
            hasSpeedControl: true,
          });
          axisDevices.push({
            devId, label: axLabel, type: 'conveyor',
            extOp: 'Run', retOp: 'Stop', extExtra: {}, retExtra: {},
          });
        } else if (axis.type === 'timer') {
          sm.devices.push({
            id: devId, type: 'Timer',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            timerMs: 1000,
          });
          axisDevices.push({
            devId, label: axLabel, type: 'timer',
            extOp: 'Wait', retOp: null, extExtra: {}, retExtra: {},
          });
        }
        axisNum++;
      }

      const motionAxes = axisDevices.filter(a => a.type === 'pneumatic' || a.type === 'servo');
      const gripAxes = axisDevices.filter(a => a.type === 'gripper' || a.type === 'vacuum');
      const sensorAxes = axisDevices.filter(a => a.type === 'sensor');

      const homeActions = [];
      for (const ax of axisDevices) {
        if (ax.type === 'pneumatic') {
          homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'Retract' });
        } else if (ax.type === 'servo') {
          homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'ServoMove', ...ax.retExtra });
        } else if (ax.type === 'gripper') {
          homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'Disengage' });
        } else if (ax.type === 'vacuum') {
          homeActions.push({ id: uid(), deviceId: ax.devId, operation: 'VacOff' });
        }
      }
      const homeNode = sm.nodes.find(n => n.id === homeNodeId);
      if (homeNode) homeNode.data.actions = homeActions;

      if (seqEnabled && motionAxes.length >= 2) {
        let zIdx = motionAxes.findIndex(a => /^z$/i.test(a.label) || /vert/i.test(a.label));
        let xIdx = motionAxes.findIndex(a => /^x$/i.test(a.label) || /horiz/i.test(a.label));
        if (zIdx === -1) zIdx = 1; 
        if (xIdx === -1) xIdx = 0; 
        const xAxis = motionAxes[xIdx];
        const zAxis = motionAxes[zIdx];
        const midAxes = motionAxes.filter((_, i) => i !== xIdx && i !== zIdx);
        const grip = gripAxes.length > 0 ? gripAxes[0] : null;

        const zPickDown = zAxis.type === 'servo' ? { positionName: 'Pick' } : {};
        const zPlaceDown = zAxis.type === 'servo' ? { positionName: 'Place' } : {};
        const zRetract = zAxis.type === 'servo' ? { positionName: 'Retract' } : {};
        const zDownOp = zAxis.extOp;
        const zRetOp = zAxis.retOp;

        mkState(`${zAxis.label} to Pick`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zDownOp, ...zPickDown }] });
        if (grip) {
          mkState(`${grip.label} Engage`, { actions: [{ id: uid(), deviceId: grip.devId, operation: grip.extOp, ...grip.extExtra }] });
        }
        for (const mid of midAxes) {
          mkState(`${mid.label} Extend`, { actions: [{ id: uid(), deviceId: mid.devId, operation: mid.extOp, ...mid.extExtra }] });
        }
        mkState(`${zAxis.label} Retract`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zRetOp, ...zRetract }] });
        mkState(`${xAxis.label} to Place`, { actions: [{ id: uid(), deviceId: xAxis.devId, operation: xAxis.extOp, ...xAxis.extExtra }] });
        mkState(`${zAxis.label} to Place`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zDownOp, ...zPlaceDown }] });
        if (grip) {
          mkState(`${grip.label} Release`, { actions: [{ id: uid(), deviceId: grip.devId, operation: grip.retOp, ...grip.retExtra }] });
        }
        for (const mid of [...midAxes].reverse()) {
          mkState(`${mid.label} Retract`, { actions: [{ id: uid(), deviceId: mid.devId, operation: mid.retOp, ...mid.retExtra }] });
        }
        mkState(`${zAxis.label} Retract (2)`, { actions: [{ id: uid(), deviceId: zAxis.devId, operation: zRetOp, ...zRetract }] });
        mkState(`${xAxis.label} to Pick`, { actions: [{ id: uid(), deviceId: xAxis.devId, operation: xAxis.retOp, ...xAxis.retExtra }] });
      } else if (seqEnabled) {
        for (const ax of axisDevices) {
          if (ax.extOp) {
            mkState(`${ax.label} Extend`, { actions: [{ id: uid(), deviceId: ax.devId, operation: ax.extOp, ...ax.extExtra }] });
          }
        }
        for (const ax of [...axisDevices].reverse()) {
          if (ax.retOp) {
            mkState(`${ax.label} Retract`, { actions: [{ id: uid(), deviceId: ax.devId, operation: ax.retOp, ...ax.retExtra }] });
          }
        }
      }

      if (seqEnabled) {
        for (const sen of sensorAxes) {
          mkState(`Check ${sen.label}`, { actions: [{ id: uid(), deviceId: sen.devId, operation: sen.extOp }] });
        }
      }

    } else if (cfg.stationType === 'verify') {
      if (cfg.verifyType === 'vision') {
        const devId = uid();
        const jobName = `${displayName}_Inspect`;
        sm.devices.push({
          id: devId, type: 'VisionSystem',
          name: `${safeName}Cam`, displayName: `${displayName} Camera`,
          tagStem: `${safeName}Cam`,
          jobs: [{ id: uid(), name: jobName, outcomes: ['Pass', 'Fail'], numericOutputs: [] }],
        });
        if (seqEnabled) {
          mkState('Vision Inspect', { actions: [{ id: uid(), deviceId: devId, operation: 'VisionInspect', jobName, ptFieldName: jobName, outcomes: [{ id: uid(), label: 'Pass' }, { id: uid(), label: 'Fail' }] }] });
        }
      } else if (cfg.verifyType === 'sensor') {
        const devId = uid();
        sm.devices.push({
          id: devId, type: 'DigitalSensor',
          name: `${safeName}Sensor`, displayName: `${displayName} Sensor`,
          tagStem: `${safeName}Sensor`,
        });
        if (seqEnabled) {
          mkState('Check Sensor', { actions: [{ id: uid(), deviceId: devId, operation: 'Verify' }] });
        }
      } else if (cfg.verifyType === 'mechanical') {
        const devId = uid();
        sm.devices.push({
          id: devId, type: 'PneumaticLinearActuator',
          name: `${safeName}Probe`, displayName: `${displayName} Probe`,
          tagStem: `${safeName}Probe`,
          sensorArrangement: '2-sensor (Ext + Ret)',
        });
        if (seqEnabled) {
          mkState('Extend Probe', { actions: [{ id: uid(), deviceId: devId, operation: 'Extend' }] });
          mkState('Retract Probe', { actions: [{ id: uid(), deviceId: devId, operation: 'Retract' }] });
        }
      }
    } else if ((cfg.stationType === 'process' || cfg.stationType === 'reject' || cfg.stationType === 'unload') && cfg.axes && cfg.axes.length > 0) {
      if ((cfg.stationType === 'reject' || cfg.stationType === 'unload') && seqEnabled) {
        const gateId = uid();
        const gateLabel = cfg.stationType === 'reject' ? 'Run if Rejected' : 'Run if Good Part';
        sm.nodes.push({
          id: gateId,
          type: 'decisionNode',
          position: { x: nodeX, y: nodeY },
          data: {
            decisionType: 'signal',
            signalName: gateLabel,
            signalSource: 'Part Results',
            signalSmName: null,
            signalType: 'partResult',
            exitCount: 1,
            exit1Label: cfg.stationType === 'reject' ? 'Reject' : 'Good',
            stateNumber: 0,
            autoOpenPopup: true,
          },
        });
        nodeList.push({ id: gateId, type: 'decisionNode' });
        nodeY += yStep;
      }
      let axisNum = 1;
      for (const axis of cfg.axes) {
        const devId = uid();
        const axLabel = axis.label || `A${axisNum}`;
        const devName = `${safeName}${axLabel}`;
        const devDisplay = `${displayName} ${axLabel}`;

        if (axis.type === 'pneumatic') {
          sm.devices.push({
            id: devId, type: 'PneumaticLinearActuator',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sensorArrangement: '2-sensor (Ext + Ret)',
          });
        } else if (axis.type === 'servo') {
          sm.devices.push({
            id: devId, type: 'ServoAxis',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            positions: [
              { name: 'Home', defaultValue: 0, moveType: 'Pos', isHome: true },
              { name: 'Work', defaultValue: 0, moveType: 'Pos' },
            ],
          });
        } else if (axis.type === 'gripper') {
          sm.devices.push({
            id: devId, type: 'PneumaticGripper',
            name: devName, displayName: devDisplay,
            tagStem: devName,
            sensorArrangement: 'No sensors (timer only)',
            extendDelay: 250, retractDelay: 250,
          });
        } else if (axis.type === 'vacuum') {
          sm.devices.push({
            id: devId, type: 'PneumaticVacGenerator',
            name: devName, displayName: devDisplay,
            tagStem: devName,
          });
        } else if (axis.type === 'sensor') {
          sm.devices.push({
            id: devId, type: 'DigitalSensor',
            name: devName, displayName: devDisplay,
            tagStem: devName,
          });
        }
        axisNum++;
      }
      if (seqEnabled) {
        const processLabel = cfg.stationType === 'reject' ? 'Reject' :
                             cfg.stationType === 'unload' ? 'Unload' : 'Process';
        mkState(processLabel, {});
      }
    }

    mkState('Cycle Complete', { isComplete: true });

    for (let i = 0; i < nodeList.length - 1; i++) {
      const src = nodeList[i];
      const tgt = nodeList[i + 1];
      if (src.type === 'decisionNode') {
        mkEdge(src.id, tgt.id, 'Ready', {
          sourceHandle: 'exit-single',
          conditionType: 'ready',
          style: { stroke: '#16a34a', strokeWidth: 2 },
          data: { isDecisionExit: true, exitColor: 'pass', outcomeLabel: 'Ready' },
        });
      } else {
        mkEdge(src.id, tgt.id, '');
      }
    }

    createdSMs.push(sm);
    newSmIds.push({ stationId: cfg.stationId, smId });
  }

  set(s => {
    const allSms = [...(s.project.stateMachines ?? []), ...createdSMs];
    allSms.sort((a, b) => (a.stationNumber ?? 999) - (b.stationNumber ?? 999));
    return {
      project: {
        ...s.project,
        stateMachines: allSms,
      },
    };
  });

  for (const { stationId, smId } of newSmIds) {
    if (stationId) {
      set(s => {
        const mc = { ...(s.project.machineConfig ?? { stations: [] }) };
        mc.stations = (mc.stations ?? []).map(st => {
          if (st.id !== stationId) return st;
          const smIds = [...(st.smIds ?? [])];
          if (!smIds.includes(smId)) smIds.push(smId);
          return { ...st, smIds };
        });
        return { project: { ...s.project, machineConfig: mc } };
      });
    }
  }

  return newSmIds.map(x => x.smId);
}
