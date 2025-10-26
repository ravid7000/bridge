import type {
  ArrowFunctionExpression,
  CallExpression,
  ConditionalExpression,
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  JSXAttribute,
  JSXAttributeItem,
  JSXChild,
  JSXElement,
  JSXElementName,
  JSXExpressionContainer,
  JSXFragment,
  JSXSpreadChild,
  JSXText,
  ReturnStatement,
  Span,
} from '@swc/core';

import { CompilerContext } from './context.js';
import type { ParsedModule } from './frontend/types.js';
import { stableHash } from './hashing.js';
import type {
  AstPointer,
  FileId,
  IR1,
  SourceRange,
  UiAttr,
  UiAttrDynamic,
  UiAttrStatic,
  UiElement,
  UiHole,
  UiIR,
  UiList,
  UiNode,
  UiRoot,
  UiIf,
  UiText,
} from './types.js';
import { jsxNameToString, normalizeJsxText, toSourceRange } from './utils/ast.js';

type FnLike = FunctionDeclaration | ArrowFunctionExpression | FunctionExpression;

interface LowerState {
  ctx: CompilerContext;
  fileId: FileId;
  source: string;
  componentName: string;
  dynCount: number;
}

interface LowerResult {
  nodes: UiNode[];
  dynCount: number;
}

export function toUiIR(ctx: CompilerContext, fileId: FileId, ir1: IR1, parsed: ParsedModule): UiIR {
  const resolved = ctx.resolveFileId(fileId);
  const source = parsed.code;

  const roots: UiRoot[] = [];
  let dynCount = 0;

  for (const component of ir1.components) {
    const pointer = component.pointer ?? ir1.componentPointers?.[component.name];
    let fnNode: FnLike | null = null;
    if (pointer) {
      fnNode = ctx.getNode(pointer) as FnLike | null;
    }
    if (!fnNode) {
      fnNode = findFunctionDeclaration(parsed, component.name);
    }
    if (!fnNode) {
      roots.push({ exportName: component.name, tree: [], range: component.range });
      continue;
    }

    const state: LowerState = {
      ctx,
      fileId: resolved,
      source,
      componentName: component.name,
      dynCount: 0,
    };

    const lowered = lowerFunction(fnNode, state);
    dynCount += lowered.dynCount;

    roots.push({
      exportName: component.name,
      tree: lowered.nodes,
      range: component.range,
    });
  }

  return {
    fileId: resolved,
    roots,
    dynCount,
    cssClasses: [],
  };
}

function lowerFunction(fnNode: FnLike, state: LowerState): LowerResult {
  const expressions = collectReturnExpressions(fnNode);
  const nodes: UiNode[] = [];
  for (const expr of expressions) {
    nodes.push(...lowerExpression(expr, state));
  }
  return { nodes, dynCount: state.dynCount };
}

function collectReturnExpressions(node: FnLike): Expression[] {
  if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
    return [node.body as Expression];
  }

  const expressions: Expression[] = [];
  const body = node.body?.type === 'BlockStatement' ? node.body : (node as any).body;
  if (body && body.type === 'BlockStatement') {
    for (const stmt of body.stmts ?? body.body ?? []) {
      if (!stmt) {
        continue;
      }
      if (stmt.type === 'ReturnStatement') {
        const ret = stmt as ReturnStatement;
        if (ret.argument) {
          expressions.push(ret.argument);
        }
      }
    }
  }
  return expressions;
}

function lowerExpression(expr: Expression, state: LowerState): UiNode[] {
  if (!expr) {
    return [];
  }

  switch (expr.type) {
    case 'JSXElement':
      return [lowerJsxElement(expr as JSXElement, state)];
    case 'JSXFragment':
      return lowerJsxFragment(expr as JSXFragment, state);
    case 'StringLiteral':
      return [mkText(expr.value, toRange(state, expr.span))];
    case 'BooleanLiteral':
    case 'NumericLiteral':
      return [mkText(String((expr as any).value), toRange(state, expr.span))];
    case 'TemplateLiteral':
      return [mkHole('text', expr, state)];
    case 'ConditionalExpression':
      return [lowerConditional(expr as ConditionalExpression, state)];
    case 'CallExpression':
      return lowerCallExpression(expr as CallExpression, state);
    default:
      return [mkHole('children', expr, state)];
  }
}

