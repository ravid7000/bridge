BridgeJS Compiler — Internals Design

This lays out the compiler’s architecture, intermediate representations, key transforms, emitted artifacts, and plugin hooks. It assumes developers write .ts/.tsx and the runtime uses fine-grained signals + DOM bindings (no VDOM).

⸻

0. Design Goals
   • Zero-VDOM emit: compile TSX → minimal DOM ops.
   • Deterministic SSR/CSR: stable IDs for hydration bindings.
   • Fine-grained updates: instrument only dynamic reads.
   • Fast incremental builds: module graph cache + content hashing.
   • DX-first: precise diagnostics, source maps, a11y hints, budget reports.
   • Interop: Tailwind, CSS Modules, (optional) islands/partial hydrate.
   • Extensible: first-class plugin system with safe IR access.

⸻

1.  Top-Level Architecture

          Files (.ts/.tsx/.css)
                    │
          ┌─────────▼─────────┐
          │   Frontend (FE)   │   Parse TS/TSX → TS AST (swc/tsserver)
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────┐
          │  Analyzer & IR1   │   - Module graph
          │ (semantic pass)   │   - Symbol table / Types
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────┐
          │  Transforms → IR2  │   - JSX→IR (UI tree)
          │  (static opts)     │   - Refs, effects, deps
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────┐
          │  Codegen (SSR/CSR) │   - DOM ops emit
          │ + CSS/A11y/Assets  │   - Hydration markers
          └─────────┬─────────┘
                    │
          ┌─────────▼─────────┐
          │    Bundler stage   │   - chunking/code split
          │ (esbuild/rollup)   │   - manifest/sourcemaps
          └────────────────────┘

⸻

2. Frontend (Parsing & Module Graph)
   • Parser: SWC (fast) or TS compiler API; JSX enabled.
   • Module Graph: resolve ESM imports; detect createApp, page modules, component modules.
   • Symbols/Types: minimal type facts for:
   • JSX intrinsic vs component
   • Props shapes
   • Literal/constant detection
   • Cache:
   • File content hash
   • Per-file AST cache
   • Graph version (invalidate on import changes)

⸻

3. Intermediate Representations

IR1: Semantic Facts

type IR1 = {
fileId: string;
exports: { name: string; kind: 'function'|'const'|'component' };
components: ComponentMeta[];
hasCreateApp: boolean;
imports: ImportMeta[];
cssRefs: CssRef[];
};

IR2: UI IR (post-JSX)

A normalized, framework-agnostic UI tree with dynamic annotations.

type UiNode =
| { kind: 'Element', tag: string, attrs: Attr[], children: UiNode[], static: boolean, id: StableId }
| { kind: 'Text', value: string, static: boolean, id: StableId }
| { kind: 'Hole', expr: Expr, dynKind: 'text'|'attr'|'children'|'spread', id: StableId }
| { kind: 'List', each: Expr, key: Expr | null, template: UiNode[], id: StableId }
| { kind: 'If', test: Expr, consequent: UiNode[], alternate: UiNode[]|null, id: StableId };

type Attr =
| { name: string, value: string, static: true }
| { name: string, expr: Expr, static: false };

type Expr = AstPointer; // points back to original TS AST
type StableId = string; // filePathHash + nodeLocHash

Why IR2?
It cleanly separates structure (elements, lists, conditionals) from reactive holes that require bindings.

⸻

4. Stable IDs & Hydration Markers
   • StableId = hash(filePath + node.start + node.end + salt(version)).
   • Emitted to SSR HTML: data-b-id="abc123" on dynamic nodes/anchors.
   • CSR hydration maps StableId → DOM node(s) to attach effects without re-rendering.

Marker strategies:
• Text nodes: wrap with comment anchors <!--b:abc123-->Text<!--/b--> (or id on parent with offset table).
• Attr bindings: element gets data-b-id, runtime knows which attr(s) are dynamic.
• Lists: comment block range <!--b-list:xyz--> ... <!--/b-list--> with keyed anchors per child.

⸻

5. Key Transform Passes

