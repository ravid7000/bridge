import { CompilerContext } from './context.js';
import { emitCSR } from './codegen/emitCSR.js';
import { emitSSR } from './codegen/emitSSR.js';
import { collectIR1, parseModule } from './frontend/index.js';
import { applyEmitHooks, emitManifestHooks, runOnModulePlugins, runUiPlugins } from './plugins.js';
import { cssCollectPass } from './passes/cssPass.js';
import { a11yPass } from './passes/a11y.js';
import { constFold } from './passes/constFold.js';
import { normalizeControlFlow } from './passes/controlFlow.js';
import { injectReactivityHints } from './passes/reactivityHints.js';
import { toUiIR } from './toUiIR.js';
import type { CompileArtifact, FileId } from './types.js';

export async function compileFile(ctx: CompilerContext, fileId: FileId): Promise<CompileArtifact> {
  const resolved = ctx.resolveFileId(fileId);
  const diagStart = ctx.diagnostics.length;
  const parsed = await parseModule(ctx, resolved);
  const ir1Base = collectIR1(ctx, resolved, parsed);
  const ir1 = runOnModulePlugins(ctx, ir1Base);
  ctx.setIR1(resolved, ir1);

  let ui = toUiIR(ctx, resolved, ir1, parsed);

  ui = constFold(ui);
  ui = normalizeControlFlow(ui);
  ui = injectReactivityHints(ui);
  ui = cssCollectPass(ui);
  ui = runUiPlugins(ctx, ui);
  ui = a11yPass(ui, (d) => ctx.report(d));

  const manifest = {
    fileId: ui.fileId,
    cssClasses: ui.cssClasses,
    dynCount: ui.dynCount,
  };

  const ssrRaw = emitSSR(ui);
  const csrRaw = emitCSR(ui);

  const ssrCode = applyEmitHooks(ctx, 'ssr', resolved, ssrRaw.code);
  const csrCode = applyEmitHooks(ctx, 'csr', resolved, csrRaw.code);

  emitManifestHooks(ctx, manifest);

  return {
    ssr: { ...ssrRaw, code: ssrCode },
    csr: { ...csrRaw, code: csrCode },
    diagnostics: ctx.diagnostics.slice(diagStart),
    manifest,
  };
}

export async function compileProject(ctx: CompilerContext, files: FileId[]): Promise<Map<FileId, CompileArtifact>> {
  const results = new Map<FileId, CompileArtifact>();
  for (const file of files) {
    const artifact = await compileFile(ctx, file);
    results.set(ctx.resolveFileId(file), artifact);
  }
  return results;
}
