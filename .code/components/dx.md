Perfect — that’s the right choice. Using .tsx / .ts keeps things familiar, portable, and toolchain-friendly, while our framework’s compiler can still do static analysis and optimizations under the hood (similar to how Svelte/Solid compile JSX).

Let’s refine the system around that decision.

⸻

🧩 Framework: Updated Design Philosophy

Developers write pure TypeScript/TSX code — no custom syntax or .nova files.

Our framework acts as a compiler + runtime layer that transforms this TypeScript code into optimized JavaScript and DOM operations.

We achieve:
	•	✅ Full compatibility with existing editors (VSCode, IntelliSense, etc.)
	•	✅ Familiar syntax (JSX/TSX)
	•	✅ Minimal runtime overhead via build-time compilation

⸻

🔹 1. Developer Experience Overview

// main.tsx
import { createApp } from "nova";
import { Page } from "./pages/Home";

createApp({
  root: "#app",
  page: Page,
  load: async () => {
    const res = await fetch("/api/home");
    return await res.json();
  },
});

Page Definition

// pages/Home.tsx
import { usePageData } from "nova";
import { Header } from "../components/Header";
import { FeatureList } from "../components/FeatureList";
import { Footer } from "../components/Footer";

export function Page() {
  const data = usePageData<{ title: string; features: string[]; year: number }>();

  return (
    <main class="mx-auto max-w-3xl p-6">
      <Header title={data.title} />
      <FeatureList items={data.features} />
      <Footer year={data.year} />
    </main>
  );
}

All the developer writes is regular TypeScript + JSX.
Our compiler transforms it at build time to optimized DOM instructions.

⸻

🔹 2. Component Example

// components/Header.tsx
import { defineComponent } from "nova";

export const Header = defineComponent<{ title: string }>(({ title }) => {
  return (
    <header class="py-4 border-b border-gray-200">
      <h1 class="text-3xl font-bold text-gray-800">{title}</h1>
    </header>
  );
});

	•	defineComponent() gives compiler hints for optimization.
	•	No need for React import or VDOM diffing.
	•	Compiler outputs pure DOM instructions with scoped reactivity.

⸻

🔹 3. Internal Flow (How It Works)

At Build Time:
	1.	The compiler scans .tsx files for createApp(), usePageData(), and defineComponent().
	2.	It:
	•	Extracts the static DOM tree.
	•	Converts JSX to direct DOM creation instructions.
	•	Identifies reactive dependencies.
	•	Optimizes for hydration (if load() is used).
	3.	It emits JS that looks roughly like:

import { createElement, insert, text } from "nova/runtime";
export function Header({ title }) {
  const el = createElement("header", { class: "py-4 border-b" });
  insert(el, text(title));
  return el;
}

→ No virtual DOM. Just direct, efficient DOM ops.

At Runtime:
	•	The runtime runs the load() function (on client or SSR).
	•	Injects data into a context accessible via usePageData().
	•	Renders the component tree to the DOM.
	•	Hooks up reactive bindings only where needed.

⸻

🔹 4. Developer API Summary

createApp(config: CreateAppConfig)

interface CreateAppConfig {
  root: string;
  page: Component;
  load?: () => Promise<any>;
  onError?: (err: Error) => void;
  ssr?: boolean;
}

Bootstraps the app, handles SSR hydration automatically.

⸻

usePageData<T>()

function usePageData<T = any>(): T;

Returns the initial or reactive data for the current page.

⸻

defineComponent<Props>(fn: (props: Props) => JSX.Element)

Optional — used to give the compiler optimization metadata.

⸻

useSignal, useStore (planned)

Lightweight reactivity primitives:

const count = useSignal(0);
<button onClick={() => count.set(count() + 1)}>{count()}</button>


⸻

🔹 5. Developer Control Example (With Conditional UI)

export function Page() {
  const data = usePageData<{ features: string[]; year: number }>();

  return (
    <>
      {data.features?.length > 0 && <FeatureList items={data.features} />}
      <Footer year={data.year} />
    </>
  );
}

The compiler understands the conditional and only generates DOM creation for the relevant branch.
No runtime diffing.

⸻

🔹 6. How CSS Integration Works

Since developers use standard TSX:
	•	Tailwind, CSS Modules, and global CSS all work directly.
	•	No runtime style injection or CSS-in-JS overhead.
	•	The compiler can tree-shake unused class names (if Tailwind JIT plugin enabled).

⸻

🔹 7. DX Enhancements to Plan Later

Feature	Description
🔁 HMR	Rebuild only changed component, retain state
🧠 IntelliSense	Provide types for usePageData and load()
⚙️ CLI	nova build, nova dev, nova analyze
🧩 Plugin API	Add support for Markdown pages, GraphQL loaders, etc.
🧪 SSR Compiler	Pre-render page into HTML with serialized data for hydration


⸻

🔹 8. Example: SSR + Client Hydration

createApp({
  root: "#app",
  page: Page,
  ssr: true,
  load: async () => fetch("/api/home").then(r => r.json()),
});

The compiler emits:
	•	Server-side HTML template (via static analysis)
	•	Data serialization block (<script type="nova-data">)
	•	Client-side bootstrap script to hydrate without re-rendering

⸻

✅ Summary of This Design

Aspect	Approach
Syntax	Pure .tsx / .ts
Rendering	Compile-time → DOM ops
Reactivity	Fine-grained signals
Data handling	load() + usePageData()
Optimization	Static tree flattening, zero VDOM
DX	Familiar JSX + auto types
CSS support	Works with Tailwind and any CSS framework
