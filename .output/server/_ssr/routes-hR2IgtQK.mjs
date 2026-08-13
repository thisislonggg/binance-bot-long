import { i as __toESM } from "../_runtime.mjs";
import { E as isRedirect, g as useRouter } from "../_libs/@tanstack/react-router+[...].mjs";
import { c as createServerFn, i as TSS_SERVER_FUNCTION } from "./createServerFn-CIHAFgYl.mjs";
import { a as fmtPct, c as liquidityLabel, i as confidenceLabel, n as biasLabel, o as fmtRp, s as fmtRp2, t as CFG } from "./p2p-engine-ZnsxIhXi.mjs";
import { i as stringType, n as numberType, r as objectType, t as arrayType } from "../_libs/zod.mjs";
import { o as require_jsx_runtime, r as Slot, s as require_react } from "../_libs/@radix-ui/react-collection+[...].mjs";
import { t as Root } from "../_libs/@radix-ui/react-label+[...].mjs";
import { t as useMutation } from "../_libs/tanstack__react-query.mjs";
import { t as getServerFnById } from "../__23tanstack-start-server-fn-resolver-DU1bpjAi.mjs";
import { a as RefreshCw, c as Gauge, d as Activity, i as Scale, l as ArrowUpRight, n as TrendingUp, o as Newspaper, r as Signal, s as Layers, t as Wallet, u as ArrowDownRight } from "../_libs/lucide-react.mjs";
import { n as clsx, t as cva } from "../_libs/class-variance-authority+clsx.mjs";
import { a as Tooltip, i as ResponsiveContainer, n as YAxis, r as Area, t as AreaChart } from "../_libs/recharts+[...].mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { n as SwitchThumb, t as Switch$1 } from "../_libs/@radix-ui/react-switch+[...].mjs";
import { i as Trigger, n as List, r as Root2, t as Content } from "../_libs/radix-ui__react-tabs.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/routes-hR2IgtQK.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function useServerFn(serverFn) {
	const router = useRouter();
	return import_react.useCallback(async (...args) => {
		try {
			const res = await serverFn(...args);
			if (isRedirect(res)) throw res;
			return res;
		} catch (err) {
			if (isRedirect(err)) {
				err.options._fromLocation = router.stores.location.get();
				return router.navigate(router.resolveRedirect(err).options);
			}
			throw err;
		}
	}, [router, serverFn]);
}
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
function AdsTable({ ads, side, emptyLabel = "Tidak ada iklan yang lolos filter." }) {
	if (!ads.length) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "px-1 py-6 text-sm text-muted-foreground",
		children: emptyLabel
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: "overflow-x-auto",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("table", {
			className: "w-full text-sm",
			children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
				className: "text-[0.68rem] tracking-[0.12em] text-muted-foreground uppercase",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "py-2 pr-3 text-left font-medium",
						children: "Harga"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "py-2 pr-3 text-right font-medium",
						children: "Stok tersedia"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "hidden py-2 pr-3 text-right font-medium sm:table-cell",
						children: "Limit"
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("th", {
						className: "py-2 text-left font-medium",
						children: "Merchant"
					})
				]
			}) }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("tbody", {
				className: "divide-y divide-border",
				children: ads.map((a, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("tr", {
					className: "align-top",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: cn("num py-2.5 pr-3 font-semibold", side === "bid" ? "text-bid" : "text-ask"),
							children: fmtRp2(a.price)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("td", {
							className: "num py-2.5 pr-3 text-right text-foreground/85",
							children: fmtRp(a.available_idr)
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
							className: "num hidden py-2.5 pr-3 text-right text-muted-foreground sm:table-cell",
							children: [
								fmtRp(a.min_limit_idr),
								" – ",
								fmtRp(a.max_limit_idr)
							]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("td", {
							className: "py-2.5",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex flex-wrap items-center gap-1.5",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-foreground/90",
									children: a.merchant_name
								}), a.user_type === "merchant" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "rounded-sm bg-primary/15 px-1.5 py-0.5 text-[0.6rem] font-semibold tracking-wider text-primary uppercase",
									children: "merchant"
								}) : null]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-0.5 truncate text-xs text-muted-foreground",
								children: a.pay_methods.slice(0, 3).join(" · ") || "—"
							})]
						})
					]
				}, a.adv_no ?? i))
			})]
		})
	});
}
var toneClasses = {
	bid: "text-bid shadow-[var(--shadow-glow-bid)]",
	ask: "text-ask shadow-[var(--shadow-glow-ask)]",
	primary: "text-primary"
};
function StatCard({ label, value, icon, hint, tone }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: cn("panel p-4", tone && (tone === "bid" || tone === "ask") && toneClasses[tone]),
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
				className: "flex items-center justify-between text-xs font-semibold tracking-[0.1em] text-muted-foreground uppercase",
				children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: label }), icon ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
					className: tone ? toneClasses[tone] : void 0,
					children: icon
				}) : null]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: cn("num mt-2 text-2xl font-semibold", tone && toneClasses[tone]),
				children: value
			}),
			hint ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
				className: "mt-1 text-xs text-muted-foreground",
				children: hint
			}) : null
		]
	});
}
var badgeVariants = cva("inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2", {
	variants: { variant: {
		default: "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80",
		secondary: "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
		destructive: "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80",
		outline: "text-foreground"
	} },
	defaultVariants: { variant: "default" }
});
function Badge({ className, variant, ...props }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
		className: cn(badgeVariants({ variant }), className),
		...props
	});
}
var buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0", {
	variants: {
		variant: {
			default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
			destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
			outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
			secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
			ghost: "hover:bg-accent hover:text-accent-foreground",
			link: "text-primary underline-offset-4 hover:underline"
		},
		size: {
			default: "h-9 px-4 py-2",
			sm: "h-8 rounded-md px-3 text-xs",
			lg: "h-10 rounded-md px-8",
			icon: "h-9 w-9"
		}
	},
	defaultVariants: {
		variant: "default",
		size: "default"
	}
});
var Button = import_react.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(asChild ? Slot : "button", {
		className: cn(buttonVariants({
			variant,
			size,
			className
		})),
		ref,
		...props
	});
});
Button.displayName = "Button";
var Input = import_react.forwardRef(({ className, type, ...props }, ref) => {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
		type,
		className: cn("flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm", className),
		ref,
		...props
	});
});
Input.displayName = "Input";
var labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70");
var Label = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Root, {
	ref,
	className: cn(labelVariants(), className),
	...props
}));
Label.displayName = Root.displayName;
var Switch = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Switch$1, {
	className: cn("peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input", className),
	...props,
	ref,
	children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(SwitchThumb, { className: cn("pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0") })
}));
Switch.displayName = Switch$1.displayName;
var Tabs = Root2;
var TabsList = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(List, {
	ref,
	className: cn("inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground", className),
	...props
}));
TabsList.displayName = List.displayName;
var TabsTrigger = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Trigger, {
	ref,
	className: cn("inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow", className),
	...props
}));
TabsTrigger.displayName = Trigger.displayName;
var TabsContent = import_react.forwardRef(({ className, ...props }, ref) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Content, {
	ref,
	className: cn("mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2", className),
	...props
}));
TabsContent.displayName = Content.displayName;
var createSsrRpc = (functionId) => {
	const url = "/_serverFn/" + functionId;
	const serverFnMeta = { id: functionId };
	const fn = async (...args) => {
		return (await getServerFnById(functionId, { origin: "server" }))(...args);
	};
	return Object.assign(fn, {
		url,
		serverFnMeta,
		[TSS_SERVER_FUNCTION]: true
	});
};
var inputSchema = objectType({
	capitalUsdt: numberType().positive().max(1e7).default(1e4),
	buyFeeIdr: numberType().min(0).max(5e3).default(30),
	history: arrayType(objectType({
		ts: stringType(),
		fair_price: numberType()
	})).max(CFG.HISTORY_MAX_POINTS).default([])
});
var getMarketSnapshot = createServerFn({ method: "POST" }).inputValidator((data) => inputSchema.parse(data)).handler(createSsrRpc("7cd60a3b126682b15fe72609b4818883cf6dfa58fe383f03d92d37359a36dc7d"));
var HISTORY_KEY = "p2p_price_history";
var POLL_SECONDS = 90;
function loadHistory() {
	try {
		const raw = localStorage.getItem(HISTORY_KEY);
		const parsed = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed) ? parsed.slice(-100) : [];
	} catch {
		return [];
	}
}
function Dashboard() {
	const snapshotFn = useServerFn(getMarketSnapshot);
	const [snapshot, setSnapshot] = (0, import_react.useState)(null);
	const [capital, setCapital] = (0, import_react.useState)(1e4);
	const [fee, setFee] = (0, import_react.useState)(30);
	const [auto, setAuto] = (0, import_react.useState)(true);
	const [countdown, setCountdown] = (0, import_react.useState)(POLL_SECONDS);
	const historyRef = (0, import_react.useRef)([]);
	const [hydrated, setHydrated] = (0, import_react.useState)(false);
	const mutation = useMutation({
		mutationFn: (vars) => snapshotFn({ data: {
			...vars,
			history: historyRef.current
		} }),
		onSuccess: (data) => {
			historyRef.current = data.history;
			try {
				localStorage.setItem(HISTORY_KEY, JSON.stringify(data.history));
			} catch {}
			setSnapshot(data);
			setCountdown(POLL_SECONDS);
		}
	});
	const refresh = (0, import_react.useCallback)(() => {
		mutation.mutate({
			capitalUsdt: capital,
			buyFeeIdr: fee
		});
	}, [
		capital,
		fee,
		mutation
	]);
	const refreshRef = (0, import_react.useRef)(refresh);
	refreshRef.current = refresh;
	(0, import_react.useEffect)(() => {
		historyRef.current = loadHistory();
		setHydrated(true);
		refreshRef.current();
	}, []);
	(0, import_react.useEffect)(() => {
		if (!auto) return;
		const id = setInterval(() => {
			setCountdown((c) => {
				if (c <= 1) {
					refreshRef.current();
					return POLL_SECONDS;
				}
				return c - 1;
			});
		}, 1e3);
		return () => clearInterval(id);
	}, [auto]);
	const chartData = (0, import_react.useMemo)(() => (snapshot?.history ?? []).map((p) => ({
		ts: new Date(p.ts).toLocaleTimeString("id-ID", {
			hour: "2-digit",
			minute: "2-digit"
		}),
		price: p.fair_price
	})), [snapshot]);
	const s = snapshot;
	const loading = mutation.isPending && !s;
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("main", {
		className: "min-h-screen bg-background bg-grid [background-size:44px_44px]",
		children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
			className: "mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12",
			children: [
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("header", {
					className: "flex flex-col gap-5 border-b border-border pb-7 sm:flex-row sm:items-end sm:justify-between",
					children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center gap-2",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
								className: "relative flex size-2",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "absolute inline-flex size-full animate-ping rounded-full bg-bid/70" }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "relative inline-flex size-2 rounded-full bg-bid" })]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "text-[0.7rem] font-medium tracking-[0.2em] text-muted-foreground uppercase",
								children: "Binance P2P · USDT / IDR"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
							className: "mt-2 text-3xl font-semibold sm:text-4xl",
							children: "Radar Harga Merchant"
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-2 max-w-xl text-sm text-muted-foreground",
							children: [
								"Acuan harga iklan ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
									className: "text-foreground/90",
									children: "beli"
								}),
								" dan",
								" ",
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", {
									className: "text-foreground/90",
									children: "jual"
								}),
								" Anda — dihitung dari order book kompetitor, kedalaman stok, dan margin minimum dinamis."
							]
						})
					] }), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
						className: "flex flex-col items-start gap-3 sm:items-end",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Button, {
							onClick: refresh,
							disabled: mutation.isPending,
							className: "w-full font-semibold sm:w-auto",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(RefreshCw, { className: mutation.isPending ? "animate-spin" : "" }), mutation.isPending ? "Mengambil data…" : "Refresh sekarang"]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-center gap-2.5",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Switch, {
								id: "auto",
								checked: auto,
								onCheckedChange: setAuto
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Label, {
								htmlFor: "auto",
								className: "text-xs text-muted-foreground",
								children: ["Auto-refresh ", auto ? `· ${countdown}s` : "nonaktif"]
							})]
						})]
					})]
				}),
				/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
					className: "mt-7 grid gap-4 sm:grid-cols-[repeat(2,minmax(0,220px))_1fr]",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel p-4",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "capital",
								className: "text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase",
								children: "Modal (USDT)"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								id: "capital",
								type: "number",
								min: 1,
								value: capital,
								onChange: (e) => setCapital(Math.max(1, Number(e.target.value) || 0)),
								className: "num mt-2 border-0 bg-surface-2 text-lg font-semibold"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel p-4",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Label, {
								htmlFor: "fee",
								className: "text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase",
								children: "Fee beli (Rp/USDT)"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Input, {
								id: "fee",
								type: "number",
								min: 0,
								value: fee,
								onChange: (e) => setFee(Math.max(0, Number(e.target.value) || 0)),
								className: "num mt-2 border-0 bg-surface-2 text-lg font-semibold"
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel flex flex-col justify-center gap-1.5 p-4",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "text-[0.7rem] tracking-[0.14em] text-muted-foreground uppercase",
									children: "Terakhir diperbarui"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
									className: "num text-sm text-foreground/90",
									children: s ? new Date(s.timestamp).toLocaleString("id-ID") : hydrated ? "—" : ""
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
									className: "text-xs text-muted-foreground",
									children: [
										"Riwayat harga tersimpan di browser Anda: ",
										s?.history.length ?? 0,
										" titik"
									]
								})
							]
						})
					]
				}),
				mutation.isError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground",
					children: "Gagal mengambil data pasar. Coba refresh lagi."
				}) : null,
				loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
					className: "mt-10 text-sm text-muted-foreground",
					children: "Mengambil order book P2P…"
				}) : null,
				s ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "mt-6 grid gap-4 sm:grid-cols-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
							label: "Pasang iklan BELI di",
							tone: "bid",
							icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowDownRight, { className: "size-5" }),
							value: fmtRp2(s.my_buy_price),
							hint: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
								"Sebelum fee ",
								fmtRp2(s.my_buy_price_pre_fee),
								" · zona kompetitor",
								" ",
								fmtRp(s.my_buy_zone[0]),
								"–",
								fmtRp(s.my_buy_zone[1])
							] })
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
							label: "Pasang iklan JUAL di",
							tone: "ask",
							icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ArrowUpRight, { className: "size-5" }),
							value: fmtRp2(s.my_sell_price),
							hint: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
								"Zona kompetitor ",
								fmtRp(s.my_sell_zone[0]),
								"–",
								fmtRp(s.my_sell_zone[1])
							] })
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
								label: "Harga tengah wajar",
								tone: "primary",
								icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scale, { className: "size-4" }),
								value: fmtRp2(s.fair_price),
								hint: `Bias pasar: ${biasLabel(s.bias)}`
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
								label: "Margin Anda",
								icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TrendingUp, { className: "size-4" }),
								value: `${fmtRp2(s.spread_abs)}`,
								hint: `${fmtPct(s.spread_pct)} · minimum dijaga ${fmtRp2(s.min_margin_used)}${s.margin_adjusted ? " (harga dilebarkan)" : ""}`
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
								label: "Likuiditas terlihat",
								icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Layers, { className: "size-4" }),
								value: fmtRp(s.total_liquidity_idr),
								hint: `Kelas: ${liquidityLabel(s.liquidity_class)} · ${s.sell_ref_count_clean + s.buy_ref_count_clean} iklan valid`
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)(StatCard, {
								label: "Skor keyakinan",
								icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Gauge, { className: "size-4" }),
								value: `${s.confidence}/100`,
								hint: confidenceLabel(s.confidence)
							})
						]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "mt-4 grid gap-4 lg:grid-cols-[1.55fr_1fr]",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel p-5",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "flex items-center justify-between",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									className: "text-sm font-semibold tracking-[0.1em] uppercase",
									children: "Harga wajar (riwayat sesi)"
								}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Badge, {
									variant: "outline",
									className: "num text-xs",
									children: [chartData.length, " titik"]
								})]
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
								className: "mt-4 h-56",
								children: chartData.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(ResponsiveContainer, {
									width: "100%",
									height: "100%",
									children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(AreaChart, {
										data: chartData,
										children: [
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)("defs", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("linearGradient", {
												id: "fair",
												x1: "0",
												y1: "0",
												x2: "0",
												y2: "1",
												children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("stop", {
													offset: "0%",
													stopColor: "var(--color-primary)",
													stopOpacity: .45
												}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("stop", {
													offset: "100%",
													stopColor: "var(--color-primary)",
													stopOpacity: 0
												})]
											}) }),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)(YAxis, {
												domain: ["dataMin - 15", "dataMax + 15"],
												hide: true
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Tooltip, {
												contentStyle: {
													background: "var(--color-surface-2)",
													border: "1px solid var(--color-border)",
													borderRadius: 10,
													fontSize: 12
												},
												labelStyle: { color: "var(--color-muted-foreground)" },
												formatter: (v) => [fmtRp2(v), "Harga wajar"]
											}),
											/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Area, {
												type: "monotone",
												dataKey: "price",
												stroke: "var(--color-primary)",
												strokeWidth: 2,
												fill: "url(#fair)"
											})
										]
									})
								}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", {
									className: "flex h-full items-center justify-center text-sm text-muted-foreground",
									children: "Butuh minimal 2 pembacaan — biarkan auto-refresh berjalan."
								})
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel space-y-3 p-5",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
									className: "text-sm font-semibold tracking-[0.1em] uppercase",
									children: "Sinyal pasar"
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Signal, { className: "size-4" }),
									label: "Arah jangka pendek",
									value: s.price_outlook.outlook
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Activity, { className: "size-4" }),
									label: "Momentum",
									value: s.momentum.available ? `${s.momentum.label} (${fmtPct(s.momentum.delta_pct ?? NaN)})` : s.momentum.label
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Layers, { className: "size-4" }),
									label: "Imbalance order book",
									value: `${s.order_book_imbalance.label} (${fmtPct(s.order_book_imbalance.imbalance_pct, 1)})`
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Scale, { className: "size-4" }),
									label: "Selisih vs bursa spot",
									value: fmtPct(s.cross_platform_gap_pct)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Activity, { className: "size-4" }),
									label: "Volatilitas terakhir",
									value: fmtPct(s.volatility_pct, 3)
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
									icon: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Wallet, { className: "size-4" }),
									label: "Pangsa modal Anda",
									value: `${fmtPct(s.capital_share_pct, 1)} dari likuiditas`
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
									className: "pt-1 text-xs leading-relaxed text-muted-foreground",
									children: "Sinyal ini heuristik sederhana, bukan prediksi harga. Jangan jadikan satu-satunya dasar keputusan."
								})
							]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "mt-4 grid gap-4 lg:grid-cols-2",
						children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel p-5",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "text-sm font-semibold tracking-[0.1em] uppercase",
								children: "Kenapa margin sebesar ini"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mt-3 space-y-2.5",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Dasar (floor)",
										value: fmtPct(s.margin_breakdown["floor_pct"] ?? NaN, 3)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Buffer volatilitas",
										value: fmtPct(s.margin_breakdown["vol_buf_pct"] ?? NaN, 3)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Buffer likuiditas",
										value: fmtPct(s.margin_breakdown["liq_buf_pct"] ?? NaN, 3)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Buffer modal",
										value: fmtPct(s.margin_breakdown["capital_buf_pct"] ?? NaN, 3)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Faktor kepadatan kompetitor",
										value: `×${(s.margin_breakdown["crowd_factor"] ?? 0).toFixed(2)} (jual ${s.sell_density} · beli ${s.buy_density} iklan nempel)`
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Margin minimum dipakai",
										value: fmtRp2(s.min_margin_used)
									})
								]
							})]
						}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "panel p-5",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
								className: "text-sm font-semibold tracking-[0.1em] uppercase",
								children: "Kedalaman stok relevan"
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
								className: "mt-3 space-y-2.5",
								children: [
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Modal Anda",
										value: `${s.capital_usdt.toLocaleString("id-ID")} USDT · ${fmtRp(s.capital_idr)}`
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Target kedalaman",
										value: fmtRp(s.depth_target_idr)
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Sisi JUAL (acuan)",
										value: `${fmtRp2(s.sell_depth.price)} · ${s.sell_depth.ads_used} iklan · ${fmtRp(s.sell_depth.depth_reached_idr)}${s.sell_depth.depth_sufficient ? "" : " (belum cukup)"}`
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Sisi BELI (acuan)",
										value: `${fmtRp2(s.buy_depth.price)} · ${s.buy_depth.ads_used} iklan · ${fmtRp(s.buy_depth.depth_reached_idr)}${s.buy_depth.depth_sufficient ? "" : " (belum cukup)"}`
									}),
									/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Row, {
										label: "Referensi bursa spot",
										value: Object.keys(s.cross_platform).length ? Object.entries(s.cross_platform).map(([k, v]) => `${k.includes("indodax") ? "Indodax" : "CoinGecko"} ${fmtRp2(v)}`).join(" · ") : "tidak tersedia"
									})
								]
							})]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", {
						className: "panel mt-4 p-5",
						children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(Tabs, {
							defaultValue: "sell",
							children: [
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
									className: "flex flex-wrap items-center justify-between gap-3",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h2", {
										className: "text-sm font-semibold tracking-[0.1em] uppercase",
										children: "Order book kompetitor"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsList, { children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsTrigger, {
										value: "sell",
										children: "Acuan iklan JUAL saya"
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(TabsTrigger, {
										value: "buy",
										children: "Acuan iklan BELI saya"
									})] })]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsContent, {
									value: "sell",
									className: "mt-4",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "mb-3 text-xs text-muted-foreground",
										children: [
											"Kompetitor yang menjual USDT — ",
											s.sell_ref_count_clean,
											" dari",
											" ",
											s.sell_ref_count_raw,
											" iklan lolos filter likuiditas & outlier."
										]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AdsTable, {
										ads: s.top_sell_ref_ads,
										side: "ask"
									})]
								}),
								/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(TabsContent, {
									value: "buy",
									className: "mt-4",
									children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
										className: "mb-3 text-xs text-muted-foreground",
										children: [
											"Kompetitor yang membeli USDT — ",
											s.buy_ref_count_clean,
											" dari ",
											s.buy_ref_count_raw,
											" ",
											"iklan lolos filter likuiditas & outlier."
										]
									}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(AdsTable, {
										ads: s.top_buy_ref_ads,
										side: "bid"
									})]
								})
							]
						})
					}),
					s.news_items.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", {
						className: "panel mt-4 p-5",
						children: [
							/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h2", {
								className: "flex items-center gap-2 text-sm font-semibold tracking-[0.1em] uppercase",
								children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Newspaper, { className: "size-4 text-primary" }), " Konteks berita"]
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
								className: "mt-3 space-y-2",
								children: s.news_items.map((n) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("a", {
									href: n.link,
									target: "_blank",
									rel: "noreferrer noopener",
									className: "text-sm text-foreground/85 underline-offset-4 hover:text-primary hover:underline",
									children: n.title
								}) }, n.link || n.title))
							}),
							/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
								className: "mt-3 text-xs text-muted-foreground",
								children: "Judul mentah dari Google News — tidak dipakai untuk menghitung harga."
							})
						]
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)("footer", {
						className: "mt-8 border-t border-border pt-5 text-xs leading-relaxed text-muted-foreground",
						children: "Data iklan diambil langsung dari endpoint publik Binance P2P. Semua angka rekomendasi adalah hasil hitungan heuristik atas data tersebut, bukan nasihat keuangan."
					})
				] }) : null
			]
		})
	});
}
function Row({ label, value, icon }) {
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "flex items-start justify-between gap-4 border-b border-border/60 pb-2 last:border-0 last:pb-0",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", {
			className: "flex items-center gap-2 text-sm text-muted-foreground",
			children: [icon, label]
		}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
			className: "num text-right text-sm font-medium text-foreground/90",
			children: value
		})]
	});
}
//#endregion
export { Dashboard as component };
