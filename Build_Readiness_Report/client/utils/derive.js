// Part-line generator + vendor aggregator — derived data

window.generatePartLines = function(assembly, jobId) {
  // Generate plausible part lines for an assembly based on its ready/total/noPo counts
  const seed = (assembly.name + jobId).split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const rand = (n) => { const x = Math.sin(seed + n) * 10000; return x - Math.floor(x); };

  const vendors = [
    "McMaster-Carr", "Mueller Industries", "Honeycomb 3D LLC", "G2V Optics",
    "H. H. Barnum", "Johnstone Supply", "Heatcraft Refrigeration",
    "SMC Pneumatics", "Allied Electronics", "Fastenal",
  ];
  const partWords = [
    ["BAFFLE", "SEAL"], ["MOUNT", "BRACKET"], ["TUBING", "ASSY"],
    ["VALVE", "BODY"], ["SENSOR", "TEMP"], ["GASKET", "EPDM"],
    ["FITTING", "NPT"], ["WIRE", "HARNESS"], ["BOLT", "SHCS"],
    ["PANEL", "PERF"], ["COIL", "EVAP"], ["CABLE", "USB"],
  ];

  const lines = [];
  const total = Math.min(assembly.total, 14); // cap for UI density
  for (let i = 0; i < total; i++) {
    const w = partWords[Math.floor(rand(i) * partWords.length)];
    const id = `${assembly.name.slice(0, 3)}${1000 + Math.floor(rand(i+99) * 9000)}`;
    let status;
    const r = rand(i + 200);
    if (i < (assembly.ready / assembly.total) * total) status = 'received';
    else if (i < ((assembly.ready + (assembly.total - assembly.ready - assembly.noPo)) / assembly.total) * total) status = 'ordered';
    else status = 'no_po';
    const slip = status === 'ordered' && r > 0.7 ? Math.floor(rand(i+300) * 18) - 4 : 0;
    if (slip > 6) status = 'threat';
    lines.push({
      id,
      desc: `${w[0]} ${w[1]} — ${(rand(i+400) * 5 + 1).toFixed(1)}"`,
      qty: 1 + Math.floor(rand(i+500) * 8),
      vendor: vendors[Math.floor(rand(i+600) * vendors.length)],
      status,
      eta: status === 'received' ? '—' : status === 'no_po' ? 'TBD' :
            new Date(2026, 5, 1 + Math.floor(rand(i+700) * 60)).toISOString().slice(0,10),
      unit: Math.floor(rand(i+800) * 800 + 12),
      slip,
    });
  }
  return lines;
};

window.aggregateVendors = function(nopo, emails) {
  const m = {};
  for (const p of nopo) {
    const v = (p.vendor && typeof p.vendor === 'string' && !p.vendor.includes('-')) ? p.vendor : 'Unassigned';
    if (!m[v]) m[v] = { vendor: v, lines: 0, qty: 0, value: 0, parts: [] };
    m[v].lines += 1;
    m[v].qty += p.qty || 1;
    m[v].value += (p.qty || 1) * 220; // assumed unit price
    if (m[v].parts.length < 6) m[v].parts.push(p);
  }
  for (const e of (emails || [])) {
    if (!m[e.vendor]) m[e.vendor] = { vendor: e.vendor, lines: e.pos, qty: 0, value: 0, parts: [] };
    m[e.vendor].overdue = e.overdue;
    m[e.vendor].pos = e.pos;
  }
  return Object.values(m).sort((a, b) => b.value - a.value);
};
