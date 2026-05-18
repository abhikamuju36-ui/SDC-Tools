/**
 * SDC State Logic Builder - Store Helpers
 * Extracted helper functions to improve store modularity.
 */

import { getStandards as _getStandards } from '../lib/standardsLibrary.js';

// Tiny ID generator (avoid nanoid async import issues)
let _id = Date.now();
export const uid = () => `id_${(_id++).toString(36)}`;

// Build a fresh projectData object from a standards library template.
export function _projectFromStandardTemplate(template) {
  if (!template) return null;
  const smId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    name: template.name,
    isStandard: true,
    standardId: template.id,
    stateMachines: [{
      id: smId,
      name: template.name,
      displayName: template.name,
      stationNumber: 1,
      description: template.description || '',
      category: template.category || '',
      nodes: JSON.parse(JSON.stringify(template.nodes ?? [])),
      edges: JSON.parse(JSON.stringify(template.edges ?? [])),
      devices: JSON.parse(JSON.stringify(template.devices ?? [])),
      recoverySeqs: [{ id: crypto.randomUUID(), name: 'Default', nodes: [], edges: [] }],
    }],
    signals: [],
    partTracking: { fields: [] },
    recipes: [],
  };
}

// Find a library template by id first, then by name
export function _findStandardTemplate({ id, name } = {}) {
  const templates = _getStandards() ?? [];
  if (id) {
    const byId = templates.find(t => t.id === id);
    if (byId) return byId;
  }
  if (name) {
    const norm = (s) => String(s || '').toLowerCase().replace(/[\s_]+/g, ' ').trim();
    const target = norm(name);
    return templates.find(t => norm(t.name) === target) ?? null;
  }
  return null;
}

/** Return the correct SM array (base or custom/variant) for the current recipe context. */
export function _getSmArray(state) {
  const { activeRecipeId, project } = state;
  if (!activeRecipeId) return project.stateMachines ?? [];
  const recipe = (project.recipes ?? []).find(r => r.id === activeRecipeId);
  if (!recipe) return project.stateMachines ?? [];

  if (recipe.sequenceVariantId) {
    const variant = (project.sequenceVariants ?? []).find(v => v.id === recipe.sequenceVariantId);
    if (variant) return variant.stateMachines ?? [];
  }

  if (recipe.customSequence) {
    const customSMs = project.recipeOverrides?.[activeRecipeId]?.customSMs;
    return customSMs ?? project.stateMachines ?? [];
  }

  return project.stateMachines ?? [];
}

/** Apply an updater function to the correct SM array and return the new project. */
export function _updateProject(state, smsUpdater) {
  const { activeRecipeId, project } = state;
  const recipe = (project.recipes ?? []).find(r => r.id === activeRecipeId);

  if (recipe?.sequenceVariantId) {
    const variants = [...(project.sequenceVariants ?? [])];
    const vi = variants.findIndex(v => v.id === recipe.sequenceVariantId);
    if (vi >= 0) {
      variants[vi] = { ...variants[vi], stateMachines: smsUpdater(variants[vi].stateMachines ?? []) };
      return { ...project, sequenceVariants: variants };
    }
  }

  const isCustom = recipe?.customSequence && project.recipeOverrides?.[activeRecipeId]?.customSMs;
  if (isCustom) {
    const overrides = { ...project.recipeOverrides };
    const recipeOv = { ...overrides[activeRecipeId] };
    recipeOv.customSMs = smsUpdater(recipeOv.customSMs);
    overrides[activeRecipeId] = recipeOv;
    return { ...project, recipeOverrides: overrides };
  }

  return { ...project, stateMachines: smsUpdater(project.stateMachines ?? []) };
}

export function _mutateNodeInSm(sm, nodeId, nodeUpdater) {
  if (!sm) return sm;
  if ((sm.nodes ?? []).some(n => n.id === nodeId)) {
    return { ...sm, nodes: sm.nodes.map(n => n.id === nodeId ? nodeUpdater(n) : n) };
  }
  const seqs = sm.recoverySeqs ?? [];
  let mutated = false;
  const nextSeqs = seqs.map(r => {
    if ((r.nodes ?? []).some(n => n.id === nodeId)) {
      mutated = true;
      return { ...r, nodes: r.nodes.map(n => n.id === nodeId ? nodeUpdater(n) : n) };
    }
    return r;
  });
  return mutated ? { ...sm, recoverySeqs: nextSeqs } : sm;
}

export function _locateNodeInSm(sm, nodeId) {
  if (!sm) return null;
  const main = (sm.nodes ?? []).find(n => n.id === nodeId);
  if (main) return { container: 'main', node: main };
  for (const r of (sm.recoverySeqs ?? [])) {
    const n = (r.nodes ?? []).find(n => n.id === nodeId);
    if (n) return { container: 'recovery', seqId: r.id, node: n };
  }
  return null;
}

export function _getContainerNodesEdges(sm, loc) {
  if (!sm || !loc) return { nodes: [], edges: [] };
  if (loc.container === 'main') return { nodes: sm.nodes ?? [], edges: sm.edges ?? [] };
  const seq = (sm.recoverySeqs ?? []).find(r => r.id === loc.seqId);
  return { nodes: seq?.nodes ?? [], edges: seq?.edges ?? [] };
}

export function _rewireAroundNodeInSm(sm, anchorNodeId, transform) {
  if (!sm) return sm;
  const loc = _locateNodeInSm(sm, anchorNodeId);
  if (!loc) return sm;
  if (loc.container === 'main') {
    const next = transform({ nodes: sm.nodes ?? [], edges: sm.edges ?? [] });
    return { ...sm, nodes: next.nodes, edges: next.edges };
  }
  return {
    ...sm,
    recoverySeqs: sm.recoverySeqs.map(r =>
      r.id !== loc.seqId ? r : {
        ...r,
        ...transform({ nodes: r.nodes ?? [], edges: r.edges ?? [] }),
      }
    ),
  };
}

export function _uniqueDeviceName(baseName, allSMs) {
  const allNames = new Set();
  for (const sm of allSMs) {
    for (const dev of (sm.devices ?? [])) {
      allNames.add(dev.name);
    }
  }
  if (!allNames.has(baseName)) return baseName;
  let n = 2;
  while (allNames.has(`${baseName}${n}`)) n++;
  return `${baseName}${n}`;
}
