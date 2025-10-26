import type { UiAttr, UiElement, UiIR, UiNode } from '../types.js';

export function cssCollectPass(ui: UiIR): UiIR {
  const classes = new Set<string>(ui.cssClasses ?? []);
  for (const root of ui.roots) {
    collectFromNodes(root.tree, classes);
  }
  ui.cssClasses = Array.from(classes);
  return ui;
}

function collectFromNodes(nodes: UiNode[], classes: Set<string>): void {
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    if (node.kind === 'Element') {
      collectFromAttrs(node.attrs, classes);
      collectFromNodes(node.children, classes);
    } else if (node.kind === 'List') {
      collectFromNodes(node.template, classes);
    } else if (node.kind === 'If') {
      collectFromNodes(node.consequent, classes);
      if (node.alternate) {
        collectFromNodes(node.alternate, classes);
      }
    }
  }
}

function collectFromAttrs(attrs: UiAttr[], classes: Set<string>): void {
  for (const attr of attrs) {
    if (!attr || attr.name === '[spread]') {
      continue;
    }
    if (attr.static && (attr.name === 'class' || attr.name === 'className')) {
      const tokens = attr.value.split(/\s+/).filter(Boolean);
      for (const token of tokens) {
        classes.add(token);
      }
    }
  }
}
