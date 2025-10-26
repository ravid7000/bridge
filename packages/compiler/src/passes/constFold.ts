import type { UiElement, UiIR, UiNode } from '../types.js';

export function constFold(ui: UiIR): UiIR {
  for (const root of ui.roots) {
    markStatic(root.tree);
  }
  return ui;
}

function markStatic(nodes: UiNode[]): boolean {
  let allStatic = true;
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    const isStatic = markNode(node);
    if (!isStatic) {
      allStatic = false;
    }
  }
  return allStatic;
}

function markNode(node: UiNode): boolean {
  switch (node.kind) {
    case 'Text':
      node.static = true;
      return true;
    case 'Element':
      return markElement(node);
    case 'Hole':
      return false;
    case 'List':
    case 'If':
      return false;
    default:
      return false;
  }
}

function markElement(element: UiElement): boolean {
  const attrsStatic = element.attrs.every((attr) => attr.static);
  const childrenStatic = markStatic(element.children);
  const isStatic = attrsStatic && childrenStatic;
  element.static = isStatic;
  return isStatic;
}