5.1 JSX → UiIR
• Convert TSX into UiNode tree.
• Classify statics vs dynamics:
• Static: literal text/attrs, known arrays of statics, static branches.
• Dynamic “holes”: any expression reading from signals/store/props.
• Identify event handlers (e.g., onClick) for client runtime linking.

5.2 Constant Folding & Hoisting
• Fold string/number literals, inline constants.
• Hoist static subtrees into templates reused across mounts.

5.3 Control Flow Normalization
• if/ternary/switch → UiNode.If.
• array.map over JSX → UiNode.List with key expr (warn if missing key).

5.4 Dependency & Reactivity Hints
• Wrap reactive reads inside accessors for the runtime (or annotate):
• e.g., transform data.title access in dynamic hole to a tracked getter call.
• For stores/signals known symbols: mark as tracked.
• For external adapters (useExternal()): mark as bridged source.

5.5 Accessibility & Semantics (opt-in auto-fixes)
• Insert landmarks if layout top-level lacks them (warn by default, auto-fix if a11y.autofix).
• Ensure label association for inputs (warn when missing).
• Rel/target safety on links.
• Contrast check (static colors) → diagnostics, optional auto-suggestions.

5.6 CSS Integration
• Collect class names; integrate with Tailwind JIT scanning.
• Compute critical CSS per page route (above-the-fold heuristics).
• Extract CSS modules; rewrite class tokens to stable short names.

⸻

6. Code Generation

We emit two coordinated targets:

6.1 SSR Emitter
• Goal: String/stream HTML + serialized data + minimal markers.
• Emit:
• Static HTML for UiIR statics
• For dynamic text/attrs: render with current values (server snapshot) and include marker IDs.
• List segments with keyed anchors.
• Inject <script type="bridge-data"> with:
• Page data (from load() on server)
• Resource snapshots (if any)
• Optional debug map (dev-only)
• Example minimal SSR output snippet:

<main data-b-id="m_4a1">
  <h1 data-b-id="t_9f2">Welcome to Bridge</h1>
  <!--b-list:l_a7c-->
    <li data-b-id="i_1">Fast</li>
    <li data-b-id="i_2">Accessible</li>
    <li data-b-id="i_3">Tiny</li>
  <!--/b-list:l_a7c-->
</main>
<script type="bridge-data">{"__page":{"title":"Welcome to Bridge","features":["Fast","Accessible","Tiny"]}}</script>

6.2 CSR Emitter (DOM Ops)
• Goal: Create/hydrate without VDOM.
• Emit per-component factories with two entrypoints:
• mount(target, props) — CSR only
• hydrate(root, props) — attach to SSR DOM using markers
• Primitive ops (internal runtime helpers):

el(tag, staticAttrs?) → HTMLElement
txt(init) → Text
setText(node, getter) // registers effect
setAttr(node, name, getter)
mountList(anchor, iterableGetter, keyGetter, renderItemFn)
on(node, 'click', handler)

    •	CSR code example (simplified):

export function hydrate_Main(root, ctx) {
const h1 = root.querySelector('[data-b-id="t_9f2"]');
setText(h1, () => ctx.data.title);
const listStart = findListAnchor(root, 'l_a7c');
mountList(listStart, () => ctx.data.features, x => x, (li, item) => {
setText(li, () => item);
}, { hydrate: true });
}

Tree-shaking: Unused helpers are dropped. Component code splits by route or dynamic import.

⸻

7. Partial Hydration (Islands) — Optional

Even though devs explicitly author components, the compiler still supports partial hydration:
• Heuristic: any subtree containing event handlers or useSignal/useExternal reads is “interactive”.
• Emit island boundaries (split points) with lazy CSR chunks:
• SSR includes static HTML of island.
• Client loads island chunk on visibility/interaction.
• Configurable via per-component directive:

/_ @bridge:island _/
export function ProductCard(...) { ... }

⸻

8. Bundler Integration
   • Use esbuild (default) or Rollup for complex plugins.
   • Chunking strategy:
   • Entry: each page route
   • Shared: runtime core + common components
   • Islands: one chunk per island (name-hashed)
   • Manifest:

