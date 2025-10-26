# Perfect — this is where the magic meets engineering discipline.

Let's design the runtime data flow for our framework step-by-step — covering how data moves from the server to client, how hydration works efficiently, and how reactivity ties it all together.

⸻

🧭 Runtime Architecture: SSR + Hydration + Reactivity

⸻

🔹 1. Core Design Goals

Goal	Description
⚡️ Instant interactivity	Pages should be interactive immediately after hydration, without full re-renders.
🧠 Single data model	One consistent data object — same on server and client.
🧩 Simple developer API	Developers just define load() and use usePageData().
💡 Fine-grained updates	DOM updates should happen only where data actually changes.
🧱 SSR built-in	No extra config — rendering on server and hydration just work.


⸻

🔹 2. The Data Flow — High-Level Diagram

        ┌──────────────────────────────┐
        │        Developer Code        │
        │ ───────────────────────────  │
        │ load()      Page.tsx         │
        └────┬─────────────────────────┘
             │
             ▼
   ┌───────────────────────┐
   │  SSR Runtime (Server) │
   │───────────────────────│
   │ 1. Run load()         │
   │ 2. Render <Page/>     │
   │ 3. Serialize HTML +   │
   │    JSON (pageData)    │
   └──────────┬────────────┘
              │
       HTML + <script data>
              │
              ▼
   ┌───────────────────────┐
   │ Client Runtime        │
   │───────────────────────│
   │ 1. Parse serialized   │
   │    data               │
   │ 2. Re-bind signals    │
   │ 3. Hydrate DOM (no    │
   │    full re-render)    │
   │ 4. Reactivity resumes │
   └───────────────────────┘


⸻

🔹 3. Server-Side Flow (SSR)

Step 1: Developer’s load()

When createApp() runs in server mode:

const data = await config.load?.();

	•	Runs once per request.
	•	Can fetch data from APIs, DB, or static JSON.

Step 2: Render Page

The runtime calls:

const html = renderToString(config.page, data);

	•	Each component is compiled to a DOM-string renderer.
	•	Reactivity system is in record-only mode — no subscriptions yet.
	•	The compiler pre-generates a static HTML skeleton with markers for dynamic nodes.

Example output:

<main>
  <header><h1>Welcome to Nova!</h1></header>
  <ul>
    <li>Fast</li>
    <li>Accessible</li>
    <li>Tiny</li>
  </ul>
  <footer>© 2025</footer>
</main>
<script type="nova-data">
  {"title":"Welcome to Nova!","features":["Fast","Accessible","Tiny"],"year":2025}
</script>

Step 3: Send HTML to client

⸻

🔹 4. Client-Side Flow (Hydration)

Step 1: Parse and Reuse Data

At boot, createApp() on client reads:

const el = document.querySelector("script[type='nova-data']");
const pageData = JSON.parse(el.textContent);

Then injects it into a reactive signal context:

const ctx = createReactiveContext(pageData);

All calls to usePageData() now return this shared reactive object.

⸻

Step 2: DOM Binding (Hydration)

Instead of re-rendering HTML, hydration:
	•	Traverses the pre-rendered DOM.
	•	Binds signal accessors to existing DOM nodes.
	•	Creates dependency graph (signal → DOM update function).

Example:

<h1>{data.title}</h1>

is compiled to:

const titleNode = dom.querySelector("#title");
effect(() => titleNode.textContent = data.title);

No virtual DOM, no diff — just direct binding.

⸻

Step 3: Reactive Updates

If a signal changes:

data.title = "Hello World";

→ The effect runs immediately, updating only that DOM node.

⸻

🔹 5. Reactivity System (Signals)

The reactivity layer is proxy-based, similar to SolidJS.

createSignal()

const [count, setCount] = createSignal(0);
setCount(count() + 1);

createReactiveContext(initialData)
	•	Converts pageData into nested reactive proxies.
	•	Tracks reads (for dependency collection).
	•	Triggers effects when data changes.

Example:

const data = usePageData();
data.features.push("Performant"); // triggers FeatureList re-render


⸻

🔹 6. Lifecycle in Detail

Phase	Server	Client
Init	Run load()	Parse SSR data or run load() again (CSR mode)
Render	renderToString(page, data)	hydrate(page, data)
Attach	Serialize data	Bind DOM nodes + setup effects
Interactive	N/A	Reactivity live, signals respond


⸻

🔹 7. Mixed Mode (SSR + CSR Fallback)

We support both:
	1.	SSR-first: Data comes from server-rendered payload.
	2.	CSR-only: No SSR — data fetched on client via load().

Runtime decides automatically:

if (document.querySelector("script[type='nova-data']")) hydrate();
else fetchAndRender();


⸻

🔹 8. Example Timeline (SSR Render to Interactive)

┌──────────────┬────────────────────────────────────┐
│ Timeline     │ Operation                           │
├──────────────┼────────────────────────────────────┤
│ T0           │ Server receives request              │
│ T1           │ load() executes                      │
│ T2           │ Page rendered to HTML string          │
│ T3           │ HTML sent to client                   │
│ T4           │ Browser parses HTML                   │
│ T5           │ Client runtime executes createApp()   │
│ T6           │ Hydration binds signals               │
│ T7           │ Page interactive                      │
└──────────────┴────────────────────────────────────┘


⸻

🔹 9. Future Optimizations

Optimization	Description
🪶 Partial Hydration	Only hydrate dynamic components, skip static ones.
🧩 Islands Architecture	Hydrate independent “islands” of interactivity.
📦 Streaming SSR	Stream HTML chunks as soon as they’re ready.
🧠 Predictive Prefetching	Preload next route data while idle.
🧩 Cross-page Signal Sync	Shared reactivity between tabs or routes.


⸻

✅ Summary

Layer	Responsibility
SSR Runtime	Runs load(), renders static HTML, serializes data
Client Runtime	Parses SSR data, hydrates existing DOM
Reactivity Layer	Manages fine-grained updates via proxy signals
Hydration Engine	Binds DOM nodes → signals, no re-render
Developer API	createApp, usePageData, defineComponent, useSignal

