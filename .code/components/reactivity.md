# Reactivity System Design — BridgeJS (signals-based)

Nicely chosen — building a small, predictable, and efficient signals-style reactivity system gives us fine-grained updates, tiny runtime, and deterministic SSR hydration. Below is a complete design: API, internals, lifecycle, SSR/hydration integration, performance considerations, debugging tools and migration tips. I’ll include TypeScript-style types and example code you can slot into the compiler/runtime.

⸻

1. Design goals (short)
	•	Fine-grained updates: update only nodes that read changed values.
	•	Tiny runtime: minimal bytes, no VDOM.
	•	Predictable dependency tracking: explicit reads record dependencies automatically.
	•	Deterministic SSR: same dependency graph can be reconstructed on client for hydration.
	•	Composability: signals, computed, derived, stores, resources, effects.
	•	Batching & scheduling: microtask batching to coalesce changes.
	•	Debuggable: devtools hooks and introspection APIs.

⸻

2. Core concepts & API

Primitives (developer-facing)

// create a primitive signal
const [count, setCount] = createSignal<number>(0);

// read a signal (getter)
count();        // returns number

// update (setter)
setCount(1);    // triggers effects

// derived/computed
const double = createComputed(() => count() * 2);

// effect (react to changes)
const disposer = createEffect(() => {
  console.log("count changed", count());
});

// store (structured reactive object)
const user = createStore({ name: "Ravi", age: 30 });
user.name = "Rav";            // triggers readers

// async resource (SSR-aware)
const posts = createResource(async () => fetch("/api/posts").then(r=>r.json()));

// stop an effect
disposer();

TypeScript signatures (sketch)

type Getter<T> = () => T;
type Setter<T> = (value: T | ((prev:T)=>T)) => void;

declare function createSignal<T>(initial: T): [Getter<T>, Setter<T>];

declare function createComputed<T>(fn: () => T): Getter<T>;

declare function createEffect(fn: () => void | (() => void)): () => void;

declare function createStore<T extends Record<string, any>>(initial: T): T;

declare function createResource<T>(fetcher: ()=> Promise<T>, opts?: ResourceOptions): Resource<T>;


⸻

3. Internal model — dependency graph
	•	Node: represents a reactive producer or consumer. Types: SignalNode, ComputedNode, EffectNode, ResourceNode.
	•	Each node has:
	•	id (unique)
	•	value
	•	subscribers (set of consumer node ids)
	•	dependencies (set of producer node ids; computed/effect nodes)
	•	version / seq (monotonic number to detect staleness)
	•	cleanup (for effects)
	•	Graph invariants:
	•	Producers (signals) never depend on consumers.
	•	Computeds and effects depend on producers/computeds; cycles are detected at creation time (warn/error).

Dependency creation is automatic: while running a tracked function (computed/effect), the runtime records which signals were read; it then registers the function node as a subscriber to those signals.

⸻

4. Implementation sketch (core algorithms)

4.1 createSignal
	•	Create a SignalNode with value, empty subscribers.
	•	getter() returns the node value and, if a trackingContext is active, records trackingContext.deps.add(thisNode).
	•	setter(v) updates node value, increments version, and schedules notifications: push node into pendingSignals queue.

4.2 createEffect
	•	Create EffectNode with fn, dependencies = new Set().
	•	runEffect(node):
	1.	cleanup previous subscriptions: unsubscribe node from each previous dependency.
	2.	set trackingContext.current = node.
	3.	call fn() (capture reads).
	4.	set trackingContext.current = null.
	5.	subscribe node to all recorded dependencies.
	•	Effects are scheduled to run after a batch of setters (microtask).

4.3 createComputed
	•	Similar to effect, but lazily evaluated and memoized:
	•	On first read, evaluate, track dependencies, subscribe.
	•	When any dependency invalidates, mark computed as stale and notify its subscribers (other computeds or effects).
	•	Recompute on next read or when a subscriber needs it.

4.4 Notification & Batching
	•	pendingSignals: Set<SignalNode> collects changed producers.
	•	On first setter in an event tick, schedule a microtask (Promise.resolve().then(flush)).
	•	flush():
	1.	Build changedSet from pendingSignals.
	2.	Do a topological-ish traversal to mark dependent computed nodes stale.
	3.	Recompute computeds necessary for effects or eager computed subscriptions (configurable).
	4.	Run effects whose dependencies changed (in insertion order or priority order).
	•	This ensures multiple set() calls in the same tick are coalesced.