{
"entries": { "/": "entry.home.abcd.js" },
"css": { "/": ["home.crit.css","home.css"] },
"islands": {
"components/ProductCard.tsx": "island.product-card.1234.js"
},
"assets": { ... }
}

    •	Sourcemaps: always emit; link diagnostics to source.

⸻

9. Incremental & Watch Mode
   • Per-file content hashing + transform cache for IR1/IR2.
   • Dependency fingerprints: if only a leaf component changes, re-emit only impacted pages/chunks.
   • HMR:
   • Replace component factory and re-run hydration bindings in-place.
   • Preserve signals/stores if compatible shape (dev-only affordance).

⸻

10. Diagnostics & Reports
    • Types: show TS errors with source ranges.
    • A11y: rule id, element path, suggested fix; configurable severity.
    • Perf budgets: warn/error for JS/CSS/Images over thresholds; show culprits (per-chunk).
    • Hydration risks: flag non-deterministic reads (e.g., Math.random() in render), or conditional read instability (reads behind changing conditionals).
    • List keys: warn if missing or non-stable.

All diagnostics contain file:line:col using source maps.

⸻

11. Plugin System

Hook surface

export interface BridgePlugin {
name: string;

// parsing / graph
onModule?(m: ModuleContext): void;

// IR transforms
transformIR1?(ir: IR1, ctx: TransformCtx): IR1 | void;
transformUI?(ui: UiNode[], ctx: TransformCtx): UiNode[] | void;

// codegen
emitSSR?(code: string, ctx: EmitCtx): string | void;
emitCSR?(code: string, ctx: EmitCtx): string | void;

// css/assets
onCSS?(cssCtx: CssCtx): void;

// finalize
onManifest?(manifest: Manifest): void;
}

Safety: IR structures are immutable (frozen); plugins return patches. Compiler validates invariants (e.g., no duplicate StableIds).

Examples:
• @bridge/plugin-images: transform <img src> into responsive sets + CDN URLs; update SSR and CSR.
• @bridge/plugin-zustand: auto-serialize store snapshot in SSR, preload hydration hook.
• @bridge/plugin-i18n: wrap dynamic text nodes with translation lookups at build time.

⸻

12. Example: End-to-End Transform

Input (Home.tsx)

export function Page() {
const data = usePageData<{ title: string; features: string[] }>();
return (

<main class="mx-auto">
<h1>{data.title}</h1>
<ul>
{data.features.map(f => <li>{f}</li>)}
</ul>
</main>
);
}

IR2 (sketch)

Element(main, attrs=[class="mx-auto"], children=[
Element(h1, children=[Hole(text: data.title)] id=t*1),
Element(ul, children=[
List(each: data.features, key: null, template=[
Element(li, children=[Hole(text: f)] id=i*)
] id=l_1)
])
] id=m_1)

SSR emit (fragment)

<main class="mx-auto" data-b-id="m_1">
  <h1 data-b-id="t_1">Welcome to BridgeJS</h1>
  <!--b-list:l_1-->
    <li data-b-id="i_1">Fast</li>
    <li data-b-id="i_2">Accessible</li>
    <li data-b-id="i_3">Tiny</li>
  <!--/b-list:l_1-->
</main>
<script type="bridge-data">{"__page":{"title":"Welcome to BridgeJS","features":["Fast","Accessible","Tiny"]}}</script>

CSR hydrate (pseudo)

export function hydrate_Page(root, ctx) {
setText(root.querySelector('[data-b-id="t_1"]'), () => ctx.data.title);
const anchor = findListAnchor(root, 'l_1');
mountList(anchor, () => ctx.data.features, null, (li, f) => setText(li, () => f), { hydrate: true });
}

⸻

13. Security & Robustness
    • HTML escaping: all text holes escaped by default; explicit dangerouslySetHtml() opt-in with sanitizer plug-in.
    • CSP: emit nonce-ready script/style tags; can inline critical CSS under CSP.
    • XSS audits: static rules warn on unsafe innerHTML, URL injections, target=\_blank without rel, etc.

⸻

