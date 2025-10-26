import type { UiIR, UiNode } from '../types.js';

export function normalizeControlFlow(ui: UiIR): UiIR {
  for (const root of ui.roots) {
    root.tree = normalizeNodes(root.tree);
  }
  return ui;
}

function normalizeNodes(nodes: UiNode[]): UiNode[] {
  const result: UiNode[] = [];
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    if (node.kind === 'If') {
      node.consequent = normalizeNodes(node.consequent);
      node.alternate = node.alternate ? normalizeNodes(node.alternate) : node.alternate;
      if (!node.consequent.length && (!node.alternate || !node.alternate.length)) {
        // skip empty conditional nodes
        continue;
      }
    } else if (node.kind === 'Element') {
      node.children = normalizeNodes(node.children);
    } else if (node.kind === 'List') {
      node.template = normalizeNodes(node.template);
    }
    result.push(node);
  }
  return result;
}