4.5 Cycle detection
	•	When establishing dependencies for a computed/effect, check if adding an edge would create a cycle (DFS or timestamp comparison). If detected, throw or warn.

⸻

5. Stores (structured proxies)

createStore(obj) returns a proxied object where any property read/written maps to signals under the hood.

Implementation approach:
	•	For each path (user.name), maintain an internal SignalNode.
	•	Proxy traps:
	•	get: returns proxied nested object or getter() for primitives.
	•	set: call the corresponding setter() to update and trigger subscribers.
	•	Advantages:
	•	Familiar object mutation syntax.
	•	Fine-grained subscriptions per property.
	•	Consideration:
	•	Avoid creating signals for large numbers of paths eagerly — create lazily on first access.

⸻

6. Computed values & memoization
	•	Computeds are memoized values that track dependencies.
	•	Recompute only when stale and someone reads them.
	•	If computed has subscribers (e.g., another computed or an effect), recompute eagerly during flush to propagate changes deterministically.
	•	Computed exception handling: if compute throws, mark as errored; effects that depend on it receive exception and can handle or propagate.

⸻

7. Async resources (createResource)

Use cases: data fetching in SSR/CSR, suspense-like behavior.

API:

const posts = createResource(fetchPosts);
posts.read(); // If pending on client, may throw a special Promise (suspense), or return state

Design:
	•	Resource node holds { status: 'idle'|'loading'|'ready'|'error', value?, error? }
	•	On server:
	•	load() calls resources and awaits them during SSR pass (we run all resource fetchers that are referenced during render).
	•	Compiler/runtime marks resources referenced by page so SSR awaits them before render (or streams partials).
	•	On client:
	•	If SSR provided serialized data, resource resumes as ready.
	•	If not, fetch on first read; we support suspense (throw Promise) optional or a pending return.

Integration:
	•	createResource registers resource node; createEffect or computed can read resource.value to react.

⸻

8. SSR specifics & determinism

Key: server and client must build same dependency graph so hydration binds the same effects to DOM.

Approach:
	•	Deterministic evaluation: During SSR render we record dependency graph for any computed/effect created during render.
	•	Embed a dependency map optionally in serialized data (for debugging or complex hydration). Prefer smaller payloads: only serialize initial values and minimal markers for dynamic nodes in DOM (e.g., data-sig-id="42").
	•	On client hydration:
	•	Recreate signals and computed/effect nodes with the same ids (compiler can assign stable ids using file+pos hashes).
	•	Re-run the setup for computeds/effects in a “reconnect” mode that binds to existing DOM nodes instead of re-rendering.
	•	For resources: if SSR fetched some resources, serialize their value to avoid duplicate fetches on client.

Example serialization snippet:

<script type="nova-data" data-signals="...">
  {
    "__page": { title: "...", ... },
    "__resources": { posts: [...] }
  }
</script>


⸻

9. Hydration integration (how effects bind to DOM)

When compiler generates DOM, for dynamic parts it emits markers and attach points:

Example compiled fragment:

<h1 id="sig-12">Welcome</h1>
<ul id="sig-13">
  <li>Fast</li>
  <li>Accessible</li>
  <li>Tiny</li>
</ul>

During client boot:
	•	The runtime recreates signal nodes with ids 12 and 13 and installs effects that update textContent or patch child lists.
	•	Instead of creating new nodes, effects reference these existing DOM nodes.

This requires:
	•	Stable signal ids (from compile step).
	•	Metadata in emitted HTML to map nodes ↔ signal ids.

⸻

10. Scheduling & prioritization

We want the system to be responsive and avoid long tasks:
	•	Microtask batching for normal updates (uses Promise.resolve().then()).
	•	Idle callbacks for low-priority work (requestIdleCallback fallback).
	•	Priority levels:
	•	high — effect that updates visible UI (run in microtask).
	•	low — analytics, telemetry (run during idle).
	•	Provide API to schedule low-priority updates:

setCount(1, { priority: 'low' });


⸻

11. Memory management & GC
	•	Each node holds subscribers references. On component unmount, runtime must:
	•	Call effect cleanup
	•	Unsubscribe nodes from all producers
	•	Remove node from global registry (allow GC)
	•	For stores: remove created SignalNodes for properties that are no longer reachable (rare in SPA but possible for ephemeral objects) — implement weak maps where possible or explicit disposeStore().