14. Performance Targets
    • Compile throughput: ≥ 5k LOC/s on M1 for warm cache.
    • Cold build: sub-2s for small apps, scales linearly with caching.
    • Runtime output: core runtime < 8–10 KB gz; typical page JS < 30–80 KB gz (excluding app code) with islands.
    • Hydration: O(#dynamic holes + visible list items), no full re-render.

⸻

15. Implementation Notes
    • Prefer SWC for parsing/transforms; keep TS’s checker optional (diagnostics mode).
    • Emit ES2018+; leave transpilation to bundler’s target.
    • Use deterministic hashing (xxhash/metro-style) for StableIds & chunk names.
    • Dev/prod flags strip debug markers/ids in prod while keeping StableIds for hydration.

⸻

16. What This Unblocks Next
    • Build the minimal emitter (SSR + CSR ops) behind a feature flag.
    • Ship diagnostics for keys/a11y/unsafe HTML.
    • Wire Tailwind critical extraction plugin.
    • Add island boundary directive and verify lazy hydration.

17. Typescript scaffold
    Awesome—here’s a tight, copy-pasteable TypeScript scaffold for IR1/IR2 plus a minimal transform pipeline you can flesh out. It’s organized so you can drop it into a packages/compiler folder and iterate.

⸻

📁 Suggested structure

packages/compiler/
src/
types.ts // IR1, IR2, shared types
context.ts // Compiler context, caches, helpers
frontend.ts // Parse & collect IR1 (AST, module graph)
toUiIR.ts // JSX → IR2 transform
passes/
constFold.ts
controlFlow.ts
a11y.ts
cssPass.ts
reactivityHints.ts
codegen/
emitSSR.ts
emitCSR.ts
pipeline.ts // Orchestrates the pipeline
plugins.ts // Plugin types + runner
hashing.ts
utils.ts

⸻

🧠 types.ts — IR1 / IR2 + shared

// packages/compiler/src/types.ts

// ---------- Common ----------
export type FileId = string; // absolute/normalized path
export type StableId = string; // deterministic hash of file+loc
export type AstPointer = { fileId: FileId; nodeId: number }; // node table idx

export interface SourceRange {
fileId: FileId;
start: number; // pos
end: number; // pos
}

export interface Diagnostic {
range: SourceRange;
severity: "error" | "warn" | "info";
code: string; // e.g., A11Y_LABEL_MISSING
message: string;
}

// ---------- IR1: semantic/module graph ----------
export interface ImportMeta {
source: string; // e.g., "./Button"
specifiers: Array<{ local: string; imported?: string }>;
}

export type ExportKind = "function" | "const" | "component" | "type" | "other";

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
// JSX presence, event handlers, etc.
hasJsx?: boolean;
hasEventHandlers?: boolean;
}

export interface CssRef {
className: string;
range: SourceRange;
}

export interface IR1 {
fileId: FileId;
imports: ImportMeta[];
exports: ExportMeta[];
components: ComponentMeta[];
hasCreateApp: boolean;
cssRefs: CssRef[];
// optional type facts if checker attached
facts?: Record<string, unknown>;
}

// ---------- IR2: UI tree after JSX lowering ----------
export type UiNode =
| UiElement
| UiText
| UiHole
| UiList
| UiIf;

export interface UiElement {
kind: "Element";
id: StableId;
tag: string; // "div" or component tag name? (elements only here)
attrs: UiAttr[];
children: UiNode[];
static: boolean;
range: SourceRange;
}

export interface UiText {
kind: "Text";
id: StableId;
value: string; // server snapshot text
static: boolean;
range: SourceRange;
}

export type DynKind = "text" | "attr" | "children" | "spread";

export interface UiHole {
kind: "Hole";
id: StableId;
dynKind: DynKind;
expr: AstPointer;
// optional optimization flags
memo?: boolean;
range: SourceRange;
}

export interface UiList {
kind: "List";
id: StableId;
each: AstPointer; // expression producing iterable
key: AstPointer | null;
template: UiNode[]; // element(s) to render per item
range: SourceRange;
}

