export type FileId = string;
export type StableId = string;

export interface AstPointer {
  fileId: FileId;
  nodeId: number;
}

export interface SourceRange {
  fileId: FileId;
  start: number;
  end: number;
}

export type DiagnosticSeverity = 'error' | 'warn' | 'info';

export interface Diagnostic {
  range: SourceRange;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
}

export interface ImportSpecifierMeta {
  local: string;
  imported?: string;
}

export interface ImportMeta {
  source: string;
  specifiers: ImportSpecifierMeta[];
}

export type ExportKind = 'function' | 'const' | 'component' | 'type' | 'other';

export interface ExportMeta {
  name: string;
  kind: ExportKind;
  range: SourceRange;
}

export interface ComponentMeta {
  name: string;
  range: SourceRange;
  fileId: FileId;
  isDefault: boolean;
  hasJsx?: boolean;
  hasEventHandlers?: boolean;
  pointer?: AstPointer;
}

export interface CssRef {
  className: string;
  range: SourceRange;
}

export interface ComponentFacts {
  hasJsx: boolean;
  hasEventHandlers: boolean;
}

export interface IR1 {
  fileId: FileId;
  imports: ImportMeta[];
  exports: ExportMeta[];
  components: ComponentMeta[];
  hasCreateApp: boolean;
  cssRefs: CssRef[];
  facts?: Record<string, unknown>;
  componentPointers?: Record<string, AstPointer>;
  componentFacts?: Record<string, ComponentFacts>;
}

export type DynKind = 'text' | 'attr' | 'children' | 'spread';

export interface UiAttrStatic {
  name: string;
  static: true;
  value: string;
  range: SourceRange;
}

export interface UiAttrDynamic {
  name: string;
  static: false;
  expr: AstPointer;
  range: SourceRange;
  source: string;
  memo?: boolean;
}

export type UiAttr = UiAttrStatic | UiAttrDynamic;

export interface UiElement {
  kind: 'Element';
  id: StableId;
  tag: string;
  attrs: UiAttr[];
  children: UiNode[];
  static: boolean;
  range: SourceRange;
}

export interface UiText {
  kind: 'Text';
  id: StableId;
  value: string;
  static: boolean;
  range: SourceRange;
}

export interface UiHole {
  kind: 'Hole';
  id: StableId;
  dynKind: DynKind;
  expr: AstPointer;
  memo?: boolean;
  source: string;
  range: SourceRange;
}

export interface UiList {
  kind: 'List';
  id: StableId;
  each: AstPointer;
  key: AstPointer | null;
  template: UiNode[];
  range: SourceRange;
}

export interface UiIf {
  kind: 'If';
  id: StableId;
  test: AstPointer;
  consequent: UiNode[];
  alternate: UiNode[] | null;
  range: SourceRange;
}

export type UiNode = UiElement | UiText | UiHole | UiList | UiIf;

export interface UiRoot {
  exportName: string;
  tree: UiNode[];
  range?: SourceRange | null;
}

export interface UiIR {
  fileId: FileId;
  roots: UiRoot[];
  dynCount: number;
  cssClasses: string[];
}

export interface CompileArtifact {
  ssr?: { code: string; map?: unknown };
  csr?: { code: string; map?: unknown };
  diagnostics: Diagnostic[];
  manifest?: Record<string, unknown>;
}

export interface TransformCtx {
  readonly fileId: FileId;
  readonly hash: (s: string) => StableId;
  report: (d: Diagnostic) => void;
  readAst: () => unknown;
  getMeta: () => IR1;
}

export interface UiTransformCtx extends TransformCtx {
  getMeta: () => IR1;
}

export interface BridgePlugin {
  name: string;
  onModule?(ir1: IR1, ctx: TransformCtx): IR1 | void;
  transformUI?(ui: UiIR, ctx: UiTransformCtx): UiIR | void;
  emitSSR?(code: string, ctx: { fileId: FileId }): string | void;
  emitCSR?(code: string, ctx: { fileId: FileId }): string | void;
  onManifest?(manifest: Record<string, unknown>): void;
}
