import fs from 'node:fs/promises';

import {
  parse,
  type ArrowFunctionExpression,
  type FunctionExpression,
  type ExportDeclaration,
  type ExportDefaultDeclaration,
  type ExportNamedDeclaration,
  type FunctionDeclaration,
  type Module,
  type ModuleItem,
  type Span,
  type Statement,
  type VariableDeclaration,
  type VariableDeclarator,
} from '@swc/core';

import { CompilerContext } from '../context.js';
import type {
  AstPointer,
  ComponentFacts,
  ComponentMeta,
  CssRef,
  ExportKind,
  ExportMeta,
  FileId,
  ImportMeta,
  IR1,
  SourceRange,
} from '../types.js';
import { toSourceRange, jsxNameToString, isComponentName, walkAst } from '../utils/ast.js';
import type { ParsedModule } from './types.js';

type FnLike = FunctionDeclaration | ArrowFunctionExpression | FunctionExpression;

interface FunctionCandidate {
  name: string;
  node: FnLike;
  span: Span;
  isDefault?: boolean;
}

export async function parseModule(ctx: CompilerContext, fileId: FileId): Promise<ParsedModule> {
  const resolved = ctx.resolveFileId(fileId);
  const code = await fs.readFile(resolved, 'utf8');
  let ast: Module;
  try {
    ast = await parse(code, {
      target: 'es2022',
      syntax: 'typescript',
      tsx: true,
      dynamicImport: true,
      decorators: true,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.report({
      code: 'PARSE_ERROR',
      severity: 'error',
      message,
      range: { fileId: resolved, start: 0, end: 0 },
    });
    throw err;
  }

  const parsed: ParsedModule = {
    fileId: resolved,
    ast,
    code,
  };

  ctx.setSource(resolved, code);
  ctx.setAST(resolved, parsed);

  return parsed;
}

export function collectIR1(ctx: CompilerContext, fileId: FileId, parsed: ParsedModule): IR1 {
  const module = parsed.ast;
  const resolved = ctx.resolveFileId(fileId);

  const imports: ImportMeta[] = [];
  const exports: ExportMeta[] = [];
  const components: ComponentMeta[] = [];
  const cssRefSet = new Map<string, CssRef>();
  const componentPointers: Record<string, AstPointer> = {};
  const componentFacts: Record<string, ComponentFacts> = {};

  const fnRegistry = new Map<string, FunctionCandidate>();

  for (const item of module.body) {
    if (isImportDeclaration(item)) {
      imports.push(buildImportMeta(item));
      continue;
    }

    if (isFunctionDeclaration(item)) {
      const name = item.identifier?.value;
      if (name) {
        fnRegistry.set(name, { name, node: item, span: item.span });
      }
      continue;
    }

    if (isVariableDeclaration(item)) {
      registerVariableFunctions(fnRegistry, item);
    }
  }

  const registerComponent = (candidate: FunctionCandidate, exportName: string, isDefault = false) => {
    if (componentPointers[exportName]) {
      return;
    }
    const range = toSourceRange(resolved, candidate.span);
    const pointer = ctx.trackNode(resolved, candidate.node, range);
    const analysis = analyzeComponent(resolved, candidate.node);
    components.push({
      name: exportName,
      range,
      fileId: resolved,
      isDefault,
      hasJsx: analysis.hasJsx,
      hasEventHandlers: analysis.hasEventHandlers,
      pointer,
    });
    componentPointers[exportName] = pointer;
    componentFacts[exportName] = {
      hasJsx: analysis.hasJsx,
      hasEventHandlers: analysis.hasEventHandlers,
    };
    for (const ref of analysis.cssRefs) {
      cssRefSet.set(`${ref.className}:${ref.range.start}`, ref);
    }
  };

  const registerExport = (name: string, kind: ExportKind, range: SourceRange) => {
    exports.push({ name, kind, range });
  };

  for (const item of module.body) {
    if (isExportDeclaration(item)) {
      const decl = item.declaration;
      if (decl.type === 'FunctionDeclaration') {
        const name = decl.identifier?.value ?? 'default';
        registerExport(name, isComponentName(name) ? 'component' : 'function', toSourceRange(resolved, decl.span));
        registerComponent({ name, node: decl, span: decl.span }, name, false);
      } else if (decl.type === 'ClassDeclaration') {
        const name = decl.identifier?.value ?? 'default';
        registerExport(name, 'other', toSourceRange(resolved, decl.span));
      } else if (decl.type === 'VariableDeclaration') {
        handleExportedVariableDecl(decl, registerExport, registerComponent, fnRegistry, resolved);
      } else {
        registerExport('default', 'other', toSourceRange(resolved, decl.span));
      }
      continue;
    }

    if (isExportDefaultDeclaration(item)) {
      const decl = item.decl;
      if (decl.type === 'FunctionDeclaration') {
        const name = decl.identifier?.value ?? inferAnonymousName('default', decl.span);
        registerExport('default', 'component', toSourceRange(resolved, decl.span));
        registerComponent({ name, node: decl, span: decl.span, isDefault: true }, name, true);
      } else if (decl.type === 'Identifier') {
        const refName = decl.value;
        registerExport('default', isComponentName(refName) ? 'component' : 'other', toSourceRange(resolved, decl.span));
        const candidate = fnRegistry.get(refName);
        if (candidate) {
          registerComponent(candidate, refName, true);
        }
      } else if (decl.type === 'ArrowFunctionExpression') {
        const name = inferAnonymousName('default', decl.span);
        registerExport('default', 'component', toSourceRange(resolved, decl.span));
        registerComponent({ name, node: decl, span: decl.span, isDefault: true }, name, true);
      } else {
        registerExport('default', 'other', toSourceRange(resolved, decl.span));
      }
      continue;
    }

    if (isExportNamedDeclaration(item)) {
      if (item.declaration) {
        if (item.declaration.type === 'FunctionDeclaration') {
          const fn = item.declaration;
          const name = fn.identifier?.value ?? inferAnonymousName('fn', fn.span);
          registerExport(name, isComponentName(name) ? 'component' : 'function', toSourceRange(resolved, fn.span));
          registerComponent({ name, node: fn, span: fn.span }, name, false);
        } else if (item.declaration.type === 'VariableDeclaration') {
          handleExportedVariableDecl(item.declaration, registerExport, registerComponent, fnRegistry, resolved);
        } else {
          registerExport('default', 'other', toSourceRange(resolved, item.declaration.span));
        }
      }
      for (const specifier of item.specifiers ?? []) {
        if (specifier.type === 'ExportSpecifier') {
          const exported = specifier.exported?.value ?? specifier.orig.value;
          const local = specifier.orig.value;
          const range = toSourceRange(resolved, specifier.span);
          registerExport(exported, isComponentName(local) ? 'component' : 'other', range);
          const candidate = fnRegistry.get(local);
          if (candidate && isComponentName(local)) {
            registerComponent(candidate, exported, exported === 'default');
          }
        }
      }
      continue;
    }
  }

  let hasCreateApp = false;
  walkAst(module, (node) => {
    if (node?.type === 'Identifier' && node.value === 'createApp') {
      hasCreateApp = true;
    }
  });

  const ir1: IR1 = {
    fileId: resolved,
    imports,
    exports,
    components,
    hasCreateApp,
    cssRefs: Array.from(cssRefSet.values()),
    componentPointers,
    componentFacts,
  };

  ctx.setIR1(resolved, ir1);
  return ir1;
}

function isImportDeclaration(item: ModuleItem): item is ModuleItem & { type: 'ImportDeclaration' } {
  return item.type === 'ImportDeclaration';
}

function isFunctionDeclaration(item: ModuleItem | Statement): item is FunctionDeclaration {
  return item.type === 'FunctionDeclaration';
}

function isVariableDeclaration(item: ModuleItem | Statement): item is VariableDeclaration {
  return item.type === 'VariableDeclaration';
}

function isExportDeclaration(item: ModuleItem): item is ExportDeclaration {
  return item.type === 'ExportDeclaration';
}

function isExportDefaultDeclaration(item: ModuleItem): item is ExportDefaultDeclaration {
  return item.type === 'ExportDefaultDeclaration';
}

function isExportNamedDeclaration(item: ModuleItem): item is ExportNamedDeclaration {
  return item.type === 'ExportNamedDeclaration';
}

function buildImportMeta(decl: ModuleItem & { type: 'ImportDeclaration' }): ImportMeta {
  const specifiers = decl.specifiers.map((spec) => {
    if (spec.type === 'ImportSpecifier') {
      const imported = spec.imported;
      const importedName = !imported
        ? spec.local.value
        : imported.type === 'Identifier'
        ? imported.value
        : imported.value;
      return { local: spec.local.value, imported: importedName };
    }
    if (spec.type === 'ImportDefaultSpecifier') {
      return { local: spec.local.value, imported: 'default' };
    }
    return { local: spec.local.value, imported: '*' };
  });
  return {
    source: decl.source.value,
    specifiers,
  };
}

function registerVariableFunctions(registry: Map<string, FunctionCandidate>, decl: VariableDeclaration): void {
  for (const d of decl.declarations) {
    if (!d.id || d.id.type !== 'Identifier' || !d.init) {
      continue;
    }
    const name = d.id.value;
    if (d.init.type === 'ArrowFunctionExpression') {
      registry.set(name, { name, node: d.init, span: d.init.span });
    } else if (d.init.type === 'FunctionExpression') {
      registry.set(name, { name, node: d.init, span: d.init.span });
    }
  }
}

function handleExportedVariableDecl(
  decl: VariableDeclaration,
  registerExport: (name: string, kind: ExportKind, range: SourceRange) => void,
  registerComponent: (candidate: FunctionCandidate, exportName: string, isDefault: boolean) => void,
  registry: Map<string, FunctionCandidate>,
  fileId: FileId,
): void {
  for (const d of decl.declarations) {
    if (d.id.type !== 'Identifier') {
      continue;
    }
    const name = d.id.value;
    registerExport(name, inferExportKind(name, d), toSourceRange(fileId, d.span));
    if (isComponentName(name)) {
      if (d.init && (d.init.type === 'ArrowFunctionExpression' || d.init.type === 'FunctionExpression')) {
        registerComponent({ name, node: d.init, span: d.init.span }, name, false);
      } else {
        const candidate = registry.get(name);
        if (candidate) {
          registerComponent(candidate, name, false);
        }
      }
    }
  }
}

function inferExportKind(name: string, decl: VariableDeclarator): ExportKind {
  if (isComponentName(name)) {
    return 'component';
  }
  if (decl.init?.type === 'ArrowFunctionExpression' || decl.init?.type === 'FunctionExpression') {
    return 'function';
  }
  return 'const';
}

function inferAnonymousName(prefix: string, span: Span): string {
  return `${prefix}_${span?.start ?? 0}`;
}

function analyzeComponent(fileId: FileId, node: FnLike): ComponentFacts & { cssRefs: CssRef[] } {
  let hasJsx = false;
  let hasEventHandlers = false;
  const cssRefs: CssRef[] = [];

  const visit = (n: any) => {
    if (n?.type === 'JSXElement' || n?.type === 'JSXFragment') {
      hasJsx = true;
    }
    if (n?.type === 'JSXAttribute') {
      const attrName = jsxNameToString(n.name);
      if (/^on[A-Z]/.test(attrName)) {
        hasEventHandlers = true;
      }
      if ((attrName === 'class' || attrName === 'className') && n.value?.type === 'StringLiteral') {
        const classes = n.value.value.split(/\s+/).filter(Boolean);
        for (const cls of classes) {
          cssRefs.push({ className: cls, range: toSourceRange(fileId, n.span) });
        }
      }
    }
  };

  walkAst(node, visit);

  return { hasJsx, hasEventHandlers, cssRefs };
}