export interface UiIf {
kind: "If";
id: StableId;
test: AstPointer;
consequent: UiNode[];
alternate: UiNode[] | null;
range: SourceRange;
}

export type UiAttr =
| { name: string; static: true; value: string; range: SourceRange }
| { name: string; static: false; expr: AstPointer; range: SourceRange };

// ---------- Per-file IR2 bundle ----------
export interface UiIR {
fileId: FileId;
roots: Array<{ exportName: string; tree: UiNode[] }>; // typically components/pages
dynCount: number; // number of dynamic holes in file (for metrics)
}

// ---------- Compiler product ----------
export interface CompileArtifact {
ssr?: { code: string; map?: any };
csr?: { code: string; map?: any };
diagnostics: Diagnostic[];
manifest?: Record<string, unknown>;
}

// ---------- Plugins ----------
export interface TransformCtx {
readonly fileId: FileId;
readonly hash: (s: string) => StableId;
report: (d: Diagnostic) => void;
readAst: () => any; // parser-specific AST
// read/write helpers
getMeta: () => IR1;
}

export interface UiTransformCtx extends TransformCtx {
// mutate or read UI tree
}

export interface BridgePlugin {
name: string;
onModule?(ir1: IR1, ctx: TransformCtx): IR1 | void;
transformUI?(ui: UiIR, ctx: UiTransformCtx): UiIR | void;
emitSSR?(code: string, ctx: { fileId: FileId }): string | void;
emitCSR?(code: string, ctx: { fileId: FileId }): string | void;
onManifest?(manifest: Record<string, unknown>): void;
}

⸻

🧩 context.ts — compiler context

// packages/compiler/src/context.ts
import type { BridgePlugin, FileId, IR1, Diagnostic } from "./types";

export interface CompilerOptions {
cwd: string;
plugins?: BridgePlugin[];
dev?: boolean;
}

export class CompilerContext {
readonly opts: CompilerOptions;
readonly diagnostics: Diagnostic[] = [];

// caches
private ir1Cache = new Map<FileId, IR1>();
private astCache = new Map<FileId, any>();

constructor(opts: CompilerOptions) {
this.opts = opts;
}

report(diag: Diagnostic) {
this.diagnostics.push(diag);
}

getIR1(fileId: FileId) {
return this.ir1Cache.get(fileId) || null;
}
setIR1(fileId: FileId, ir1: IR1) {
this.ir1Cache.set(fileId, ir1);
}

getAST(fileId: FileId) {
return this.astCache.get(fileId) || null;
}
setAST(fileId: FileId, ast: any) {
this.astCache.set(fileId, ast);
}
}

⸻

🧾 frontend.ts — parse & collect IR1

Use SWC or TS compiler API. Below is a stub with the contract you’ll fulfill.

// packages/compiler/src/frontend.ts
import type { CompilerContext } from "./context";
import type { FileId, IR1, ImportMeta, ExportMeta, ComponentMeta, CssRef, SourceRange } from "./types";

export async function parseModule(ctx: CompilerContext, fileId: FileId): Promise<any> {
// TODO: parse TS/TSX via SWC/ts
const fakeAst = {};
ctx.setAST(fileId, fakeAst);
return fakeAst;
}

export function collectIR1(ctx: CompilerContext, fileId: FileId, ast: any): IR1 {
// TODO: traverse AST, fill below
const imports: ImportMeta[] = [];
const exports: ExportMeta[] = [];
const components: ComponentMeta[] = [];
const cssRefs: CssRef[] = [];

const range: SourceRange = { fileId, start: 0, end: 0 };

const ir1: IR1 = {
fileId,
imports,
exports,
components,
hasCreateApp: false,
cssRefs,
};

// run plugin hook
ctx.opts.plugins?.forEach(p => p.onModule?.(ir1, {
fileId,
hash: (s) => stableHash(s),
report: (d) => ctx.report(d),
readAst: () => ast,
getMeta: () => ir1,
}));

ctx.setIR1(fileId, ir1);
return ir1;
}

