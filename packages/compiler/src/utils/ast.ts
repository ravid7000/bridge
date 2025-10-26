import type {
  JSXAttributeName,
  JSXIdentifier,
  JSXMemberExpression,
  JSXNamespacedName,
  Span,
} from '@swc/core';

import type { FileId, SourceRange } from '../types.js';

export function toSourceRange(fileId: FileId, span: Span): SourceRange {
  return {
    fileId,
    start: span?.start ?? 0,
    end: span?.end ?? 0,
  };
}

export function jsxNameToString(name: JSXAttributeName): string {
  const type = (name as any).type;
  if (type === 'Identifier') {
    return (name as JSXIdentifier).value ?? (name as any).name ?? '';
  }
  if (type === 'JSXNamespacedName') {
    const namespaced = name as JSXNamespacedName;
    const ns = namespaced.ns.value ?? namespaced.ns.name;
    const id = namespaced.name.value ?? namespaced.name.name;
    return `${ns}:${id}`;
  }
  if (type === 'JSXMemberExpression') {
    const member = name as JSXMemberExpression;
    const parts: string[] = [];
    let cur: JSXMemberExpression | JSXIdentifier = member;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if ((cur as any).type === 'Identifier') {
        parts.unshift((cur as JSXIdentifier).value ?? (cur as any).name ?? '');
        break;
      }
      parts.unshift(cur.property.value ?? cur.property.name);
      cur = cur.object as JSXMemberExpression | JSXIdentifier;
    }
    return parts.join('.');
  }
  return '';
}

export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

export function normalizeJsxText(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ');
  const trimmed = collapsed.trim();
  return trimmed.length ? trimmed : '';
}

export function walkAst(node: unknown, visit: (node: any) => void): void {
  const stack: unknown[] = [node];
  const seen = new Set<object>();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') {
      continue;
    }
    const obj = current as Record<string, unknown>;
    if (seen.has(obj)) {
      continue;
    }
    seen.add(obj);
    visit(current);
    if (Array.isArray(current)) {
      for (let i = current.length - 1; i >= 0; i -= 1) {
        stack.push(current[i]);
      }
      continue;
    }
    for (const key of Object.keys(obj)) {
      if (key === 'span' || key === 'loc') {
        continue;
      }
      stack.push(obj[key]);
    }
  }
}
