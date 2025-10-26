import type { Diagnostic, UiElement, UiIR, UiNode } from '../types.js';

export function a11yPass(ui: UiIR, report: (d: Diagnostic) => void): UiIR {
  for (const root of ui.roots) {
    visitNodes(root.tree, report);
  }
  return ui;
}

function visitNodes(nodes: UiNode[], report: (d: Diagnostic) => void): void {
  for (const node of nodes) {
    if (!node) {
      continue;
    }
    if (node.kind === 'Element') {
      runElementChecks(node, report);
      visitNodes(node.children, report);
    } else if (node.kind === 'List') {
      visitNodes(node.template, report);
    } else if (node.kind === 'If') {
      visitNodes(node.consequent, report);
      if (node.alternate) {
        visitNodes(node.alternate, report);
      }
    }
  }
}

function runElementChecks(element: UiElement, report: (d: Diagnostic) => void): void {
  if (element.tag === 'img') {
    const hasAlt = element.attrs.some((attr) => attr.name === 'alt');
    if (!hasAlt) {
      report({
        code: 'A11Y_IMG_ALT_MISSING',
        severity: 'warn',
        message: 'Image elements should include an alt attribute for accessibility.',
        range: element.range,
      });
    }
  }
}