// simplistic, swap with xxhash/metro hash
function stableHash(s: string): string {
let h = 2166136261 >>> 0;
for (let i = 0; i < s.length; i++) {
h ^= s.charCodeAt(i);
h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
}
return (h >>> 0).toString(36);
}

⸻

🔁 toUiIR.ts — JSX → IR2 lowering (skeleton)

// packages/compiler/src/toUiIR.ts
import type { CompilerContext } from "./context";
import type {
FileId, UiIR, UiNode, UiElement, UiText, UiHole, UiList, UiIf,
SourceRange, StableId, IR1
} from "./types";

export function toUiIR(ctx: CompilerContext, fileId: FileId, ir1: IR1, ast: any): UiIR {
// TODO: real traversal. For now, produce empty roots to exercise passes.
const roots: Array<{ exportName: string; tree: UiNode[] }> = ir1.components.map(c => ({
exportName: c.name,
tree: [], // fill with UiNodes from JSX
}));

const ui: UiIR = {
fileId,
roots,
dynCount: 0,
};

return ui;
}

// ---------- Helpers to construct nodes (used by passes/emitters) ----------
export function mkElement(tag: string, attrs: UiElement["attrs"], children: UiNode[], range: SourceRange, idSeed: string): UiElement {
return {
kind: "Element",
id: sid(idSeed, range),
tag,
attrs,
children,
static: false,
range,
};
}
export function mkText(value: string, range: SourceRange, idSeed: string): UiText {
return {
kind: "Text",
id: sid(idSeed, range),
value,
static: false,
range,
};
}
export function mkHole(dynKind: UiHole["dynKind"], exprNode: number, fileId: FileId, range: SourceRange, idSeed: string): UiHole {
return {
kind: "Hole",
id: sid(idSeed, range),
dynKind,
expr: { fileId, nodeId: exprNode },
range,
};
}
export function mkList(eachNode: number, fileId: FileId, template: UiNode[], range: SourceRange, idSeed: string): UiList {
return {
kind: "List",
id: sid(idSeed, range),
each: { fileId, nodeId: eachNode },
key: null,
template,
range,
};
}
export function mkIf(testNode: number, fileId: FileId, cons: UiNode[], alt: UiNode[] | null, range: SourceRange, idSeed: string): UiIf {
return {
kind: "If",
id: sid(idSeed, range),
test: { fileId, nodeId: testNode },
consequent: cons,
alternate: alt,
range,
};
}

function sid(seed: string, r: SourceRange): StableId {
return stableHash(`${seed}:${r.fileId}:${r.start}:${r.end}`);
}
function stableHash(s: string): string {
let h = 2166136261 >>> 0;
for (let i = 0; i < s.length; i++) {
h ^= s.charCodeAt(i);
h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
}
return (h >>> 0).toString(36);
}

⸻

🧰 Pass stubs — passes/\*.ts

// packages/compiler/src/passes/constFold.ts
import type { UiIR } from "../types";

export function constFold(ui: UiIR): UiIR {
// TODO: traverse UiIR and fold static expressions/attrs/text to mark nodes static
return ui;
}

// packages/compiler/src/passes/controlFlow.ts
import type { UiIR } from "../types";

export function normalizeControlFlow(ui: UiIR): UiIR {
// TODO: transform ternaries/short-circuits modeled in UiIR into UiIf nodes (if not already)
return ui;
}

// packages/compiler/src/passes/reactivityHints.ts
import type { UiIR } from "../types";

export function injectReactivityHints(ui: UiIR): UiIR {
// TODO: mark UiHole with memo flags, attach hint data for CSR emitter
return ui;
}

// packages/compiler/src/passes/a11y.ts
import type { UiIR, Diagnostic } from "../types";

export function a11yPass(ui: UiIR, report: (d: Diagnostic) => void): UiIR {
// TODO: run simple checks (missing alt, labels) and emit diagnostics
return ui;
}

// packages/compiler/src/passes/cssPass.ts
import type { UiIR } from "../types";

export function cssCollectPass(ui: UiIR): UiIR {
// TODO: collect class names and emit to side-channel for critical CSS extraction
return ui;
}

⸻

🏗️ Codegen stubs — codegen/emit\*.ts

