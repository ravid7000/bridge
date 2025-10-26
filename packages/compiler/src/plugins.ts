import { stableHash } from './hashing.js';
import type { CompilerContext } from './context.js';
import type { BridgePlugin, IR1, UiIR } from './types.js';

export function runOnModulePlugins(ctx: CompilerContext, ir1: IR1): IR1 {
  let current = ir1;
  for (const plugin of ctx.plugins) {
    const next = plugin.onModule?.(current, {
      fileId: current.fileId,
      hash: stableHash,
      report: (d) => ctx.report(d),
      readAst: () => ctx.getAST(current.fileId)?.ast,
      getMeta: () => current,
    });
    if (next) {
      current = next;
    }
  }
  return current;
}

export function runUiPlugins(ctx: CompilerContext, ui: UiIR): UiIR {
  let current = ui;
  for (const plugin of ctx.plugins) {
    const next = plugin.transformUI?.(current, {
      fileId: current.fileId,
      hash: stableHash,
      report: (d) => ctx.report(d),
      readAst: () => ctx.getAST(current.fileId)?.ast,
      getMeta: () => ctx.getIR1(current.fileId)!,
    });
    if (next) {
      current = next;
    }
  }
  return current;
}

export function applyEmitHooks(
  ctx: CompilerContext,
  stage: 'ssr' | 'csr',
  fileId: string,
  code: string,
): string {
  let updated = code;
  for (const plugin of ctx.plugins) {
    const next = stage === 'ssr'
      ? plugin.emitSSR?.(updated, { fileId })
      : plugin.emitCSR?.(updated, { fileId });
    if (typeof next === 'string') {
      updated = next;
    }
  }
  return updated;
}

export function emitManifestHooks(ctx: CompilerContext, manifest: Record<string, unknown>): void {
  for (const plugin of ctx.plugins) {
    plugin.onManifest?.(manifest);
  }
}