function lowerJsxFragment(fragment: JSXFragment, state: LowerState): UiNode[] {
  const nodes: UiNode[] = [];
  for (const child of fragment.children) {
    nodes.push(...lowerJsxChild(child, state));
  }
  return nodes;
}

function lowerJsxChild(child: JSXChild, state: LowerState): UiNode[] {
  switch (child.type) {
    case 'JSXText': {
      const text = normalizeJsxText((child as JSXText).value ?? '');
      if (!text) {
        return [];
      }
      return [mkText(text, toRange(state, child.span))];
    }
    case 'JSXElement':
      return [lowerJsxElement(child as JSXElement, state)];
    case 'JSXFragment':
      return lowerJsxFragment(child as JSXFragment, state);
    case 'JSXExpressionContainer':
      return lowerJsxExpressionContainer(child as JSXExpressionContainer, state);
    case 'JSXSpreadChild':
      return [mkHole('children', (child as JSXSpreadChild).expression, state)];
    default:
      return [];
  }
}

function lowerJsxExpressionContainer(container: JSXExpressionContainer, state: LowerState): UiNode[] {
  const expression = container.expression;
  if (!expression || expression.type === 'JSXEmptyExpression') {
    return [];
  }
  if (expression.type === 'JSXElement') {
    return [lowerJsxElement(expression, state)];
  }
  if (expression.type === 'JSXFragment') {
    return lowerJsxFragment(expression, state);
  }
  if (expression.type === 'StringLiteral' || expression.type === 'NumericLiteral') {
    return [mkText(String((expression as any).value), toRange(state, expression.span))];
  }
  if (expression.type === 'ConditionalExpression') {
    return [lowerConditional(expression as ConditionalExpression, state)];
  }
  if (expression.type === 'CallExpression') {
    return lowerCallExpression(expression as CallExpression, state);
  }
  return [mkHole('children', expression, state)];
}

function lowerConditional(expr: ConditionalExpression, state: LowerState): UiIf {
  const range = toRange(state, expr.span);
  const testPtr = trackPointer(expr.test, state, range);
  const consequent = flattenNodes(lowerExpression(expr.consequent, state));
  const alternate = expr.alternate ? flattenNodes(lowerExpression(expr.alternate, state)) : null;
  state.dynCount += 1;
  return {
    kind: 'If',
    id: makeStableId(state, range),
    test: testPtr,
    consequent,
    alternate,
    range,
  };
}

function lowerCallExpression(expr: CallExpression, state: LowerState): UiNode[] {
  if (
    expr.callee.type === 'MemberExpression' &&
    expr.callee.property.type === 'Identifier' &&
    expr.callee.property.value === 'map' &&
    expr.arguments.length
  ) {
    const arg = expr.arguments[0].expression;
    if (arg && (arg.type === 'ArrowFunctionExpression' || arg.type === 'FunctionExpression')) {
      return [lowerList(expr, arg as ArrowFunctionExpression | FunctionExpression, state)];
    }
  }
  return [mkHole('children', expr, state)];
}

function lowerList(expr: CallExpression, fn: ArrowFunctionExpression | FunctionExpression, state: LowerState): UiList {
  const range = toRange(state, expr.span);
  const eachExpr = expr.callee.type === 'MemberExpression' ? expr.callee.object : expr.callee;
  const eachPointer = trackPointer(eachExpr, state, range);
  const body = fn.body;
  let template: UiNode[] = [];
  if (fn.type === 'ArrowFunctionExpression' && body.type !== 'BlockStatement') {
    template = flattenNodes(lowerExpression(body as Expression, state));
  } else if (body.type === 'BlockStatement') {
    for (const stmt of body.stmts ?? body.body ?? []) {
      if (stmt?.type === 'ReturnStatement' && stmt.argument) {
        template = flattenNodes(lowerExpression(stmt.argument, state));
        break;
      }
    }
  }

  state.dynCount += 1;
  return {
    kind: 'List',
    id: makeStableId(state, range),
    each: eachPointer,
    key: null,
    template,
    range,
  };
}

