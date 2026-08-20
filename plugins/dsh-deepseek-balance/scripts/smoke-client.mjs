/**
 * Smoke test for the client bundle: executes lib/client.js inside a fake
 * browser-ish environment (window.__ModuleLoader__, document, a stubbed
 * `require` for the seed words) and asserts the module body, the exported
 * plugin face, and the apply() registration path all work.
 *
 * Run: node scripts/smoke-client.mjs
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(here, "..", "lib", "client.js");
const bundle = readFileSync(bundlePath, "utf8");

/** Minimal react stub: the bundle only calls hooks at render time, which we never trigger. */
function reactStub() {
	return {
		useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
		useEffect: () => {},
		useCallback: (fn) => fn,
		useRef: () => ({ current: void 0 }),
		useId: () => "smoke-id",
		createElement: (...args) => ({ kind: "element", args })
	};
}

const factories = new Map();
const loadCalls = [];
globalThis.window = {
	__ModuleLoader__: {
		load(handoff) {
			loadCalls.push(handoff.id);
			factories.set(handoff.id, handoff.factory);
		}
	}
};
globalThis.document = {
	createElement: () => ({ dataset: {}, set textContent(_) {}, }),
	querySelector: () => null,
	head: { appendChild: () => {} }
};

const sandbox = {
	window: globalThis.window,
	document: globalThis.document
};
vm.createContext(sandbox);
vm.runInContext(bundle, sandbox, { filename: "client.js" });

if (loadCalls.length !== 1 || loadCalls[0] !== "dsh-deepseek-balance") {
	throw new Error(`bundle did not register exactly once under its id; got ${JSON.stringify(loadCalls)}`);
}

const factory = factories.get("dsh-deepseek-balance");
if (typeof factory !== "function") throw new Error("no factory registered");
const requireStub = (spec) => {
	if (spec === "react") return reactStub();
	if (spec === "react/jsx-runtime") return { jsx: () => ({ kind: "element" }), jsxs: () => ({ kind: "element" }), Fragment: "fragment" };
	throw new Error(`bundle required an unexpected seed word: ${spec}`);
};
const mod = factory(requireStub);

if (typeof mod.apply !== "function") throw new Error("exports.apply is not a function");
if (!Array.isArray(mod.inject)) throw new Error("exports.inject is not an array");
const required = mod.inject;
for (const service of ["slots", "locale"]) {
	if (!required.includes(service)) throw new Error(`exports.inject missing ${service}`);
}

/** Exercise apply(): fake ctx with the service surface the bundle touches. */
const injected = [];
const effectLabels = [];
let registered;
const fakeCtx = {
	locale: {
		bind: () => (key) => `t:${key}`,
		register: (ns, dicts) => {
			if (!dicts.zh || !dicts.en) throw new Error("locale.register without zh/en");
		}
	},
	slots: {
		// Mirrors the runtime: inject() defers the registration factory until the
		// target slot is declared; the factory (an arrow over the apply() ctx)
		// calls slots.register and returns a disposer.
		inject: (slotName, factoryFn) => {
			if (slotName !== "settings.section") throw new Error(`unexpected slot ${slotName}`);
			injected.push(factoryFn);
		},
		register: (options, component) => {
			registered = { options, component };
			return () => {};
		}
	},
	effect: (fn, label) => {
		effectLabels.push(label);
		const result = fn();
		if (typeof result === "function") return result;
		return () => {};
	}
};
mod.apply(fakeCtx);

if (injected.length !== 1) throw new Error(`expected 1 inject, got ${injected.length}`);
const dispose = injected[0]();
if (typeof dispose !== "function") throw new Error("registration factory did not return a disposer");
if (registered.options.name !== "settings.section") throw new Error(`wrong slot name ${registered.options.name}`);
if (registered.options.id !== "deepseek-balance") throw new Error(`wrong section id ${registered.options.id}`);
if (typeof registered.options.label !== "function" || registered.options.label() !== "t:nav") throw new Error("label thunk broken");
if (typeof registered.component !== "function") throw new Error("section component missing");
const entry = { name: registered.options.name, id: registered.options.id, order: registered.options.order, label: registered.options.label, component: registered.component, dispose };

console.log("client bundle smoke test: OK");
console.log("  registered:", entry.name, "id=", entry.id, "order=", entry.order);
console.log("  locale namespaces:", effectLabels.filter((l) => l.includes("dictionaries")));
