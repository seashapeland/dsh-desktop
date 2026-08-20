/**
 * dsh-deepseek-balance — client half (browser).
 *
 * Registers one Settings page (`settings.section`, id `deepseek-balance`)
 * modeled on the official platform.deepseek.com usage page:
 *
 *   - header "用量信息" + the GMT+8 / 5-minute-delay note
 *   - 充值余额 (real, from the balance route) with availability badge
 *   - 累计消费金额 / 消费金额 / API 请求次数 / Tokens — filled from the usage
 *     route when DeepSeek exposes one, otherwise shown as unavailable with a
 *     link to the platform page (DeepSeek currently documents no usage API
 *     keyed by API key, so the host probes and reports `available:false`)
 *   - per-model breakdown card when usage data is present
 *
 * The bundle also injects a small stylesheet rule that gives this section's
 * settings-nav cell its own icon: the shell gives every non-shipped section
 * the same gear as 通用设置, and the section id is not on a shipped icon
 * allow-list, so the rule targets the last nav cell structurally.
 *
 * Bundle format follows the DSH client-modules contract: the factory is a
 * lazy CJS module materialized by `window.__ModuleLoader__`, seed words
 * resolve to shell-own modules (react, ...), and the plugin face is
 * `exports.apply` + `exports.inject`.
 */