// packages/compiler/src/codegen/emitSSR.ts
import type { UiIR } from "../types";

export function emitSSR(ui: UiIR): { code: string; map?: any } {
// TODO: walk UiIR and emit SSR HTML string builder with markers
return { code: `/* SSR for ${ui.fileId} */` };
}

// packages/compiler/src/codegen/emitCSR.ts
import type { UiIR } from "../types";

export function emitCSR(ui: UiIR): { code: string; map?: any } {
// TODO: emit DOM ops + hydrate() using StableIds in UiIR
return { code: `/* CSR for ${ui.fileId} */` };
}

⸻

🔌 Plugins runner — plugins.ts

// packages/compiler/src/plugins.ts
import type { BridgePlugin, IR1, UiIR } from "./types";
import type { CompilerContext } from "./context";

export function runOnModulePlugins(ctx: CompilerContext, ir1: IR1): IR1 {
let cur = ir1;
ctx.opts.plugins?.forEach(p => {
const next = p.onModule?.(cur, {
fileId: cur.fileId,
hash: (s) => stableHash(s),
report: (d) => ctx.report(d),
readAst: () => ctx.getAST(cur.fileId),
getMeta: () => cur,
});
if (next) cur = next;
});
return cur;
}

export function runUiPlugins(ctx: CompilerContext, ui: UiIR): UiIR {
let cur = ui;
ctx.opts.plugins?.forEach(p => {
const next = p.transformUI?.(cur, {
fileId: cur.fileId,
hash: (s) => stableHash(s),
report: (d) => ctx.report(d),
readAst: () => ctx.getAST(cur.fileId),
getMeta: () => ctx.getIR1(cur.fileId)!,
});
if (next) cur = next;
});
return cur;
}

function stableHash(s: string): string {
let h = 2166136261 >>> 0;
for (let i = 0; i < s.length; i++) {
h ^= s.charCodeAt(i);
h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
}
return (h >>> 0).toString(36);
}

⸻

🚀 Pipeline orchestrator — pipeline.ts

// packages/compiler/src/pipeline.ts
import type { CompilerContext } from "./context";
import type { FileId, CompileArtifact } from "./types";
import { parseModule, collectIR1 } from "./frontend";
import { toUiIR } from "./toUiIR";
import { runOnModulePlugins, runUiPlugins } from "./plugins";

import { constFold } from "./passes/constFold";
import { normalizeControlFlow } from "./passes/controlFlow";
import { a11yPass } from "./passes/a11y";
import { cssCollectPass } from "./passes/cssPass";
import { injectReactivityHints } from "./passes/reactivityHints";

import { emitSSR } from "./codegen/emitSSR";
import { emitCSR } from "./codegen/emitCSR";

export async function compileFile(ctx: CompilerContext, fileId: FileId): Promise<CompileArtifact> {
const ast = await parseModule(ctx, fileId);
const ir1 = collectIR1(ctx, fileId, ast);
const ir1P = runOnModulePlugins(ctx, ir1);

// Lower JSX → UI IR
let ui = toUiIR(ctx, fileId, ir1P, ast);

// Pass pipeline (order matters)
ui = constFold(ui);
ui = normalizeControlFlow(ui);
ui = injectReactivityHints(ui);
ui = cssCollectPass(ui);
ui = runUiPlugins(ctx, ui);
ui = a11yPass(ui, (d) => ctx.report(d));

// Emit
const ssr = emitSSR(ui);
const csr = emitCSR(ui);

return {
ssr,
csr,
diagnostics: ctx.diagnostics,
manifest: {}, // fill later
};
}

⸻

✅ How to use the skeleton

// packages/compiler/examples/build.ts
import { CompilerContext } from "../src/context";
import { compileFile } from "../src/pipeline";

(async () => {
const ctx = new CompilerContext({ cwd: process.cwd(), dev: true, plugins: [] });
const out = await compileFile(ctx, "/abs/path/to/src/pages/Home.tsx");
console.log(out.ssr?.code);
console.log(out.csr?.code);
console.table(ctx.diagnostics);
})();