⸻

12. Edge cases & error handling
	•	Concurrent updates: setters can be called inside effects. Our queue handles nested flush safely (re-entrancy guard).
	•	Long chains: deep dependency chains are resolved in order — we detect and limit recursion depth with warning.
	•	Cycles: detect cycles when establishing dependencies; provide clear error pointing to component/line (compiler can embed source mapping).
	•	Thrown errors in effects: bubble to onUnhandledError hook; effect cleanup still runs.

⸻

13. Devtools & debugging

Expose:
	•	inspectSignal(id) → returns { value, subscribers, dependencies }.
	•	subscribeGraph(change => ...) → emits graph change events.
	•	enableTracing() → records effect run times and signal update counts.
	•	__DEV__ friendly names: compiler emits human-friendly ids (file:line:col) to help map runtime nodes to source.
	•	Integrate with browser extension: show signal table, top hot signals, and a time-travel snapshot (optional).

⸻

14. Testing & determinism
	•	Unit tests: signals, computeds, and effects with deterministic runs (use fake timers for microtask).
	•	SSR tests: snapshot serialized data and ensure hydration reconstructs same graph.
	•	Integration tests: ensure updating nested store properties triggers only intended effects.

⸻

15. Migration guide (from React/Vue mental models)
	•	Replace useState with createSignal.
	•	Replace useEffect with createEffect — note createEffect runs synchronously after the microtask flush; if you need mount-only, pass onMount() wrapper.
	•	Stop thinking in terms of render re-runs: update is a change propagation to dependent readers.
	•	Components should avoid reading signals conditionally in ways that create/tear dependencies unpredictably across renders — the compiler can warn for read-order instability.

⸻

16. Example implementations (concise)

createSignal (pseudo)

let nextId = 1;
function createSignal(init) {
  const id = nextId++;
  let value = init;
  const subscribers = new Set();
  function getter() {
    const ctx = currentTracker();
    if (ctx) ctx.addDep(signalNode);
    return value;
  }
  function setter(v) {
    const next = typeof v === 'function' ? v(value) : v;
    if (next === value) return;
    value = next;
    signalNode.version++;
    pendingSignals.add(signalNode);
    scheduleFlush();
  }
  const signalNode = { id, type: 'signal', value: () => value, subscribers, version: 0 };
  return [getter, setter];
}

createEffect (pseudo)

function createEffect(fn) {
  const node = { id: nextId++, fn, deps: new Set(), cleanup: null };
  function run() {
    // cleanup subscriptions
    node.deps.forEach(d => d.subscribers.delete(node));
    node.deps.clear();
    startTracking(node);
    const maybeCleanup = fn();
    stopTracking();
    if (typeof maybeCleanup === 'function') node.cleanup = maybeCleanup;
    node.deps.forEach(d => d.subscribers.add(node));
  }
  run();
  return () => { node.deps.forEach(d=>d.subscribers.delete(node)); node.deps.clear(); if (node.cleanup) node.cleanup(); };
}


⸻

17. Performance targets & metrics
	•	Signal getter cost: O(1) addition to current tracking context.
	•	Setter cost: O(1) amortized to queue + O(#affected computeds/effects) during flush.
	•	Memory: per-signal node ≈ small object (couple dozen bytes); store lazily create signals.
	•	Targets:
	•	Typical interactive page: runtime < 8 KB gzipped for core reactivity.
	•	Updates: < 1 ms for small UI changes on mid-range devices.

⸻

18. Integration checklist for compiler/runtime
	•	Compiler must assign stable IDs for dynamic bindings (for hydration).
	•	Compiler emits DOM markers and signal ids in HTML.
	•	Ensure SSR records resource fetches and serializes results.
	•	Emit human-friendly debug names when NODE_ENV !== 'production'.

⸻

19. Summary / Quick reference
	•	Signals provide getters/setters.
	•	Computeds are lazy, memoized derived values.
	•	Effects subscribe to signals via implicit tracking.
	•	Stores are proxied objects built from signals.
	•	Resources are SSR-aware async data holders.
	•	Batching via microtask ensures efficient coalescing.
	•	Deterministic SSR+hydrate requires stable IDs and re-creation of same graph on client.

⸻