window.__ModuleLoader__.load({
	id: "dsh-deepseek-balance",
	factory: (require) => {
		"use strict";
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		//#region dsh-deepseek-balance/usage.module.css
		const css = ".dsb_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:14px;display:flex}.dsb_heading{margin:0;font-size:18px;font-weight:600}.dsb_note{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}.dsb_status{min-height:0}.dsb_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;flex-direction:column;display:flex}.dsb_cardTitle{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;line-height:18px;letter-spacing:.02em;padding:16px 20px 0}.dsb_rows{flex-direction:column;padding:4px 20px 14px;display:flex}.dsb_row{align-items:center;gap:12px;padding:11px 0;display:flex}.dsb_row+.dsb_row{box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}.dsb_rowLabel{color:var(--dsw-alias-label-secondary);flex:1;min-width:0;font-size:13px;line-height:20px}.dsb_rowBadge{white-space:nowrap;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;line-height:17px}.dsb_rowBadgeOk{background:color-mix(in srgb, var(--dsw-alias-state-success-primary) 14%, transparent);color:var(--dsw-alias-state-success-primary)}.dsb_rowBadgeBad{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 14%, transparent);color:var(--dsw-alias-state-error-primary)}.dsb_rowValue{font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px}.dsb_rowValueMuted{color:var(--dsw-alias-label-tertiary);font-weight:400}.dsb_rowCurrency{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}.dsb_unavailableHint{color:var(--dsw-alias-label-tertiary);border-top:1px solid var(--dsw-alias-border-l2);margin:0;padding:12px 20px 16px;font-size:12px;line-height:18px}.dsb_modelCard{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:14px;flex-direction:column;display:flex}.dsb_modelHead{align-items:baseline;gap:10px;padding:14px 20px 0;display:flex}.dsb_modelName{color:var(--dsw-alias-label-primary);flex:1;min-width:0;font-size:14px;font-weight:600;line-height:22px;overflow-wrap:anywhere}.dsb_modelSpend{font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:20px}.dsb_foot{align-items:center;gap:10px;flex-wrap:wrap;display:flex}.dsb_updated{color:var(--dsw-alias-label-tertiary);flex:1;min-width:0;font-size:12px;line-height:18px}.dsb_button{border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;background:var(--dsw-alias-bg-layer-1);border-radius:8px;align-items:center;gap:6px;padding:5px 14px;font-size:13px;line-height:20px;display:inline-flex}.dsb_button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dsb_button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}.dsb_button:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}.dsb_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}.dsb_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-fill)}.dsb_link{color:var(--dsw-alias-label-secondary);font:inherit;text-decoration:underline;text-decoration-color:var(--dsw-alias-label-quaternary);text-underline-offset:3px;cursor:pointer;background:0 0;border:none;padding:4px 2px;font-size:13px;line-height:20px}.dsb_link:hover{color:var(--dsw-alias-label-primary);text-decoration-color:currentColor}.dsb_link:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px;border-radius:4px}.dsb_alert{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;flex-direction:column;gap:8px;padding:14px 16px;display:flex}.dsb_alertWarn{border-color:var(--dsw-alias-state-warn-secondary);background:var(--dsw-alias-state-warn-tertiary)}.dsb_alertError{border-color:var(--dsw-alias-state-error-primary)}.dsb_alertTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:22px}.dsb_alertBody{color:var(--dsw-alias-label-secondary);margin:0;font-size:13px;line-height:20px;overflow-wrap:anywhere}.dsb_alertBody[data-code]{color:var(--dsw-alias-state-error-primary)}.dsb_loading{color:var(--dsw-alias-label-tertiary);align-items:center;gap:8px;font-size:13px;line-height:20px;display:flex}.dsb_spinner{box-sizing:border-box;border:1.5px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-state-business-primary);border-radius:50%;flex:none;width:12px;height:12px;animation:.7s linear infinite dsb_spin}@keyframes dsb_spin{to{transform:rotate(360deg)}}/* settings-nav icon: the shell falls back to the gear for every non-shipped section id; give ours a usage/chart glyph via mask (structural selector: last nav cell, first span = the icon seat). */[role=dialog] nav>div:last-child>button:last-child>span:first-child svg{display:none}[role=dialog] nav>div:last-child>button:last-child>span:first-child{width:16px;height:16px;flex:none;background-color:var(--dsw-alias-label-primary);-webkit-mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='2' y='8' width='3' height='6' rx='1'/%3E%3Crect x='6.5' y='4.5' width='3' height='9.5' rx='1'/%3E%3Crect x='11' y='1.5' width='3' height='12.5' rx='1'/%3E%3C/svg%3E\") center/16px 16px no-repeat;mask:url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Crect x='2' y='8' width='3' height='6' rx='1'/%3E%3Crect x='6.5' y='4.5' width='3' height='9.5' rx='1'/%3E%3Crect x='11' y='1.5' width='3' height='12.5' rx='1'/%3E%3C/svg%3E\") center/16px 16px no-repeat}";
		const tagId = "dsh-deepseek-balance/usage.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-deepseek-balance";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		//#endregion
		//#region dsh-deepseek-balance/view.js
		/** Same-origin routes the host half mounts (see lib/index.js). */
		const BALANCE_ROUTE = "/dsh-deepseek-balance/api/balance";
		const USAGE_ROUTE = "/dsh-deepseek-balance/api/usage";
		/** The DeepSeek platform billing/usage pages. */
		const PLATFORM_USAGE_URL = "https://platform.deepseek.com/usage";
		const PLATFORM_BALANCE_URL = "https://platform.deepseek.com";
		/** Auto-refresh interval while the section is mounted (ms). */
		const REFRESH_INTERVAL_MS = 60000;
		/** Currency code → symbol map for display; unknown codes fall back to the code itself. */
		const CURRENCY_SYMBOLS = {
			CNY: "¥",
			CNH: "¥",
			USD: "$",
			EUR: "€",
			GBP: "£",
			JPY: "¥",
			HKD: "HK$"
		};
		/**
		* Format an API-provided amount string for display.
		* @param value - the raw string (e.g. "110.00"), or null/undefined.
		* @returns the formatted number, or "—" when absent.
		*/
		function formatAmount(value) {
			if (typeof value !== "string" && typeof value !== "number") return "—";
			const parsed = Number(value);
			if (!Number.isFinite(parsed)) return String(value);
			return parsed.toLocaleString(void 0, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2
			});
		}
		/**
		* Format an integer-ish count (requests / tokens).
		* @param value - the raw count.
		* @returns the grouped number, or "—" when absent.
		*/
		function formatCount(value) {
			const parsed = Number(value);
			return Number.isFinite(parsed) ? parsed.toLocaleString(void 0, { maximumFractionDigits: 0 }) : "—";
		}
		/**
		* Render a currency symbol for a currency code.
		* @param code - the API's currency code (e.g. "CNY").
		* @returns the display symbol.
		*/
		function currencyOf(code) {
			return typeof code === "string" && code.length > 0 ? CURRENCY_SYMBOLS[code] ?? `${code} ` : "";
		}
		/**
		* Render the checked-at timestamp in the active locale.
		* @param epochMs - `Date.now()` value from the host payload.
		* @param t - locale-bound string function.
		* @returns the localized time string.
		*/
		function formatCheckedAt(epochMs, t) {
			if (typeof epochMs !== "number" || !Number.isFinite(epochMs)) return t("unknown");
			const date = new Date(epochMs);
			const time = date.toLocaleTimeString(void 0, {
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			});
			const day = date.toLocaleDateString(void 0, {
				month: "2-digit",
				day: "2-digit"
			});
			return `${day} ${time}`;
		}
		/** First defined value among the candidates, else undefined. */
		function firstOf(...candidates) {
			for (const candidate of candidates) {
				if (candidate !== void 0 && candidate !== null && candidate !== "") return candidate;
			}
			return void 0;
		}
		/**
		* Best-effort normalization of a hypothetical usage payload into
		* per-model rows. DeepSeek exposes no usage endpoint today; when one
		* ships, this tries to map whatever shape it has onto the official
		* template's fields (model / spend / requests / tokens).
		* @param data - the raw usage JSON.
		* @returns `{ rows, totals }` or `null` when nothing recognizable.
		*/
		function normalizeUsage(data) {
			if (typeof data !== "object" || data === null) return null;
			const entries = Array.isArray(data) ? data
				: Array.isArray(data.data) ? data.data
				: typeof data === "object" && Object.values(data).some((v) => typeof v === "object" && v !== null && !Array.isArray(v))
					? Object.entries(data).map(([key, value]) => ({ ...(typeof value === "object" && value !== null ? value : {}), model: key }))
					: [];
			const rows = [];
			for (const entry of entries) {
				if (typeof entry !== "object" || entry === null) continue;
				const usage = entry.usage && typeof entry.usage === "object" ? entry.usage : {};
				const model = firstOf(entry.model, entry.model_name, entry.id, entry.name, entry.slug);
				if (model === void 0 && Object.keys(entry).length === 0) continue;
				const spend = firstOf(entry.cost, entry.spend, entry.amount, entry.total_cost, entry.total_spend, entry.spend_amount, usage.total_cost, usage.cost);
				const requests = firstOf(entry.requests, entry.request_count, entry.total_requests, entry.n_requests, entry.count, usage.requests, usage.total_requests);
				let tokens = firstOf(entry.total_tokens, entry.tokens, usage.total_tokens);
				if (tokens === void 0 && Number.isFinite(Number(usage.prompt_tokens)) && Number.isFinite(Number(usage.completion_tokens))) {
					tokens = Number(usage.prompt_tokens) + Number(usage.completion_tokens);
				}
				rows.push({
					model: model === void 0 ? "—" : String(model),
					spend,
					requests,
					tokens
				});
			}
			if (rows.length === 0) {
				const totals = {
					spend: firstOf(data.total_cost, data.total_spend, data.total_usage, data.cost, data.spend, data.amount),
					requests: firstOf(data.total_requests, data.request_count, data.requests, data.count),
					tokens: firstOf(data.total_tokens, data.tokens, data.total_usage?.total_tokens)
				};
				if (totals.spend === void 0 && totals.requests === void 0 && totals.tokens === void 0) return null;
				return { rows: [], totals };
			}
			const totals = {
				spend: firstOf(data.total_cost, data.total_spend, data.total_usage, data.cost, data.spend),
				requests: firstOf(data.total_requests, data.request_count, data.requests),
				tokens: firstOf(data.total_tokens, data.tokens)
			};
			return { rows, totals };
		}
		/** Build one stat row (label + optional badge + value + optional currency code). */
		function StatRow(props) {
			return react.createElement("div", { className: "dsb_row" },
				react.createElement("span", { className: "dsb_rowLabel" }, props.label),
				props.badge !== void 0 ? react.createElement("span", { className: props.badgeOk ? "dsb_rowBadge dsb_rowBadgeOk" : "dsb_rowBadge dsb_rowBadgeBad", role: "status" }, props.badge) : null,
				react.createElement("span", { className: props.muted ? "dsb_rowValue dsb_rowValueMuted" : "dsb_rowValue" }, props.value),
				props.currency !== void 0 ? react.createElement("span", { className: "dsb_rowCurrency" }, props.currency) : null
			);
		}
		/**
		* The usage/balance page body modeled on platform.deepseek.com/usage.
		* @param props - slot-composed props (`t` from the locale seat; `close` from the settings shell).
		* @returns the settings section content.
		*/
		function UsageSection(props) {
			const { t } = props;
			const [view, setView] = react.useState({ phase: "loading" });
			const load = react.useCallback(() => {
				let cancelled = false;
				setView((previous) => previous.phase === "ready" ? { phase: "loading", previous } : { phase: "loading" });
				Promise.all([
					fetch(BALANCE_ROUTE, { cache: "no-store" }).then((r) => r.text()),
					fetch(USAGE_ROUTE, { cache: "no-store" }).then((r) => r.text())
				]).then(([balanceText, usageText]) => {
					if (cancelled) return;
					const parse = (text) => {
						try {
							return JSON.parse(text);
						} catch {
							return null;
						}
					};
					const balance = parse(balanceText);
					const usage = parse(usageText);
					setView({
						phase: "ready",
						balance: balance ?? { ok: false, code: "BAD_RESPONSE" },
						usage: usage ?? { ok: false, code: "BAD_RESPONSE" }
					});
				}).catch((error) => {
					if (cancelled) return;
					setView({
						phase: "ready",
						balance: { ok: false, code: "CLIENT_NETWORK", message: error instanceof Error ? error.message : String(error) },
						usage: null
					});
				});
				return () => {
					cancelled = true;
				};
			}, []);
			react.useEffect(() => {
				const cancel = load();
				const timer = setInterval(load, REFRESH_INTERVAL_MS);
				return () => {
					cancel();
					clearInterval(timer);
				};
			}, [load]);
			return react.createElement("div", { className: "dsb_section" },
				react.createElement("h2", { className: "dsb_heading" }, t("title")),
				react.createElement("p", { className: "dsb_note" }, t("note")),
				renderBody(view, t, load)
			);
		}
		/** Render the loading, alert, or ready body for the current view. */
		function renderBody(view, t, load) {
			if (view.phase === "loading") {
				return react.createElement("div", { className: "dsb_status" },
					react.createElement("div", { className: "dsb_loading", role: "status" },
						react.createElement("span", { className: "dsb_spinner", "aria-hidden": "true" }),
						react.createElement("span", null, t("checking"))
					)
				);
			}
			const balance = view.balance;
			if (balance === null || balance.ok !== true) {
				const code = balance?.code;
				const isWarn = code === "NO_KEY";
				const title = code === "NO_KEY" ? t("noKeyTitle") : code === "UPSTREAM" ? t("upstreamTitle") : t("errorTitle");
				return react.createElement("div", { className: "dsb_status" },
					react.createElement("div", { className: isWarn ? "dsb_alert dsb_alertWarn" : "dsb_alert dsb_alertError", role: "status" },
						react.createElement("div", { className: "dsb_alertTitle" }, title),
						react.createElement("p", { className: "dsb_alertBody" }, String(balance?.message ?? t("errorBody"))),
						react.createElement("button", { type: "button", className: "dsb_button", onClick: load }, t("refresh"))
					)
				);
			}
			const currency = currencyOf(balance.currency);
			const available = balance.isAvailable === true;
			const usage = normalizeUsage(view.usage?.ok === true && view.usage.available === true ? view.usage.data : null);
			const checkedAt = firstOf(balance.checkedAt, view.usage?.checkedAt);
			return react.createElement(react.Fragment, null,
				react.createElement("div", { className: "dsb_card" },
					react.createElement("div", { className: "dsb_rows" },
						react.createElement(StatRow, {
							label: t("recharged"),
							badge: available ? t("available") : t("unavailable"),
							badgeOk: available,
							value: `${currency}${formatAmount(balance.toppedUpBalance)}`,
							currency: balance.currency
						}),
						react.createElement(StatRow, {
							label: t("totalSpend"),
							value: usage !== null && usage.totals?.spend !== void 0 ? `${currency}${formatAmount(usage.totals.spend)}` : t("unavailable"),
							muted: usage === null || usage.totals?.spend === void 0,
							currency: usage !== null && usage.totals?.spend !== void 0 ? balance.currency : void 0
						}),
						react.createElement(StatRow, {
							label: t("spend"),
							value: usage !== null && usage.totals?.spend !== void 0 ? `${currency}${formatAmount(usage.totals.spend)}` : t("unavailable"),
							muted: usage === null || usage.totals?.spend === void 0,
							currency: usage !== null && usage.totals?.spend !== void 0 ? balance.currency : void 0
						}),
						react.createElement(StatRow, {
							label: t("requests"),
							value: usage !== null && usage.totals?.requests !== void 0 ? formatCount(usage.totals.requests) : t("unavailable"),
							muted: usage === null || usage.totals?.requests === void 0
						}),
						react.createElement(StatRow, {
							label: t("tokens"),
							value: usage !== null && usage.totals?.tokens !== void 0 ? formatCount(usage.totals.tokens) : t("unavailable"),
							muted: usage === null || usage.totals?.tokens === void 0
						}),
						Number(balance.grantedBalance) > 0 ? react.createElement(StatRow, {
							label: t("granted"),
							value: `${currency}${formatAmount(balance.grantedBalance)}`,
							currency: balance.currency
						}) : null
					)
				),
				usage !== null && usage.rows.length > 0 ? react.createElement(react.Fragment, null,
					usage.rows.map((row, index) => react.createElement("div", { key: index, className: "dsb_modelCard" },
						react.createElement("div", { className: "dsb_modelHead" },
							react.createElement("span", { className: "dsb_modelName" }, row.model),
							react.createElement("span", { className: "dsb_modelSpend" },
								row.spend !== void 0 ? `${t("spend")}（${balance.currency ?? "CNY"}） ${currency}${formatAmount(row.spend)}` : ""
							)
						),
						react.createElement("div", { className: "dsb_rows" },
							react.createElement(StatRow, { label: t("requests"), value: row.requests !== void 0 ? formatCount(row.requests) : "—", muted: row.requests === void 0 }),
							react.createElement(StatRow, { label: t("tokens"), value: row.tokens !== void 0 ? formatCount(row.tokens) : "—", muted: row.tokens === void 0 })
						)
					))
				) : react.createElement("div", { className: "dsb_card" },
					react.createElement("div", { className: "dsb_cardTitle" }, t("usageTitle")),
					react.createElement("p", { className: "dsb_unavailableHint" }, t("usageUnavailable"))
				),
				react.createElement("div", { className: "dsb_foot" },
					react.createElement("span", { className: "dsb_updated" }, `${t("updated")} ${formatCheckedAt(checkedAt, t)}`),
					react.createElement("a", { className: "dsb_button dsb_primary", href: PLATFORM_USAGE_URL, target: "_blank", rel: "noreferrer" }, t("openUsage")),
					react.createElement("a", { className: "dsb_link", href: PLATFORM_BALANCE_URL, target: "_blank", rel: "noreferrer" }, t("openBalance")),
					react.createElement("button", { type: "button", className: "dsb_button", onClick: load }, t("refresh"))
				)
			);
		}
		//#endregion
		//#region dsh-deepseek-balance/locales.js
		/** English copy. */
		const en = {
			nav: "DeepSeek Usage",
			title: "Usage",
			note: "All dates are shown in GMT+8; data may be delayed by up to 5 minutes.",
			recharged: "Recharged balance",
			totalSpend: "Total spend",
			spend: "Spend",
			requests: "API requests",
			tokens: "Tokens",
			granted: "Granted balance",
			available: "Available",
			unavailable: "Unavailable",
			usageTitle: "Usage details",
			usageUnavailable: "DeepSeek does not currently expose per-key usage (spend, requests, tokens) through its API — those figures are only visible on platform.deepseek.com. If DeepSeek adds an endpoint, this page will show them automatically.",
			refresh: "Refresh",
			checking: "Checking…",
			updated: "Updated",
			unknown: "unknown",
			openUsage: "View usage on platform.deepseek.com",
			openBalance: "Balance & top-up",
			noKeyTitle: "No API key configured",
			upstreamTitle: "DeepSeek API returned an error",
			errorTitle: "Could not load data",
			errorBody: "The local service failed. Try refreshing."
		};
		/** Simplified Chinese copy. */
		const zh = {
			nav: "DeepSeek 用量",
			title: "用量信息",
			note: "所有日期均按 GMT+8 时间显示，数据可能有 5 分钟延迟。",
			recharged: "充值余额",
			totalSpend: "累计消费金额",
			spend: "消费金额",
			requests: "API 请求次数",
			tokens: "Tokens",
			granted: "赠送余额",
			available: "可用",
			unavailable: "不可用",
			usageTitle: "用量明细",
			usageUnavailable: "DeepSeek 官方暂未开放按 API Key 查询用量（消费金额、请求次数、Tokens 仅能在 platform.deepseek.com 网页查看）。若官方开放接口，本页面会自动显示。",
			refresh: "刷新",
			checking: "查询中…",
			updated: "更新于",
			unknown: "未知",
			openUsage: "前往 platform.deepseek.com 查看用量",
			openBalance: "余额与充值",
			noKeyTitle: "尚未配置 API Key",
			upstreamTitle: "DeepSeek API 返回错误",
			errorTitle: "数据加载失败",
			errorBody: "本地服务异常，请重试。"
		};
		//#endregion
		//#region dsh-deepseek-balance/index.js
		/**
		* Dictionary namespace owned by this plugin.
		*/
		const NS = "dsh-deepseek-balance";
		/** Required client services (the runtime parks this plugin until they exist). */
		const inject = ["slots", "locale"];
		/**
		* Mount the usage page once the `settings.section` declaration is on the ledger.
		* `order: 90` keeps this section last in the settings nav, which the
		* icon stylesheet rule targets structurally (last nav cell).
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-deepseek-balance: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "deepseek-balance",
				order: 90,
				label: () => t("nav"),
				locale: NS
			}, UsageSection));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map