function lowerJsxElement(element: JSXElement, state: LowerState): UiElement {
  const range = toRange(state, element.span);
  const tag = jsxElementNameToString(element.opening.name);
  const attrs: UiAttr[] = [];
  const children: UiNode[] = [];

  for (const attr of element.opening.attributes) {
    if (attr.type === 'JSXAttribute') {
      attrs.push(...lowerJsxAttribute(attr, state));
    } else if (attr.type === 'JSXSpreadAttribute') {
      const expr = attr.argument;
      const attrRange = toRange(state, attr.span);
      attrs.push({
        name: '[spread]',
        static: false,
        expr: trackPointer(expr, state, attrRange),
        range: attrRange,
        source: sliceSource(state, attrRange),
      } satisfies UiAttrDynamic);
      state.dynCount += 1;
    }
  }

  for (const child of element.children) {
    children.push(...lowerJsxChild(child, state));
  }

  return {
    kind: 'Element',
    id: makeStableId(state, range),
    tag,
    attrs,
    children,
    static: false,
    range,
  };
}

function lowerJsxAttribute(attr: JSXAttribute, state: LowerState): UiAttr[] {
  const name = jsxNameToString(attr.name);
  const range = toRange(state, attr.span);
  if (!attr.value) {
    return [makeStaticAttr(name, name, range)];
  }
  if (attr.value.type === 'StringLiteral') {
    return [makeStaticAttr(name, attr.value.value, range)];
  }
  if (attr.value.type === 'JSXExpressionContainer') {
    const expr = attr.value.expression;
    if (!expr || expr.type === 'JSXEmptyExpression') {
      return [];
    }
    if (expr.type === 'StringLiteral' || expr.type === 'NumericLiteral' || expr.type === 'BooleanLiteral') {
      return [makeStaticAttr(name, String((expr as any).value), range)];
    }
    const pointer = trackPointer(expr, state, range);
    state.dynCount += 1;
    return [
      {
        name,
        static: false,
        expr: pointer,
        range,
        source: sliceSource(state, range),
      } satisfies UiAttrDynamic,
    ];
  }
  return [];
}

function makeStaticAttr(name: string, value: string, range: SourceRange): UiAttrStatic {
  return {
    name,
    static: true,
    value,
    range,
  };
}

function mkText(value: string, range: SourceRange): UiText {
  return {
    kind: 'Text',
    id: stableHash(`${range.fileId}:${range.start}:${range.end}:text`),
    value,
    static: true,
    range,
  };
}

function mkHole(kind: UiHole['dynKind'], expr: Expression, state: LowerState): UiHole {
  const range = toRange(state, expr.span);
  const pointer = trackPointer(expr, state, range);
  state.dynCount += 1;
  return {
    kind: 'Hole',
    id: makeStableId(state, range),
    dynKind: kind,
    expr: pointer,
    memo: undefined,
    source: sliceSource(state, range),
    range,
  };
}

function trackPointer(node: Expression, state: LowerState, range: SourceRange): AstPointer {
  return state.ctx.trackNode(state.fileId, node, range);
}

function sliceSource(state: LowerState, range: SourceRange): string {
  return state.source.slice(range.start, range.end).trim();
}

function makeStableId(state: LowerState, range: SourceRange): string {
  return stableHash(`${state.componentName}:${range.start}:${range.end}:${state.fileId}`);
}

function toRange(state: LowerState, span: Span): SourceRange {
  return toSourceRange(state.fileId, span);
}

function flattenNodes(nodes: UiNode[]): UiNode[] {
  return nodes.flatMap((node) => (node ? [node] : []));
}

function jsxElementNameToString(name: JSXElementName): string {
  if (name.type === 'Identifier') {
    return name.value;
  }
  if (name.type === 'JSXMemberExpression') {
    const parts: string[] = [];
    let cur: JSXElementName = name;
    while (cur.type === 'JSXMemberExpression') {
      parts.unshift(cur.property.value);
      cur = cur.object as JSXElementName;
    }
    if (cur.type === 'Identifier') {
      parts.unshift(cur.value);
    }
    return parts.join('.');
  }
  if (name.type === 'JSXNamespacedName') {
    return `${name.ns.value}:${name.name.value}`;
  }
  return '';
}

function findFunctionDeclaration(parsed: ParsedModule, name: string): FnLike | null {
  for (const item of parsed.ast.body) {
    if (item.type === 'FunctionDeclaration' && item.identifier?.value === name) {
      return item;
    }
    if (item.type === 'VariableDeclaration') {
      for (const decl of item.declarations) {
        if (decl.id.type === 'Identifier' && decl.id.value === name && decl.init) {
          if (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression') {
            return decl.init as FnLike;
          }
        }
      }
    }
  }
  return null;
}
