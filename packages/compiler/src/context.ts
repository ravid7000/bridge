import path from 'node:path';

import type {
  AstPointer,
  BridgePlugin,
  Diagnostic,
  FileId,
  IR1,
  SourceRange,
} from './types.js';
import type { ParsedModule } from './frontend/types.js';

export interface CompilerOptions {
  cwd?: string;
  plugins?: BridgePlugin[];
  dev?: boolean;
}

interface NodeCacheEntry {
  node: any;
  range: SourceRange;
}

export class CompilerContext {
  readonly opts: Required<CompilerOptions>;

  readonly diagnostics: Diagnostic[] = [];

  private readonly ir1Cache = new Map<FileId, IR1>();

  private readonly astCache = new Map<FileId, ParsedModule>();

  private readonly sourceCache = new Map<FileId, string>();

  private readonly nodeForward = new Map<FileId, WeakMap<object, number>>();

  private readonly nodeReverse = new Map<FileId, Map<number, NodeCacheEntry>>();

  private readonly nodeCounters = new Map<FileId, number>();

  constructor(opts: CompilerOptions) {
    this.opts = {
      cwd: opts.cwd ?? process.cwd(),
      plugins: opts.plugins ?? [],
      dev: opts.dev ?? false,
    };
  }

  resolveFileId(id: FileId): FileId {
    const filePath = path.isAbsolute(id) ? id : path.resolve(this.opts.cwd, id);
    return path.normalize(filePath) as FileId;
  }

  report(diag: Diagnostic): void {
    this.diagnostics.push(diag);
  }

  getIR1(fileId: FileId): IR1 | null {
    return this.ir1Cache.get(this.resolveFileId(fileId)) ?? null;
  }

  setIR1(fileId: FileId, ir1: IR1): void {
    this.ir1Cache.set(this.resolveFileId(fileId), ir1);
  }

  getAST(fileId: FileId): ParsedModule | null {
    return this.astCache.get(this.resolveFileId(fileId)) ?? null;
  }

  setAST(fileId: FileId, ast: ParsedModule): void {
    const resolved = this.resolveFileId(fileId);
    this.astCache.set(resolved, ast);
  }

  setSource(fileId: FileId, source: string): void {
    this.sourceCache.set(this.resolveFileId(fileId), source);
  }

  getSource(fileId: FileId): string | null {
    return this.sourceCache.get(this.resolveFileId(fileId)) ?? null;
  }

  getSourceSlice(range: SourceRange): string {
    const source = this.getSource(range.fileId);
    if (!source) {
      return '';
    }
    return source.slice(range.start, range.end);
  }

  trackNode(fileId: FileId, node: any, range: SourceRange): AstPointer {
    if (!node || typeof node !== 'object') {
      throw new Error('trackNode received non-object node');
    }
    const resolved = this.resolveFileId(fileId);
    let forward = this.nodeForward.get(resolved);
    if (!forward) {
      forward = new WeakMap();
      this.nodeForward.set(resolved, forward);
    }
    const existingId = forward.get(node as object);
    if (existingId) {
      const reverse = this.nodeReverse.get(resolved);
      reverse?.set(existingId, { node, range });
      return { fileId: resolved, nodeId: existingId };
    }
    const nextId = (this.nodeCounters.get(resolved) ?? 0) + 1;
    this.nodeCounters.set(resolved, nextId);
    forward.set(node as object, nextId);
    let reverse = this.nodeReverse.get(resolved);
    if (!reverse) {
      reverse = new Map();
      this.nodeReverse.set(resolved, reverse);
    }
    reverse.set(nextId, { node, range });
    return { fileId: resolved, nodeId: nextId };
  }

  getNode(pointer: AstPointer): any | null {
    const reverse = this.nodeReverse.get(this.resolveFileId(pointer.fileId));
    return reverse?.get(pointer.nodeId)?.node ?? null;
  }

  getRange(pointer: AstPointer): SourceRange | null {
    const reverse = this.nodeReverse.get(this.resolveFileId(pointer.fileId));
    return reverse?.get(pointer.nodeId)?.range ?? null;
  }

  clearFileCaches(fileId: FileId): void {
    const resolved = this.resolveFileId(fileId);
    this.ir1Cache.delete(resolved);
    this.astCache.delete(resolved);
    this.sourceCache.delete(resolved);
    this.nodeForward.delete(resolved);
    this.nodeReverse.delete(resolved);
    this.nodeCounters.delete(resolved);
  }

  get plugins(): BridgePlugin[] {
    return this.opts.plugins;
  }
}
