import type { UiAttr, UiHole, UiIR, UiNode } from '../types.js';

const SIMPLE_EXPR_RE = /^[a-zA-Z_$][\w$]*(?:\.[\w$]+)*$/;

export function injectReactivityHints(ui: UiIR): UiIR {
  for (const root of ui.roots) {
    visitNodes(root.tree);
  }
  return ui;
}

function visitNodes(nodes: UiNode[]): void {
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    switch (node.kind) {
      case 'Element':
        visitAttrs(node.attrs);
        visitNodes(node.children);
        break;
      case 'Hole':
        annotateHole(node);
        break;
      case 'List':
        visitNodes(node.template);
        break;
      case 'If':
        visitNodes(node.consequent);
        if (node.alternate) {
          visitNodes(node.alternate);
        }
        break;
      case 'Text':
      default:
        break;
    }
  }
}

function visitAttrs(attrs: UiAttr[]): void {
  for (const attr of attrs) {
    if (attr && attr.static === false) {
      attr.memo = SIMPLE_EXPR_RE.test(attr.source ?? '');
    }
  }
}

function annotateHole(hole: UiHole): void {
  hole.memo = SIMPLE_EXPR_RE.test(hole.source);
}
