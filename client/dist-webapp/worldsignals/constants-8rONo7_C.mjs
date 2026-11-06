import { a as e, t } from "./chunk-HEgqtunE.mjs";
import { t as n } from "./api-BTRrcK48.mjs";
import { ct as r } from "./meshIdentity-CzNYiM-d.mjs";
//#region node_modules/react/cjs/react.production.js
var i = /* @__PURE__ */ t(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.portal"), r = Symbol.for("react.fragment"), i = Symbol.for("react.strict_mode"), a = Symbol.for("react.profiler"), o = Symbol.for("react.consumer"), s = Symbol.for("react.context"), c = Symbol.for("react.forward_ref"), l = Symbol.for("react.suspense"), u = Symbol.for("react.memo"), d = Symbol.for("react.lazy"), f = Symbol.for("react.activity"), p = Symbol.iterator;
	function m(e) {
		return typeof e != "object" || !e ? null : (e = p && e[p] || e["@@iterator"], typeof e == "function" ? e : null);
	}
	var h = {
		isMounted: function() {
			return !1;
		},
		enqueueForceUpdate: function() {},
		enqueueReplaceState: function() {},
		enqueueSetState: function() {}
	}, g = Object.assign, _ = {};
	function v(e, t, n) {
		this.props = e, this.context = t, this.refs = _, this.updater = n || h;
	}
	v.prototype.isReactComponent = {}, v.prototype.setState = function(e, t) {
		if (typeof e != "object" && typeof e != "function" && e != null) throw Error("takes an object of state variables to update or a function which returns an object of state variables.");
		this.updater.enqueueSetState(this, e, t, "setState");
	}, v.prototype.forceUpdate = function(e) {
		this.updater.enqueueForceUpdate(this, e, "forceUpdate");
	};
	function y() {}
	y.prototype = v.prototype;
	function b(e, t, n) {
		this.props = e, this.context = t, this.refs = _, this.updater = n || h;
	}
	var x = b.prototype = new y();
	x.constructor = b, g(x, v.prototype), x.isPureReactComponent = !0;
	var S = Array.isArray;
	function C() {}
	var w = {
		H: null,
		A: null,
		T: null,
		S: null
	}, T = Object.prototype.hasOwnProperty;
	function E(e, n, r) {
		var i = r.ref;
		return {
			$$typeof: t,
			type: e,
			key: n,
			ref: i === void 0 ? null : i,
			props: r
		};
	}
	function D(e, t) {
		return E(e.type, t, e.props);
	}
	function O(e) {
		return typeof e == "object" && !!e && e.$$typeof === t;
	}
	function k(e) {
		var t = {
			"=": "=0",
			":": "=2"
		};
		return "$" + e.replace(/[=:]/g, function(e) {
			return t[e];
		});
	}
	var A = /\/+/g;
	function j(e, t) {
		return typeof e == "object" && e && e.key != null ? k("" + e.key) : t.toString(36);
	}
	function ee(e) {
		switch (e.status) {
			case "fulfilled": return e.value;
			case "rejected": throw e.reason;
			default: switch (typeof e.status == "string" ? e.then(C, C) : (e.status = "pending", e.then(function(t) {
				e.status === "pending" && (e.status = "fulfilled", e.value = t);
			}, function(t) {
				e.status === "pending" && (e.status = "rejected", e.reason = t);
			})), e.status) {
				case "fulfilled": return e.value;
				case "rejected": throw e.reason;
			}
		}
		throw e;
	}
	function M(e, r, i, a, o) {
		var s = typeof e;
		(s === "undefined" || s === "boolean") && (e = null);
		var c = !1;
		if (e === null) c = !0;
		else switch (s) {
			case "bigint":
			case "string":
			case "number":
				c = !0;
				break;
			case "object": switch (e.$$typeof) {
				case t:
				case n:
					c = !0;
					break;
				case d: return c = e._init, M(c(e._payload), r, i, a, o);
			}
		}
		if (c) return o = o(e), c = a === "" ? "." + j(e, 0) : a, S(o) ? (i = "", c != null && (i = c.replace(A, "$&/") + "/"), M(o, r, i, "", function(e) {
			return e;
		})) : o != null && (O(o) && (o = D(o, i + (o.key == null || e && e.key === o.key ? "" : ("" + o.key).replace(A, "$&/") + "/") + c)), r.push(o)), 1;
		c = 0;
		var l = a === "" ? "." : a + ":";
		if (S(e)) for (var u = 0; u < e.length; u++) a = e[u], s = l + j(a, u), c += M(a, r, i, s, o);
		else if (u = m(e), typeof u == "function") for (e = u.call(e), u = 0; !(a = e.next()).done;) a = a.value, s = l + j(a, u++), c += M(a, r, i, s, o);
		else if (s === "object") {
			if (typeof e.then == "function") return M(ee(e), r, i, a, o);
			throw r = String(e), Error("Objects are not valid as a React child (found: " + (r === "[object Object]" ? "object with keys {" + Object.keys(e).join(", ") + "}" : r) + "). If you meant to render a collection of children, use an array instead.");
		}
		return c;
	}
	function N(e, t, n) {
		if (e == null) return e;
		var r = [], i = 0;
		return M(e, r, "", "", function(e) {
			return t.call(n, e, i++);
		}), r;
	}
	function te(e) {
		if (e._status === -1) {
			var t = e._result;
			t = t(), t.then(function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 1, e._result = t);
			}, function(t) {
				(e._status === 0 || e._status === -1) && (e._status = 2, e._result = t);
			}), e._status === -1 && (e._status = 0, e._result = t);
		}
		if (e._status === 1) return e._result.default;
		throw e._result;
	}
	var P = typeof reportError == "function" ? reportError : function(e) {
		if (typeof window == "object" && typeof window.ErrorEvent == "function") {
			var t = new window.ErrorEvent("error", {
				bubbles: !0,
				cancelable: !0,
				message: typeof e == "object" && e && typeof e.message == "string" ? String(e.message) : String(e),
				error: e
			});
			if (!window.dispatchEvent(t)) return;
		} else if (typeof process == "object" && typeof process.emit == "function") {
			process.emit("uncaughtException", e);
			return;
		}
		console.error(e);
	}, F = {
		map: N,
		forEach: function(e, t, n) {
			N(e, function() {
				t.apply(this, arguments);
			}, n);
		},
		count: function(e) {
			var t = 0;
			return N(e, function() {
				t++;
			}), t;
		},
		toArray: function(e) {
			return N(e, function(e) {
				return e;
			}) || [];
		},
		only: function(e) {
			if (!O(e)) throw Error("React.Children.only expected to receive a single React element child.");
			return e;
		}
	};
	e.Activity = f, e.Children = F, e.Component = v, e.Fragment = r, e.Profiler = a, e.PureComponent = b, e.StrictMode = i, e.Suspense = l, e.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = w, e.__COMPILER_RUNTIME = {
		__proto__: null,
		c: function(e) {
			return w.H.useMemoCache(e);
		}
	}, e.cache = function(e) {
		return function() {
			return e.apply(null, arguments);
		};
	}, e.cacheSignal = function() {
		return null;
	}, e.cloneElement = function(e, t, n) {
		if (e == null) throw Error("The argument must be a React element, but you passed " + e + ".");
		var r = g({}, e.props), i = e.key;
		if (t != null) for (a in t.key !== void 0 && (i = "" + t.key), t) !T.call(t, a) || a === "key" || a === "__self" || a === "__source" || a === "ref" && t.ref === void 0 || (r[a] = t[a]);
		var a = arguments.length - 2;
		if (a === 1) r.children = n;
		else if (1 < a) {
			for (var o = Array(a), s = 0; s < a; s++) o[s] = arguments[s + 2];
			r.children = o;
		}
		return E(e.type, i, r);
	}, e.createContext = function(e) {
		return e = {
			$$typeof: s,
			_currentValue: e,
			_currentValue2: e,
			_threadCount: 0,
			Provider: null,
			Consumer: null
		}, e.Provider = e, e.Consumer = {
			$$typeof: o,
			_context: e
		}, e;
	}, e.createElement = function(e, t, n) {
		var r, i = {}, a = null;
		if (t != null) for (r in t.key !== void 0 && (a = "" + t.key), t) T.call(t, r) && r !== "key" && r !== "__self" && r !== "__source" && (i[r] = t[r]);
		var o = arguments.length - 2;
		if (o === 1) i.children = n;
		else if (1 < o) {
			for (var s = Array(o), c = 0; c < o; c++) s[c] = arguments[c + 2];
			i.children = s;
		}
		if (e && e.defaultProps) for (r in o = e.defaultProps, o) i[r] === void 0 && (i[r] = o[r]);
		return E(e, a, i);
	}, e.createRef = function() {
		return { current: null };
	}, e.forwardRef = function(e) {
		return {
			$$typeof: c,
			render: e
		};
	}, e.isValidElement = O, e.lazy = function(e) {
		return {
			$$typeof: d,
			_payload: {
				_status: -1,
				_result: e
			},
			_init: te
		};
	}, e.memo = function(e, t) {
		return {
			$$typeof: u,
			type: e,
			compare: t === void 0 ? null : t
		};
	}, e.startTransition = function(e) {
		var t = w.T, n = {};
		w.T = n;
		try {
			var r = e(), i = w.S;
			i !== null && i(n, r), typeof r == "object" && r && typeof r.then == "function" && r.then(C, P);
		} catch (e) {
			P(e);
		} finally {
			t !== null && n.types !== null && (t.types = n.types), w.T = t;
		}
	}, e.unstable_useCacheRefresh = function() {
		return w.H.useCacheRefresh();
	}, e.use = function(e) {
		return w.H.use(e);
	}, e.useActionState = function(e, t, n) {
		return w.H.useActionState(e, t, n);
	}, e.useCallback = function(e, t) {
		return w.H.useCallback(e, t);
	}, e.useContext = function(e) {
		return w.H.useContext(e);
	}, e.useDebugValue = function() {}, e.useDeferredValue = function(e, t) {
		return w.H.useDeferredValue(e, t);
	}, e.useEffect = function(e, t) {
		return w.H.useEffect(e, t);
	}, e.useEffectEvent = function(e) {
		return w.H.useEffectEvent(e);
	}, e.useId = function() {
		return w.H.useId();
	}, e.useImperativeHandle = function(e, t, n) {
		return w.H.useImperativeHandle(e, t, n);
	}, e.useInsertionEffect = function(e, t) {
		return w.H.useInsertionEffect(e, t);
	}, e.useLayoutEffect = function(e, t) {
		return w.H.useLayoutEffect(e, t);
	}, e.useMemo = function(e, t) {
		return w.H.useMemo(e, t);
	}, e.useOptimistic = function(e, t) {
		return w.H.useOptimistic(e, t);
	}, e.useReducer = function(e, t, n) {
		return w.H.useReducer(e, t, n);
	}, e.useRef = function(e) {
		return w.H.useRef(e);
	}, e.useState = function(e) {
		return w.H.useState(e);
	}, e.useSyncExternalStore = function(e, t, n) {
		return w.H.useSyncExternalStore(e, t, n);
	}, e.useTransition = function() {
		return w.H.useTransition();
	}, e.version = "19.2.7";
})), a = /* @__PURE__ */ t(((e, t) => {
	t.exports = i();
})), o = /* @__PURE__ */ t(((e) => {
	var t = a();
	function n(e) {
		var t = "https://react.dev/errors/" + e;
		if (1 < arguments.length) {
			t += "?args[]=" + encodeURIComponent(arguments[1]);
			for (var n = 2; n < arguments.length; n++) t += "&args[]=" + encodeURIComponent(arguments[n]);
		}
		return "Minified React error #" + e + "; visit " + t + " for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
	}
	function r() {}
	var i = {
		d: {
			f: r,
			r: function() {
				throw Error(n(522));
			},
			D: r,
			C: r,
			L: r,
			m: r,
			X: r,
			S: r,
			M: r
		},
		p: 0,
		findDOMNode: null
	}, o = Symbol.for("react.portal");
	function s(e, t, n) {
		var r = 3 < arguments.length && arguments[3] !== void 0 ? arguments[3] : null;
		return {
			$$typeof: o,
			key: r == null ? null : "" + r,
			children: e,
			containerInfo: t,
			implementation: n
		};
	}
	var c = t.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
	function l(e, t) {
		if (e === "font") return "";
		if (typeof t == "string") return t === "use-credentials" ? t : "";
	}
	e.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = i, e.createPortal = function(e, t) {
		var r = 2 < arguments.length && arguments[2] !== void 0 ? arguments[2] : null;
		if (!t || t.nodeType !== 1 && t.nodeType !== 9 && t.nodeType !== 11) throw Error(n(299));
		return s(e, t, null, r);
	}, e.flushSync = function(e) {
		var t = c.T, n = i.p;
		try {
			if (c.T = null, i.p = 2, e) return e();
		} finally {
			c.T = t, i.p = n, i.d.f();
		}
	}, e.preconnect = function(e, t) {
		typeof e == "string" && (t ? (t = t.crossOrigin, t = typeof t == "string" ? t === "use-credentials" ? t : "" : void 0) : t = null, i.d.C(e, t));
	}, e.prefetchDNS = function(e) {
		typeof e == "string" && i.d.D(e);
	}, e.preinit = function(e, t) {
		if (typeof e == "string" && t && typeof t.as == "string") {
			var n = t.as, r = l(n, t.crossOrigin), a = typeof t.integrity == "string" ? t.integrity : void 0, o = typeof t.fetchPriority == "string" ? t.fetchPriority : void 0;
			n === "style" ? i.d.S(e, typeof t.precedence == "string" ? t.precedence : void 0, {
				crossOrigin: r,
				integrity: a,
				fetchPriority: o
			}) : n === "script" && i.d.X(e, {
				crossOrigin: r,
				integrity: a,
				fetchPriority: o,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0
			});
		}
	}, e.preinitModule = function(e, t) {
		if (typeof e == "string") if (typeof t == "object" && t) {
			if (t.as == null || t.as === "script") {
				var n = l(t.as, t.crossOrigin);
				i.d.M(e, {
					crossOrigin: n,
					integrity: typeof t.integrity == "string" ? t.integrity : void 0,
					nonce: typeof t.nonce == "string" ? t.nonce : void 0
				});
			}
		} else t ?? i.d.M(e);
	}, e.preload = function(e, t) {
		if (typeof e == "string" && typeof t == "object" && t && typeof t.as == "string") {
			var n = t.as, r = l(n, t.crossOrigin);
			i.d.L(e, n, {
				crossOrigin: r,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0,
				nonce: typeof t.nonce == "string" ? t.nonce : void 0,
				type: typeof t.type == "string" ? t.type : void 0,
				fetchPriority: typeof t.fetchPriority == "string" ? t.fetchPriority : void 0,
				referrerPolicy: typeof t.referrerPolicy == "string" ? t.referrerPolicy : void 0,
				imageSrcSet: typeof t.imageSrcSet == "string" ? t.imageSrcSet : void 0,
				imageSizes: typeof t.imageSizes == "string" ? t.imageSizes : void 0,
				media: typeof t.media == "string" ? t.media : void 0
			});
		}
	}, e.preloadModule = function(e, t) {
		if (typeof e == "string") if (t) {
			var n = l(t.as, t.crossOrigin);
			i.d.m(e, {
				as: typeof t.as == "string" && t.as !== "script" ? t.as : void 0,
				crossOrigin: n,
				integrity: typeof t.integrity == "string" ? t.integrity : void 0
			});
		} else i.d.m(e);
	}, e.requestFormReset = function(e) {
		i.d.r(e);
	}, e.unstable_batchedUpdates = function(e, t) {
		return e(t);
	}, e.useFormState = function(e, t, n) {
		return c.H.useFormState(e, t, n);
	}, e.useFormStatus = function() {
		return c.H.useHostTransitionStatus();
	}, e.version = "19.2.7";
})), s = /* @__PURE__ */ t(((e, t) => {
	function n() {
		if (!(typeof __REACT_DEVTOOLS_GLOBAL_HOOK__ > "u" || typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE != "function")) try {
			__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(n);
		} catch (e) {
			console.error(e);
		}
	}
	n(), t.exports = o();
})), c = /* @__PURE__ */ t(((e) => {
	var t = Symbol.for("react.transitional.element"), n = Symbol.for("react.fragment");
	function r(e, n, r) {
		var i = null;
		if (r !== void 0 && (i = "" + r), n.key !== void 0 && (i = "" + n.key), "key" in n) for (var a in r = {}, n) a !== "key" && (r[a] = n[a]);
		else r = n;
		return n = r.ref, {
			$$typeof: t,
			type: e,
			key: i,
			ref: n === void 0 ? null : n,
			props: r
		};
	}
	e.Fragment = n, e.jsx = r, e.jsxs = r;
})), l = /* @__PURE__ */ t(((e, t) => {
	t.exports = c();
})), u = /* @__PURE__ */ e(a()), d = l(), f = (0, u.createContext)({
	theme: "dark",
	toggleTheme: () => {},
	hudColor: "cyan",
	cycleHudColor: () => {}
});
function p({ children: e }) {
	let [t, n] = (0, u.useState)("dark"), [r, i] = (0, u.useState)("cyan");
	return (0, u.useEffect)(() => {
		let e = localStorage.getItem("sb-theme");
		(e === "light" || e === "dark") && (n(e), document.documentElement.setAttribute("data-theme", e));
		let t = localStorage.getItem("sb-hud-color");
		(t === "cyan" || t === "matrix") && (i(t), document.documentElement.setAttribute("data-hud", t));
	}, []), /* @__PURE__ */ (0, d.jsx)(f.Provider, {
		value: {
			theme: t,
			toggleTheme: () => {
				let e = t === "dark" ? "light" : "dark";
				n(e), localStorage.setItem("sb-theme", e), document.documentElement.setAttribute("data-theme", e);
			},
			hudColor: r,
			cycleHudColor: () => {
				let e = r === "cyan" ? "matrix" : "cyan";
				i(e), localStorage.setItem("sb-hud-color", e), document.documentElement.setAttribute("data-hud", e);
			}
		},
		children: e
	});
}
function m() {
	return (0, u.useContext)(f);
}
var h = {
	brand: {
		title: "W O R L D S I G N A L S",
		subtitle: "LIVE WORLD INTELLIGENCE",
		systemMetrics: "LIVE VIS:113 SRC:180 DENS:1.42 0.8ms"
	},
	nav: {
		layers: "LAYERS",
		intel: "INTEL",
		markets: "MARKETS",
		dataLayers: "DATA LAYERS",
		prioritizingMapFeeds: "PRIORITIZING MAP FEEDS",
		restoreUi: "RESTORE UI"
	},
	controls: {
		updates: "UPDATES",
		checking: "CHECKING...",
		upToDate: "UP TO DATE",
		checkFailed: "CHECK FAILED",
		node: "NODE",
		terminal: "TERMINAL",
		coordinates: "COORDINATES",
		location: "LOCATION",
		style: "STYLE",
		solar: "SOLAR",
		hoverMap: "Hover over map...",
		na: "N/A"
	},
	update: {
		downloadInstaller: "DOWNLOAD INSTALLER",
		installUpdate: "INSTALL UPDATE",
		autoUpdate: "AUTO UPDATE",
		viewRelease: "VIEW RELEASE",
		manualDownload: "MANUAL DOWNLOAD",
		cancel: "CANCEL",
		tryAgain: "TRY AGAIN",
		downloadingUpdate: "DOWNLOADING UPDATE...",
		restarting: "RESTARTING...",
		updateFailed: "UPDATE FAILED",
		dockerUpdate: "DOCKER UPDATE",
		dockerUpdateDetail: "Docker containers must be updated by pulling new images.\n            Run this on your host machine:"
	},
	node: {
		activateNode: "ACTIVATE NODE",
		activatingNode: "ACTIVATING NODE",
		nodeActivated: "NODE ACTIVATED",
		stipulations: "STIPULATIONS",
		yes: "YES",
		no: "NO",
		agree: "AGREE",
		disagree: "DISAGREE",
		turnOff: "TURN OFF",
		keepOn: "KEEP ON",
		turningOff: "TURNING OFF...",
		activating: "ACTIVATING...",
		nodeOnline: "NODE ONLINE",
		generatingIdentity: "Generating identity...",
		identityReady: "Identity ready",
		preparingTransport: "Preparing onion transport...",
		findingPeers: "Finding bootstrap peers...",
		peersReady: "Bootstrap peers ready",
		syncingChain: "Syncing chain...",
		soloNodeReady: "Solo node ready",
		synced: "Synced",
		events: "events",
		peers: "peers",
		close: "CLOSE",
		activatePrompt: "Do you want to activate a node on this install?",
		activateDetail: "This turns on your local participant node and syncs Infonet only through available Wormhole onion/RNS peers. Clearnet bootstrap is disabled by default.",
		keepSyncing: "Your node keeps syncing as long as the backend is running — you can close this browser tab. To run a headless node without the dashboard, use",
		termsTitle: "BY CONTINUING YOU AGREE:",
		term1: "This install can keep a local copy of the public Infonet chain.",
		term2: "Fresh installs do not use a clearnet Infonet seed.",
		term3: "Participant-node sync requires an onion/RNS peer through Wormhole.",
		term4: "Your backend may sync with configured private bootstrap peers in the background.",
		term5: "Wormhole keeps Infonet, gates, Dead Drop, and DM traffic on the obfuscated lane.",
		syncTakingLong: "Sync is taking longer than expected. Your node is active and will continue syncing in the background."
	},
	terminal: {
		infonetTerminal: "INFONET TERMINAL",
		privateLaneReady: "PRIVATE LANE READY",
		privateLaneStarting: "PRIVATE LANE STARTING",
		privateLaneOffline: "PRIVATE LANE OFFLINE",
		enterTerminal: "Enter the Wormhole-facing terminal and sync with the obfuscated Infonet commons?",
		terminalDetail: "The terminal runs through Wormhole for obfuscated gates, inbox, and experimental comms.",
		identityReady: "Your obfuscated identity is already provisioned. Entering now keeps the obfuscated lane separate from the public node sync path.",
		identityNotReady: "This turns Wormhole on and opens the obfuscated lane. If you already have a Wormhole identity, it reuses it. If you do not, it bootstraps one once and then keeps using it.",
		beforeYouEnter: "BEFORE YOU ENTER:",
		termTerminal1: "The terminal is for Wormhole gates (transitional private lane) and Dead Drop / DM (stronger private lane).",
		termTerminal2: "Your participant node can stay active separately without changing this obfuscated identity lane.",
		termTerminal3: "Mesh remains the public perimeter. Wormhole is the obfuscated commons.",
		wormholeCleanup: "WORMHOLE CLEANUP:",
		cleanupDetail: "Closing the Infonet terminal will shut down Wormhole automatically. If you force-close the browser or the shutdown fails, Wormhole may keep running in the background. Run",
		cleanupFromRoot: "from the project root to ensure it is fully stopped.",
		enterWormhole: "ENTER WORMHOLE",
		activateWormhole: "ACTIVATE WORMHOLE",
		entering: "ENTERING...",
		goToMesh: "GO TO MESH"
	},
	status: {
		off: "OFF",
		solo: "SOLO",
		connected: "CONNECTED",
		syncing: "SYNCING",
		forkStop: "FORK STOP",
		syncIssue: "SYNC ISSUE",
		active: "ACTIVE",
		participant: "participant",
		nodeOff: "node • off",
		bootstrapWarning: "node • bootstrap warning"
	},
	backend: { offline: "BACKEND OFFLINE — Cannot reach backend server. Check that the backend container is running and BACKEND_URL is correct." },
	settings: {
		title: "Settings",
		close: "Close",
		general: "General",
		feeds: "Feeds",
		shodan: "Shodan",
		sar: "SAR",
		infonet: "Infonet",
		about: "About"
	},
	legend: {
		title: "Legend",
		close: "Close"
	},
	onboarding: {
		welcome: "Welcome to ShadowBroker",
		getStarted: "Get Started"
	},
	news: {
		title: "News Intel",
		noResults: "No results",
		searchPlaceholder: "Search news..."
	},
	filters: {
		title: "Data Filters",
		clear: "Clear",
		all: "All"
	},
	map: {
		findLocate: "Find / Locate",
		searchPlaceholder: "Search coordinates, place, or callsign...",
		measure: "Measure",
		clearMeasure: "Clear measurement"
	},
	layers: {
		aircraft: "Aircraft",
		commercialFlights: "Commercial Flights",
		privateAircraft: "Private Aircraft",
		privateJets: "Private Jets",
		militaryFlights: "Military Flights",
		trackedAircraft: "Tracked Aircraft",
		gpsJamming: "GPS Jamming",
		maritime: "Maritime",
		militaryVessels: "Military Vessels",
		cargoShips: "Cargo Ships",
		civilianShips: "Civilian Ships",
		passengerShips: "Passenger Ships",
		trackedYachts: "Tracked Yachts",
		fishingActivity: "Fishing Activity",
		space: "Space",
		satellites: "Satellites",
		gibsImagery: "GIBS Imagery",
		highresSatellite: "High-Res Satellite",
		sentinelHub: "Sentinel Hub",
		viirsNightlights: "VIIRS Nightlights",
		hazards: "Hazards",
		earthquakes: "Earthquakes",
		fires: "Fires",
		ukraineAlerts: "Ukraine Alerts",
		weatherAlerts: "Weather Alerts",
		volcanoes: "Volcanoes",
		airQuality: "Air Quality",
		infrastructure: "Infrastructure",
		cctv: "CCTV",
		datacenters: "Datacenters",
		internetOutages: "Internet Outages",
		powerPlants: "Power Plants",
		militaryBases: "Military Bases",
		trains: "Trains",
		sigint: "SIGINT",
		kiwisdr: "KiwiSDR",
		pskReporter: "PSK Reporter",
		satnogs: "SatNOGS",
		tinygs: "TinyGS",
		scanners: "Scanners",
		meshtastic: "Meshtastic",
		aprs: "APRS",
		overlays: "Overlays",
		ukraineFrontline: "Ukraine Frontline",
		globalIncidents: "Global Incidents",
		dayNight: "Day/Night",
		correlations: "Correlations",
		contradictions: "Contradictions",
		uapSightings: "UAP Sightings",
		biosurveillance: "Biosurveillance",
		wastewater: "Wastewater",
		crowdThreat: "CrowdThreat",
		shodanOverlay: "Shodan Overlay",
		aiIntel: "AI Intel",
		sar: "SAR",
		roadCorridorTrends: "Road Freight Trends",
		roadCorridorSource: "Copernicus S-2 · trends not live",
		submarineCables: "Submarine Cables",
		malwareC2: "Malware C2",
		scmSuppliers: "SCM Suppliers",
		cyberThreats: "Cyber Threats",
		telegramOsint: "Telegram OSINT",
		strategicRisk: "Strategic Risk Heatmap",
		derivedOsint: "Derived OSINT (Strategic Risk)",
		derivedOsintSource: "Experimental · off by default"
	},
	gtLean: {
		title: "Enable Derived OSINT on a lean node?",
		message: "Shadowbroker detected a 1 vCPU cap on this node. Turning on the Strategic Risk map layer is safe for display, but enabling the backend engine (GT_ANALYTICS_ENABLED) may slow Telegram, GDELT, and other OSINT fetches. Use OpenClaw watchdog alerts without the full engine on fleet nodes.",
		confirm: "Turn on layer anyway",
		cancel: "Cancel"
	},
	gtHud: {
		title: "GT ANALYTICS",
		dragHint: "drag to move",
		collapse: "Collapse panel",
		expand: "Expand panel"
	},
	gtAlerts: {
		title: "TOP ALERTS",
		counts: "{plotted} on map · {tracked} tracked (max {max})",
		empty: "No plottable regions yet — need geotagged intel (Telegram/GDELT/news).",
		ignition: "IGNITE",
		line: "risk {risk} · conflict {conflict}",
		hint: "500 = max tracked regions, not individual events. Click to fly there."
	},
	gtRisk: {
		popupTitle: "STRATEGIC RISK",
		region: "REGION",
		composite: "POSTERIOR RISK",
		financial: "FIN",
		unrest: "UNREST",
		conflict: "CONFLICT",
		contagion: "CONTAGION",
		costlySignals: "COSTLY SIGNALS",
		loadingSignals: "Loading feed matches…",
		noSignals: "No costly-signal text matched in recent Telegram/GDELT/news for this region. Scores can rise from domain priors or nearby contagion.",
		unknownSource: "unknown source"
	},
	gtBacktest: {
		title: "GT Backtest",
		layerOff: "Off — enable Strategic Risk Heatmap in Data Layers.",
		disabled: "GT analytics disabled (set GT_ANALYTICS_ENABLED=true).",
		loading: "Running historical validation…",
		refresh: "Refresh backtest",
		accuracy: "ACCURACY",
		confidence: "WILSON 95% LB",
		cases: "{count} labeled cases",
		threshold: "alert ≥ {value}",
		target: "target {value}",
		pass: "PASS",
		fail: "FAIL",
		collecting: "COLLECTING",
		meetsTarget: "Meets confidence target",
		belowTarget: "Below confidence target",
		misclassified: "{count} misclassified",
		tabBenchmark: "Benchmark",
		tabOperational: "Operational",
		benchmarkNote: "Static labeled corpus — regression test, not live forecasting.",
		operationalLoading: "Loading rolling operational trend…",
		operationalEmpty: "No weekly snapshots yet — freeze runs Mondays 00:05 UTC or via OpenClaw.",
		operationalWeeks: "{stored} weeks stored · {scorable} scorable",
		operationalLabeled: "{labeled} labeled · {pending} pending",
		operationalTrend: "Week-over-week accuracy",
		operationalImproving: "Improving vs prior scorable week",
		operationalFlat: "Flat or down vs prior scorable week",
		operationalMinLabels: "Need ≥{count} labels/week to score",
		microTitle: "3-day micro",
		microWindow: "{days}-day rolling avg · ignition Δ ≥ {delta}",
		microIgnitions: "{count} ignition(s)",
		microAlerted3d: "{count} above threshold on 3d avg",
		microEmpty: "Collecting daily readings — refreshes with GT ingest.",
		microRegionLine: "{region}: spot {spot} · 3d {avg} · Δ {delta}",
		microIgnitionBadge: "IGNITION"
	},
	roadCorridor: {
		analyzeHere: "ANALYZE HERE",
		analyzing: "Analyzing…",
		hintTrends: "Satellite truck-volume trends on major highways (~5 day revisit)",
		missingDeps: "Install backend road-corridor extras to analyze",
		missingCreds: "Add Sentinel creds in Settings → Imagery",
		panMapFirst: "Pan the map to choose an area",
		analyzeFailed: "Analysis failed"
	},
	recon: {
		title: "Recon Toolkit",
		proxyNote: "Server-side proxy · local operator only"
	},
	scm: {
		title: "Supply Chain",
		allClear: "No elevated risk at monitored Tier 1/2 nodes.",
		layerOff: "Off — enable Supply Chain in Data Layers to monitor fabs."
	},
	shodan: {
		title: "Shodan Connector",
		searchPlaceholder: "Search devices...",
		apiKeyRequired: "API Key Required",
		results: "results"
	},
	ai: {
		title: "AI Intel Panel",
		connected: "Connected",
		disconnected: "Disconnected"
	},
	meshChat: {
		title: "Meshtastic Chat",
		infonet: "Infonet",
		meshtastic: "Meshtastic",
		deadDrop: "Dead Drop",
		sendMessage: "Send message",
		placeholder: "Type a message..."
	},
	watchlist: {
		title: "Watchlist",
		empty: "No items watched",
		clear: "Clear"
	},
	timeline: {
		title: "Event Timeline",
		noEvents: "No events"
	},
	sar: {
		title: "SAR Ground-Change Detection",
		modeA: "Catalog Mode",
		modeB: "Anomaly Mode",
		aoiEditor: "AOI Editor",
		addAoi: "Add AOI",
		groundDeformation: "Ground Deformation",
		waterChange: "Water Change",
		vegetation: "Vegetation Disturbance",
		damage: "Damage Assessment",
		coherence: "Coherence Change"
	},
	telegram: {
		disclaimer: "WARNING: Content below is loaded from public Telegram channels. Shadowbroker does not host, verify, or endorse it. What you view is entirely at your own risk and has nothing to do with Shadowbroker.",
		loadMedia: "VIEW MEDIA (TELEGRAM)",
		openOriginal: "OPEN ON TELEGRAM →",
		embedTitle: "Telegram post embed",
		postsAtLocation: "{count} posts at this location — scroll for more",
		translatedFrom: "Translated from {lang}",
		showOriginal: "SHOW ORIGINAL ({lang})",
		showTranslation: "SHOW TRANSLATION"
	}
}, g = {
	brand: {
		title: "影子经纪人",
		subtitle: "全球威胁拦截系统",
		systemMetrics: "光学 可视:113 源:180 密度:1.42 0.8ms"
	},
	nav: {
		layers: "图层",
		intel: "情报",
		markets: "市场",
		dataLayers: "数据图层",
		prioritizingMapFeeds: "正在加载地图数据源",
		restoreUi: "恢复界面"
	},
	controls: {
		updates: "更新",
		checking: "检查中...",
		upToDate: "已是最新",
		checkFailed: "检查失败",
		node: "节点",
		terminal: "终端",
		coordinates: "坐标",
		location: "位置",
		style: "样式",
		solar: "太阳",
		hoverMap: "悬停地图...",
		na: "无数据"
	},
	update: {
		downloadInstaller: "下载安装包",
		installUpdate: "安装更新",
		autoUpdate: "自动更新",
		viewRelease: "查看发布",
		manualDownload: "手动下载",
		cancel: "取消",
		tryAgain: "重试",
		downloadingUpdate: "正在下载更新...",
		restarting: "正在重启...",
		updateFailed: "更新失败",
		dockerUpdate: "Docker 更新",
		dockerUpdateDetail: "Docker 容器需要通过拉取新镜像来更新。请在宿主机上运行："
	},
	node: {
		activateNode: "激活节点",
		activatingNode: "正在激活节点",
		nodeActivated: "节点已激活",
		stipulations: "条款须知",
		yes: "是",
		no: "否",
		agree: "同意",
		disagree: "不同意",
		turnOff: "关闭",
		keepOn: "保持开启",
		turningOff: "正在关闭...",
		activating: "激活中...",
		nodeOnline: "节点已上线",
		generatingIdentity: "正在生成身份...",
		identityReady: "身份已就绪",
		preparingTransport: "正在准备洋葱传输...",
		findingPeers: "正在寻找引导节点...",
		peersReady: "引导节点已就绪",
		syncingChain: "正在同步链...",
		soloNodeReady: "独立节点已就绪",
		synced: "已同步",
		events: "事件",
		peers: "节点",
		close: "关闭",
		activatePrompt: "是否在此安装上激活节点？",
		activateDetail: "这将启用本地参与节点，仅通过可用的 Wormhole 洋葱/RNS 节点同步 Infonet。默认禁用明文引导。",
		keepSyncing: "只要后端运行，节点就会持续同步 — 你可以关闭此浏览器标签页。要运行无仪表盘的无头节点，请使用",
		termsTitle: "继续即表示您同意：",
		term1: "此安装将保留公共 Infonet 链的本地副本。",
		term2: "全新安装不使用明文 Infonet 种子。",
		term3: "参与节点同步需要通过 Wormhole 的洋葱/RNS 节点。",
		term4: "您的后端可能会在后台与已配置的私有引导节点同步。",
		term5: "Wormhole 将 Infonet、门、死信箱和 DM 流量保留在混淆通道上。",
		syncTakingLong: "同步时间超出预期。您的节点已激活，将在后台继续同步。"
	},
	terminal: {
		infonetTerminal: "Infonet 终端",
		privateLaneReady: "私有通道已就绪",
		privateLaneStarting: "私有通道启动中",
		privateLaneOffline: "私有通道离线",
		enterTerminal: "进入 Wormhole 面向终端并与混淆 Infonet 公共空间同步？",
		terminalDetail: "终端通过 Wormhole 运行，用于混淆门、收件箱和实验性通信。",
		identityReady: "您的混淆身份已配置。现在进入将保持混淆通道与公共节点同步路径的分离。",
		identityNotReady: "这将开启 Wormhole 并打开混淆通道。如果您已有 Wormhole 身份，将复用。如果没有，将一次性引导并持续使用。",
		beforeYouEnter: "进入前请注意：",
		termTerminal1: "终端用于 Wormhole 门（过渡性私有通道）和死信箱/DM（更强的私有通道）。",
		termTerminal2: "您的参与节点可以独立保持活跃，无需更改此混淆身份通道。",
		termTerminal3: "Mesh 保持公共边界。Wormhole 是混淆公共空间。",
		wormholeCleanup: "WORMHOLE 清理：",
		cleanupDetail: "关闭 Infonet 终端将自动关闭 Wormhole。如果您强制关闭浏览器或关闭失败，Wormhole 可能会在后台继续运行。运行",
		cleanupFromRoot: "从项目根目录运行以确保完全停止。",
		enterWormhole: "进入 WORMHOLE",
		activateWormhole: "激活 WORMHOLE",
		entering: "正在进入...",
		goToMesh: "前往 MESH"
	},
	status: {
		off: "关闭",
		solo: "独立",
		connected: "已连接",
		syncing: "同步中",
		forkStop: "分叉停止",
		syncIssue: "同步异常",
		active: "活跃",
		participant: "参与者",
		nodeOff: "节点已关闭",
		bootstrapWarning: "引导警告"
	},
	backend: { offline: "后端离线 — 无法连接后端服务器。请检查后端容器是否正在运行以及 BACKEND_URL 是否正确。" },
	settings: {
		title: "设置",
		close: "关闭",
		general: "通用",
		feeds: "数据源",
		shodan: "Shodan",
		sar: "SAR",
		infonet: "Infonet",
		about: "关于"
	},
	legend: {
		title: "图例",
		close: "关闭"
	},
	onboarding: {
		welcome: "欢迎使用 ShadowBroker",
		getStarted: "开始使用"
	},
	news: {
		title: "新闻情报",
		noResults: "暂无结果",
		searchPlaceholder: "搜索新闻..."
	},
	filters: {
		title: "数据过滤",
		clear: "清除",
		all: "全部"
	},
	map: {
		findLocate: "查找/定位",
		searchPlaceholder: "搜索坐标、地点或呼号...",
		measure: "测量",
		clearMeasure: "清除测量"
	},
	layers: {
		aircraft: "航空器",
		commercialFlights: "商业航班",
		privateAircraft: "私人飞机",
		privateJets: "私人喷气机",
		militaryFlights: "军用飞行",
		trackedAircraft: "追踪航空器",
		gpsJamming: "GPS 干扰",
		maritime: "海事",
		militaryVessels: "军用船只",
		cargoShips: "货船",
		civilianShips: "民用船只",
		passengerShips: "客轮",
		trackedYachts: "追踪游艇",
		fishingActivity: "捕鱼活动",
		space: "太空",
		satellites: "卫星",
		gibsImagery: "GIBS 卫星图",
		highresSatellite: "高分辨率卫星",
		sentinelHub: "Sentinel Hub",
		viirsNightlights: "VIIRS 夜间灯光",
		hazards: "灾害",
		earthquakes: "地震",
		fires: "野火",
		ukraineAlerts: "乌克兰警报",
		weatherAlerts: "天气警报",
		volcanoes: "火山",
		airQuality: "空气质量",
		infrastructure: "基础设施",
		cctv: "监控摄像头",
		datacenters: "数据中心",
		internetOutages: "互联网中断",
		powerPlants: "发电厂",
		militaryBases: "军事基地",
		trains: "列车",
		sigint: "信号情报",
		kiwisdr: "KiwiSDR",
		pskReporter: "PSK 报告",
		satnogs: "SatNOGS",
		tinygs: "TinyGS",
		scanners: "扫描器",
		meshtastic: "Meshtastic",
		aprs: "APRS",
		overlays: "叠加层",
		ukraineFrontline: "乌克兰前线",
		globalIncidents: "全球事件",
		dayNight: "昼夜分界",
		correlations: "关联分析",
		contradictions: "矛盾检测",
		uapSightings: "UAP 目击",
		biosurveillance: "生物监测",
		wastewater: "废水监测",
		crowdThreat: "人群威胁",
		shodanOverlay: "Shodan 叠加",
		aiIntel: "AI 情报",
		sar: "SAR",
		roadCorridorTrends: "公路货运趋势",
		roadCorridorSource: "Copernicus S-2 · 趋势（非实时）",
		submarineCables: "海底电缆",
		malwareC2: "恶意软件 C2",
		scmSuppliers: "供应链供应商",
		cyberThreats: "网络威胁",
		telegramOsint: "Telegram OSINT",
		strategicRisk: "战略风险热力图",
		derivedOsint: "衍生 OSINT（战略风险）",
		derivedOsintSource: "实验功能 · 默认关闭"
	},
	gtLean: {
		title: "在低配节点上启用衍生 OSINT？",
		message: "Shadowbroker 检测到该节点 CPU 上限为 1 vCPU。开启地图图层通常安全，但启用后端引擎可能会拖慢 Telegram、GDELT 等 OSINT 抓取。",
		confirm: "仍要开启图层",
		cancel: "取消"
	},
	gtHud: {
		title: "GT 分析",
		dragHint: "拖动移动",
		collapse: "收起面板",
		expand: "展开面板"
	},
	gtAlerts: {
		title: "重点警报",
		counts: "地图 {plotted} · 跟踪 {tracked}（上限 {max}）",
		empty: "尚无可绘制区域 — 需要带地理标签的情报。",
		ignition: "点火",
		line: "风险 {risk} · 冲突 {conflict}",
		hint: "500 = 最大跟踪区域数，非事件数。点击飞往。"
	},
	gtRisk: {
		popupTitle: "战略风险",
		region: "区域",
		composite: "后验风险",
		financial: "金融",
		unrest: "动荡",
		conflict: "冲突",
		contagion: "传染",
		costlySignals: "成本信号",
		loadingSignals: "正在加载情报匹配…",
		noSignals: "该区域最近在 Telegram/GDELT/新闻中未匹配到成本信号文本。",
		unknownSource: "未知来源"
	},
	gtBacktest: {
		title: "GT 回测",
		layerOff: "已关闭 — 请在数据图层中启用战略风险热力图。",
		disabled: "GT 分析未启用（需设置 GT_ANALYTICS_ENABLED=true）。",
		loading: "正在运行历史验证…",
		refresh: "刷新回测",
		accuracy: "准确率",
		confidence: "Wilson 95% 下界",
		cases: "{count} 个标注案例",
		threshold: "警报阈值 ≥ {value}",
		target: "目标 {value}",
		pass: "通过",
		fail: "未通过",
		collecting: "采集中",
		meetsTarget: "达到置信目标",
		belowTarget: "低于置信目标",
		misclassified: "{count} 个误分类",
		tabBenchmark: "基准测试",
		tabOperational: "运营验证",
		benchmarkNote: "静态标注语料 — 回归测试，非实时预测。",
		operationalLoading: "正在加载滚动运营趋势…",
		operationalEmpty: "尚无周快照 — 每周一 00:05 UTC 自动冻结，或通过 OpenClaw。",
		operationalWeeks: "已存 {stored} 周 · {scorable} 周可评分",
		operationalLabeled: "已标注 {labeled} · 待标注 {pending}",
		operationalTrend: "逐周准确率",
		operationalImproving: "较上一可评分周有所提升",
		operationalFlat: "较上一可评分周持平或下降",
		operationalMinLabels: "每周需 ≥{count} 条标注才可评分",
		microTitle: "3日微观",
		microWindow: "{days}日滚动均值 · 点火 Δ ≥ {delta}",
		microIgnitions: "{count} 个点火",
		microAlerted3d: "{count} 个区域 3日均值超阈值",
		microEmpty: "正在采集日读数 — 随 GT 摄入更新。",
		microRegionLine: "{region}：即时 {spot} · 3日 {avg} · Δ {delta}",
		microIgnitionBadge: "点火"
	},
	roadCorridor: {
		analyzeHere: "分析此处",
		analyzing: "分析中…",
		hintTrends: "主要高速公路卫星卡车量趋势（约 5 天重访）",
		missingDeps: "请安装 backend road-corridor 可选依赖",
		missingCreds: "请在设置 → 影像 中添加 Sentinel 凭据",
		panMapFirst: "请先平移地图以选择区域",
		analyzeFailed: "分析失败"
	},
	recon: {
		title: "侦察工具包",
		proxyNote: "服务端代理 · 仅本地操作员"
	},
	scm: {
		title: "供应链",
		allClear: "受监控的 Tier 1/2 节点无升高风险。",
		layerOff: "已关闭 — 在数据图层中启用供应链以监控晶圆厂。"
	},
	shodan: {
		title: "Shodan 连接器",
		searchPlaceholder: "搜索设备...",
		apiKeyRequired: "需要 API Key",
		results: "结果"
	},
	ai: {
		title: "AI 情报面板",
		connected: "已连接",
		disconnected: "未连接"
	},
	meshChat: {
		title: "Meshtastic 聊天",
		infonet: "Infonet",
		meshtastic: "Meshtastic",
		deadDrop: "死信箱",
		sendMessage: "发送消息",
		placeholder: "输入消息..."
	},
	watchlist: {
		title: "监视列表",
		empty: "暂无监控项",
		clear: "清空"
	},
	timeline: {
		title: "事件时间线",
		noEvents: "暂无事件"
	},
	sar: {
		title: "SAR 地面变化检测",
		modeA: "目录模式",
		modeB: "异常检测模式",
		aoiEditor: "AOI 编辑器",
		addAoi: "添加关注区域",
		groundDeformation: "地面变形",
		waterChange: "水域变化",
		vegetation: "植被干扰",
		damage: "损毁评估",
		coherence: "相干变化"
	},
	telegram: {
		disclaimer: "警告：以下内容来自公开 Telegram 频道。Shadowbroker 不托管、不核实、不背书该内容。您自行承担一切风险，与 Shadowbroker 无关。",
		loadMedia: "查看媒体（Telegram）",
		openOriginal: "在 Telegram 打开 →",
		embedTitle: "Telegram 帖子嵌入",
		postsAtLocation: "此位置 {count} 条帖子 — 向下滚动查看更多",
		translatedFrom: "由 {lang} 翻译",
		showOriginal: "显示原文（{lang}）",
		showTranslation: "显示译文"
	}
}, _ = {
	brand: {
		title: "S H A D O W  B R O K E R",
		subtitle: "INTERCEPTION MONDIALE DES MENACES",
		systemMetrics: "OPTIC VIS:113 SRC:180 DENS:1.42 0.8ms"
	},
	nav: {
		layers: "COUCHES",
		intel: "RENSEIGNEMENTS",
		markets: "MARCHÉS",
		dataLayers: "COUCHES DE DONNÉES",
		prioritizingMapFeeds: "PRIORISATION DES FLUX CARTE",
		restoreUi: "RESTAURER L'INTERFACE"
	},
	controls: {
		updates: "MISES À JOUR",
		checking: "VÉRIFICATION...",
		upToDate: "À JOUR",
		checkFailed: "VÉRIFICATION ÉCHOUÉE",
		node: "NŒUD",
		terminal: "TERMINAL",
		coordinates: "COORDONNÉES",
		location: "LOCALISATION",
		style: "STYLE",
		solar: "SOLAIRE",
		hoverMap: "Survolez la carte...",
		na: "N/A"
	},
	update: {
		downloadInstaller: "TÉLÉCHARGER L'INSTALLATEUR",
		installUpdate: "INSTALLER LA MISE À JOUR",
		autoUpdate: "MISE À JOUR AUTO",
		viewRelease: "VOIR LA VERSION",
		manualDownload: "TÉLÉCHARGEMENT MANUEL",
		cancel: "ANNULER",
		tryAgain: "RÉESSAYER",
		downloadingUpdate: "TÉLÉCHARGEMENT DE LA MISE À JOUR...",
		restarting: "REDÉMARRAGE...",
		updateFailed: "MISE À JOUR ÉCHOUÉE",
		dockerUpdate: "MISE À JOUR DOCKER",
		dockerUpdateDetail: "Les conteneurs Docker doivent être mis à jour en tirant de nouvelles images.\n            Exécutez ceci sur votre machine hôte :"
	},
	node: {
		activateNode: "ACTIVER LE NŒUD",
		activatingNode: "ACTIVATION DU NŒUD",
		nodeActivated: "NŒUD ACTIVÉ",
		stipulations: "CONDITIONS",
		yes: "OUI",
		no: "NON",
		agree: "ACCEPTER",
		disagree: "REFUSER",
		turnOff: "DÉSACTIVER",
		keepOn: "GARDER ACTIVÉ",
		turningOff: "DÉSACTIVATION...",
		activating: "ACTIVATION...",
		nodeOnline: "NŒUD EN LIGNE",
		generatingIdentity: "Génération de l'identité...",
		identityReady: "Identité prête",
		preparingTransport: "Préparation du transport onion...",
		findingPeers: "Recherche de pairs d'amorçage...",
		peersReady: "Pairs d'amorçage prêts",
		syncingChain: "Synchronisation de la chaîne...",
		soloNodeReady: "Nœud solo prêt",
		synced: "Synchronisé",
		events: "événements",
		peers: "pairs",
		close: "FERMER",
		activatePrompt: "Voulez-vous activer un nœud sur cette installation ?",
		activateDetail: "Cela active votre nœud participant local et synchronise l'Infonet uniquement via les pairs onion/RNS Wormhole disponibles. L'amorçage par clearnet est désactivé par défaut.",
		keepSyncing: "Votre nœud continue de se synchroniser tant que le backend est en cours d'exécution — vous pouvez fermer cet onglet de navigateur. Pour exécuter un nœud headless sans le tableau de bord, utilisez",
		termsTitle: "EN CONTINUANT VOUS ACCEPTEZ :",
		term1: "Cette installation peut conserver une copie locale de la chaîne Infonet publique.",
		term2: "Les nouvelles installations n'utilisent pas de seed Infonet clearnet.",
		term3: "La synchronisation du nœud participant nécessite un pair onion/RNS via Wormhole.",
		term4: "Votre backend peut se synchroniser avec des pairs d'amorçage privés configurés en arrière-plan.",
		term5: "Wormhole maintient l'Infonet, les gates, le Dead Drop et le trafic DM sur la voie obfusquée.",
		syncTakingLong: "La synchronisation prend plus de temps que prévu. Votre nœud est actif et continuera à se synchroniser en arrière-plan."
	},
	terminal: {
		infonetTerminal: "TERMINAL INFONET",
		privateLaneReady: "VOIE PRIVÉE PRÊTE",
		privateLaneStarting: "VOIE PRIVÉE DÉMARRAGE",
		privateLaneOffline: "VOIE PRIVÉE HORS LIGNE",
		enterTerminal: "Entrer dans le terminal Wormhole et se synchroniser avec les communs obfusqués de l'Infonet ?",
		terminalDetail: "Le terminal fonctionne via Wormhole pour les gates obfusqués, la boîte de réception et les communications expérimentales.",
		identityReady: "Votre identité obfusquée est déjà provisionnée. Entrer maintenant maintient la voie obfusquée séparée du chemin de synchronisation du nœud public.",
		identityNotReady: "Cela active Wormhole et ouvre la voie obfusquée. Si vous avez déjà une identité Wormhole, elle sera réutilisée. Si vous n'en avez pas, une sera amorcée une fois puis conservée.",
		beforeYouEnter: "AVANT D'ENTRER :",
		termTerminal1: "Le terminal est destiné aux gates Wormhole (voie privée transitoire) et au Dead Drop / DM (voie privée renforcée).",
		termTerminal2: "Votre nœud participant peut rester actif séparément sans modifier cette voie d'identité obfusquée.",
		termTerminal3: "Mesh reste le périmètre public. Wormhole est le commun obfusqué.",
		wormholeCleanup: "NETTOYAGE WORMHOLE :",
		cleanupDetail: "Fermer le terminal Infonet arrêtera Wormhole automatiquement. Si vous forcez la fermeture du navigateur ou si l'arrêt échoue, Wormhole peut continuer à tourner en arrière-plan. Exécutez",
		cleanupFromRoot: "depuis la racine du projet pour vous assurer qu'il est complètement arrêté.",
		enterWormhole: "ENTRER DANS WORMHOLE",
		activateWormhole: "ACTIVER WORMHOLE",
		entering: "ENTRÉE...",
		goToMesh: "ALLER AU MESH"
	},
	status: {
		off: "ARRÊTÉ",
		solo: "SOLO",
		connected: "CONNECTÉ",
		syncing: "SYNCHRONISATION",
		forkStop: "ARRÊT FOURCHE",
		syncIssue: "PROBLÈME DE SYNC",
		active: "ACTIF",
		participant: "participant",
		nodeOff: "nœud • arrêté",
		bootstrapWarning: "nœud • avertissement de démarrage"
	},
	backend: { offline: "BACKEND HORS LIGNE — Impossible de joindre le serveur backend. Vérifiez que le conteneur backend est en cours d'exécution et que BACKEND_URL est correct." },
	settings: {
		title: "Paramètres",
		close: "Fermer",
		general: "Général",
		feeds: "Flux",
		shodan: "Shodan",
		sar: "SAR",
		infonet: "Infonet",
		about: "À propos"
	},
	legend: {
		title: "Légende",
		close: "Fermer"
	},
	onboarding: {
		welcome: "Bienvenue dans ShadowBroker",
		getStarted: "Commencer"
	},
	news: {
		title: "Renseignement Actualités",
		noResults: "Aucun résultat",
		searchPlaceholder: "Rechercher des actualités..."
	},
	filters: {
		title: "Filtres de données",
		clear: "Effacer",
		all: "Tout"
	},
	map: {
		findLocate: "Rechercher / Localiser",
		searchPlaceholder: "Rechercher coordonnées, lieu ou indicatif...",
		measure: "Mesurer",
		clearMeasure: "Effacer la mesure"
	},
	layers: {
		aircraft: "Aéronefs",
		commercialFlights: "Vols commerciaux",
		privateAircraft: "Aéronefs privés",
		privateJets: "Jets privés",
		militaryFlights: "Vols militaires",
		trackedAircraft: "Aéronefs suivis",
		gpsJamming: "Brouillage GPS",
		maritime: "Maritime",
		militaryVessels: "Navires militaires",
		cargoShips: "Navires de charge",
		civilianShips: "Navires civils",
		passengerShips: "Navires à passagers",
		trackedYachts: "Yachts suivis",
		fishingActivity: "Activité de pêche",
		space: "Espace",
		satellites: "Satellites",
		gibsImagery: "Imagerie GIBS",
		highresSatellite: "Satellite haute résolution",
		sentinelHub: "Sentinel Hub",
		viirsNightlights: "Éclairage nocturne VIIRS",
		hazards: "Dangers",
		earthquakes: "Séismes",
		fires: "Incendies",
		ukraineAlerts: "Alertes Ukraine",
		weatherAlerts: "Alertes météo",
		volcanoes: "Volcans",
		airQuality: "Qualité de l'air",
		infrastructure: "Infrastructure",
		cctv: "CCTV",
		datacenters: "Centres de données",
		internetOutages: "Pannes Internet",
		powerPlants: "Centrales électriques",
		militaryBases: "Bases militaires",
		trains: "Trains",
		sigint: "SIGINT",
		kiwisdr: "KiwiSDR",
		pskReporter: "PSK Reporter",
		satnogs: "SatNOGS",
		tinygs: "TinyGS",
		scanners: "Scanners",
		meshtastic: "Meshtastic",
		aprs: "APRS",
		overlays: "Couches superposées",
		ukraineFrontline: "Ligne de front Ukraine",
		globalIncidents: "Incidents mondiaux",
		dayNight: "Jour/Nuit",
		correlations: "Corrélations",
		contradictions: "Contradictions",
		uapSightings: "Observations de PAN",
		biosurveillance: "Biosurveillance",
		wastewater: "Eaux usées",
		crowdThreat: "CrowdThreat",
		shodanOverlay: "Couche Shodan",
		aiIntel: "Infos IA",
		sar: "SAR",
		roadCorridorTrends: "Tendances fret routier",
		roadCorridorSource: "Copernicus S-2 · tendances (pas en direct)",
		submarineCables: "Câbles sous-marins",
		malwareC2: "Malware C2",
		scmSuppliers: "Fournisseurs SCM",
		cyberThreats: "Cybermenaces",
		telegramOsint: "OSINT Telegram",
		strategicRisk: "Carte de risque stratégique",
		derivedOsint: "OSINT dérivé (risque stratégique)",
		derivedOsintSource: "Expérimental · désactivé par défaut"
	},
	gtLean: {
		title: "Activer l'OSINT dérivé sur un nœud limité ?",
		message: "Shadowbroker a détecté une limite de 1 vCPU. La couche carte peut s'afficher, mais activer le moteur backend peut ralentir les flux OSINT.",
		confirm: "Activer la couche",
		cancel: "Annuler"
	},
	gtHud: {
		title: "ANALYTIQUE GT",
		dragHint: "glisser pour déplacer",
		collapse: "Réduire le panneau",
		expand: "Développer le panneau"
	},
	gtAlerts: {
		title: "ALERTES TOP",
		counts: "{plotted} sur carte · {tracked} suivies (max {max})",
		empty: "Aucune région plottable — intel géolocalisée requise.",
		ignition: "IGNITE",
		line: "risque {risk} · conflit {conflict}",
		hint: "500 = régions max suivies, pas des événements. Cliquer pour voler."
	},
	gtRisk: {
		popupTitle: "RISQUE STRATÉGIQUE",
		region: "RÉGION",
		composite: "RISQUE POSTÉRIEUR",
		financial: "FIN",
		unrest: "TROUBLES",
		conflict: "CONFLIT",
		contagion: "CONTAGION",
		costlySignals: "SIGNAUX COÛTEUX",
		loadingSignals: "Chargement des correspondances…",
		noSignals: "Aucun signal coûteux récent pour cette région dans Telegram/GDELT/news.",
		unknownSource: "source inconnue"
	},
	gtBacktest: {
		title: "Backtest GT",
		layerOff: "Désactivé — activez la carte de risque stratégique dans Couches.",
		disabled: "Analytique GT désactivée (GT_ANALYTICS_ENABLED=true).",
		loading: "Validation historique en cours…",
		refresh: "Actualiser le backtest",
		accuracy: "PRÉCISION",
		confidence: "BORNE INF. WILSON 95%",
		cases: "{count} cas étiquetés",
		threshold: "alerte ≥ {value}",
		target: "cible {value}",
		pass: "OK",
		fail: "ÉCHEC",
		collecting: "COLLECTE",
		meetsTarget: "Objectif de confiance atteint",
		belowTarget: "Sous l'objectif de confiance",
		misclassified: "{count} mal classés",
		tabBenchmark: "Référence",
		tabOperational: "Opérationnel",
		benchmarkNote: "Corpus historique étiqueté — test de régression, pas prévision live.",
		operationalLoading: "Chargement de la tendance opérationnelle…",
		operationalEmpty: "Aucun instantané hebdomadaire — gel chaque lundi 00:05 UTC ou via OpenClaw.",
		operationalWeeks: "{stored} semaines · {scorable} exploitables",
		operationalLabeled: "{labeled} étiquetés · {pending} en attente",
		operationalTrend: "Précision semaine après semaine",
		operationalImproving: "En hausse vs semaine précédente",
		operationalFlat: "Stable ou en baisse vs semaine précédente",
		operationalMinLabels: "≥{count} étiquettes/semaine requis",
		microTitle: "Micro 3 jours",
		microWindow: "Moy. glissante {days} j · ignition Δ ≥ {delta}",
		microIgnitions: "{count} ignition(s)",
		microAlerted3d: "{count} au-dessus du seuil (moy. 3j)",
		microEmpty: "Lecture quotidienne en cours — mis à jour à chaque ingest GT.",
		microRegionLine: "{region}: spot {spot} · 3j {avg} · Δ {delta}",
		microIgnitionBadge: "IGNITION"
	},
	roadCorridor: {
		analyzeHere: "ANALYSER ICI",
		analyzing: "Analyse…",
		hintTrends: "Tendances camions par satellite sur autoroutes (~5 j de revisite)",
		missingDeps: "Installer les extras backend road-corridor",
		missingCreds: "Ajouter les identifiants Sentinel dans Réglages → Imagerie",
		panMapFirst: "Déplacez la carte pour choisir une zone",
		analyzeFailed: "Échec de l'analyse"
	},
	recon: {
		title: "Boîte à outils recon",
		proxyNote: "Proxy côté serveur · opérateur local uniquement"
	},
	scm: {
		title: "Chaîne d'approvisionnement",
		allClear: "Aucun risque élevé sur les nœuds Tier 1/2 surveillés.",
		layerOff: "Désactivé — activez la couche dans Données pour surveiller les fabs."
	},
	shodan: {
		title: "Connecteur Shodan",
		searchPlaceholder: "Rechercher des appareils...",
		apiKeyRequired: "Clé API requise",
		results: "résultats"
	},
	ai: {
		title: "Panneau d'infos IA",
		connected: "Connecté",
		disconnected: "Déconnecté"
	},
	meshChat: {
		title: "Chat Meshtastic",
		infonet: "Infonet",
		meshtastic: "Meshtastic",
		deadDrop: "Dead Drop",
		sendMessage: "Envoyer un message",
		placeholder: "Tapez un message..."
	},
	watchlist: {
		title: "Liste de surveillance",
		empty: "Aucun élément surveillé",
		clear: "Effacer"
	},
	timeline: {
		title: "Chronologie des événements",
		noEvents: "Aucun événement"
	},
	sar: {
		title: "Détection de changements au sol SAR",
		modeA: "Mode Catalogue",
		modeB: "Mode Anomalie",
		aoiEditor: "Éditeur AOI",
		addAoi: "Ajouter AOI",
		groundDeformation: "Déformation du sol",
		waterChange: "Changement hydrique",
		vegetation: "Perturbation végétale",
		damage: "Évaluation des dégâts",
		coherence: "Changement de cohérence"
	},
	telegram: {
		disclaimer: "AVERTISSEMENT : le contenu ci-dessous provient de canaux Telegram publics. Shadowbroker ne l'héberge pas, ne le vérifie pas et ne le cautionne pas. Vous le consultez à vos risques et cela n'a aucun lien avec Shadowbroker.",
		loadMedia: "AFFICHER LE MÉDIA (TELEGRAM)",
		openOriginal: "OUVRIR SUR TELEGRAM →",
		embedTitle: "Intégration Telegram",
		postsAtLocation: "{count} posts à cet endroit — faites défiler",
		translatedFrom: "Traduit depuis {lang}",
		showOriginal: "AFFICHER L'ORIGINAL ({lang})",
		showTranslation: "AFFICHER LA TRADUCTION"
	}
}, v = [
	{
		code: "en",
		label: "English"
	},
	{
		code: "zh-CN",
		label: "中文 (简体)"
	},
	{
		code: "fr",
		label: "Français"
	}
], y = {
	en: h,
	"zh-CN": g,
	fr: _
};
function b(e) {
	return typeof e == "string" && v.some((t) => t.code === e);
}
function x(e, t) {
	let n = t.split("."), r = e;
	for (let e of n) if (r && typeof r == "object" && e in r) r = r[e];
	else return t;
	return typeof r == "string" ? r : t;
}
var S = (0, u.createContext)({
	locale: "en",
	setLocale: () => {},
	t: (e) => x(h, e)
});
function C({ children: e }) {
	let [t, n] = (0, u.useState)(() => {
		if (typeof window > "u") return "en";
		let e = localStorage.getItem("sb_locale");
		if (b(e)) return e;
		let t = (navigator.language || "").toLowerCase(), n = v.find((e) => e.code !== "en" && t.startsWith(e.code.toLowerCase().split("-")[0]));
		return n ? n.code : "en";
	}), r = (0, u.useCallback)((e) => {
		b(e) && (n(e), typeof window < "u" && localStorage.setItem("sb_locale", e));
	}, []), i = (0, u.useCallback)((e) => x(y[t] ?? y.en, e), [t]);
	return /* @__PURE__ */ (0, d.jsx)(S.Provider, {
		value: {
			locale: t,
			setLocale: r,
			t: i
		},
		children: e
	});
}
function w() {
	return (0, u.useContext)(S);
}
//#endregion
//#region src/embed/nextDynamicShim.tsx
function T(e) {
	return typeof e == "object" && !!e && "default" in e;
}
function E(e, t) {
	let n = u.lazy(async () => {
		let t = await e();
		return T(t) ? t : { default: t };
	});
	return function(e) {
		return /* @__PURE__ */ (0, d.jsx)(u.Suspense, {
			fallback: null,
			children: /* @__PURE__ */ (0, d.jsx)(n, { ...e })
		});
	};
}
//#endregion
//#region node_modules/lucide-react/dist/esm/shared/src/utils/mergeClasses.js
var D = (...e) => e.filter((e, t, n) => !!e && e.trim() !== "" && n.indexOf(e) === t).join(" ").trim(), O = (e) => e.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(), k = (e) => e.replace(/^([A-Z])|[\s-_]+(\w)/g, (e, t, n) => n ? n.toUpperCase() : t.toLowerCase()), A = (e) => {
	let t = k(e);
	return t.charAt(0).toUpperCase() + t.slice(1);
}, j = {
	xmlns: "http://www.w3.org/2000/svg",
	width: 24,
	height: 24,
	viewBox: "0 0 24 24",
	fill: "none",
	stroke: "currentColor",
	strokeWidth: 2,
	strokeLinecap: "round",
	strokeLinejoin: "round"
}, ee = (e) => {
	for (let t in e) if (t.startsWith("aria-") || t === "role" || t === "title") return !0;
	return !1;
}, M = (0, u.forwardRef)(({ color: e = "currentColor", size: t = 24, strokeWidth: n = 2, absoluteStrokeWidth: r, className: i = "", children: a, iconNode: o, ...s }, c) => (0, u.createElement)("svg", {
	ref: c,
	...j,
	width: t,
	height: t,
	stroke: e,
	strokeWidth: r ? Number(n) * 24 / Number(t) : n,
	className: D("lucide", i),
	...!a && !ee(s) && { "aria-hidden": "true" },
	...s
}, [...o.map(([e, t]) => (0, u.createElement)(e, t)), ...Array.isArray(a) ? a : [a]])), N = (e, t) => {
	let n = (0, u.forwardRef)(({ className: n, ...r }, i) => (0, u.createElement)(M, {
		ref: i,
		iconNode: t,
		className: D(`lucide-${O(A(e))}`, `lucide-${e}`, n),
		...r
	}));
	return n.displayName = A(e), n;
}, te = N("activity", [["path", {
	d: "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
	key: "169zse"
}]]), P = N("external-link", [
	["path", {
		d: "M15 3h6v6",
		key: "1q9fwt"
	}],
	["path", {
		d: "M10 14 21 3",
		key: "gplh6r"
	}],
	["path", {
		d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",
		key: "a6xqqp"
	}]
]), F = N("pause", [["rect", {
	x: "14",
	y: "3",
	width: "5",
	height: "18",
	rx: "1",
	key: "kaeet6"
}], ["rect", {
	x: "5",
	y: "3",
	width: "5",
	height: "18",
	rx: "1",
	key: "1wsw3u"
}]]), ne = N("play", [["path", {
	d: "M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z",
	key: "10ikf1"
}]]), re = N("radar", [
	["path", {
		d: "M19.07 4.93A10 10 0 0 0 6.99 3.34",
		key: "z3du51"
	}],
	["path", {
		d: "M4 6h.01",
		key: "oypzma"
	}],
	["path", {
		d: "M2.29 9.62A10 10 0 1 0 21.31 8.35",
		key: "qzzz0"
	}],
	["path", {
		d: "M16.24 7.76A6 6 0 1 0 8.23 16.67",
		key: "1yjesh"
	}],
	["path", {
		d: "M12 18h.01",
		key: "mhygvu"
	}],
	["path", {
		d: "M17.99 11.66A6 6 0 0 1 15.77 16.67",
		key: "1u2y91"
	}],
	["circle", {
		cx: "12",
		cy: "12",
		r: "2",
		key: "1c9p78"
	}],
	["path", {
		d: "m13.41 10.59 5.66-5.66",
		key: "mhq4k0"
	}]
]), ie = N("radio", [
	["path", {
		d: "M16.247 7.761a6 6 0 0 1 0 8.478",
		key: "1fwjs5"
	}],
	["path", {
		d: "M19.075 4.933a10 10 0 0 1 0 14.134",
		key: "ehdyv1"
	}],
	["path", {
		d: "M4.925 19.067a10 10 0 0 1 0-14.134",
		key: "1q22gi"
	}],
	["path", {
		d: "M7.753 16.239a6 6 0 0 1 0-8.478",
		key: "r2q7qm"
	}],
	["circle", {
		cx: "12",
		cy: "12",
		r: "2",
		key: "1c9p78"
	}]
]), ae = N("satellite", [
	["path", {
		d: "m13.5 6.5-3.148-3.148a1.205 1.205 0 0 0-1.704 0L6.352 5.648a1.205 1.205 0 0 0 0 1.704L9.5 10.5",
		key: "dzhfyz"
	}],
	["path", {
		d: "M16.5 7.5 19 5",
		key: "1ltcjm"
	}],
	["path", {
		d: "m17.5 10.5 3.148 3.148a1.205 1.205 0 0 1 0 1.704l-2.296 2.296a1.205 1.205 0 0 1-1.704 0L13.5 14.5",
		key: "nfoymv"
	}],
	["path", {
		d: "M9 21a6 6 0 0 0-6-6",
		key: "1iajcf"
	}],
	["path", {
		d: "M9.352 10.648a1.205 1.205 0 0 0 0 1.704l2.296 2.296a1.205 1.205 0 0 0 1.704 0l4.296-4.296a1.205 1.205 0 0 0 0-1.704l-2.296-2.296a1.205 1.205 0 0 0-1.704 0z",
		key: "nv9zqy"
	}]
]), oe = N("send", [["path", {
	d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",
	key: "1ffxy3"
}], ["path", {
	d: "m21.854 2.147-10.94 10.939",
	key: "12cjpa"
}]]), se = N("trash-2", [
	["path", {
		d: "M10 11v6",
		key: "nco0om"
	}],
	["path", {
		d: "M14 11v6",
		key: "outv1u"
	}],
	["path", {
		d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",
		key: "miytrc"
	}],
	["path", {
		d: "M3 6h18",
		key: "d0wm0j"
	}],
	["path", {
		d: "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
		key: "e791ji"
	}]
]), ce = N("triangle-alert", [
	["path", {
		d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
		key: "wmoenq"
	}],
	["path", {
		d: "M12 9v4",
		key: "juzpu7"
	}],
	["path", {
		d: "M12 17h.01",
		key: "p32p05"
	}]
]), I = /* @__PURE__ */ new Map(), le = /* @__PURE__ */ new Set(), L = {}, R = "connecting", z = /* @__PURE__ */ new Set();
function ue(e) {
	let t = [];
	for (let n of Object.keys(e)) {
		let r = e[n];
		L[n] !== r && (L[n] = r, t.push(n));
	}
	for (let e of t) {
		let t = I.get(e);
		if (t) for (let e of t) e();
	}
	if (t.length > 0) for (let e of le) e();
}
function de(e) {
	if (R !== e) {
		R = e;
		for (let e of z) e();
	}
}
function fe(e) {
	return L[e];
}
function pe() {
	return R;
}
function me(e) {
	let t = (0, u.useMemo)(() => (t) => {
		let n = I.get(e);
		return n || (n = /* @__PURE__ */ new Set(), I.set(e, n)), n.add(t), () => {
			n.delete(t), n.size === 0 && I.delete(e);
		};
	}, [e]), n = (0, u.useMemo)(() => () => L[e], [e]);
	return (0, u.useSyncExternalStore)(t, n, n);
}
function he(e) {
	let t = (0, u.useRef)(e), n = (0, u.useMemo)(() => (t.current = e, e), [e.join(",")]), r = (0, u.useMemo)(() => (e) => {
		let t = [];
		for (let r of n) {
			let n = I.get(r);
			n || (n = /* @__PURE__ */ new Set(), I.set(r, n)), n.add(e), t.push(() => {
				n.delete(e), n.size === 0 && I.delete(r);
			});
		}
		return () => {
			for (let e of t) e();
		};
	}, [n]), i = (0, u.useRef)(null), a = (0, u.useMemo)(() => () => {
		let e = i.current, t = e !== null, r = {};
		for (let i of n) {
			let n = L[i];
			r[i] = n, t && e[i] !== n && (t = !1);
		}
		if (t) return e;
		let a = r;
		return i.current = a, a;
	}, [n]);
	return (0, u.useSyncExternalStore)(r, a, a);
}
function ge() {
	let e = (0, u.useMemo)(() => (e) => (z.add(e), () => {
		z.delete(e);
	}), []), t = (0, u.useMemo)(() => () => R, []);
	return (0, u.useSyncExternalStore)(e, t, t);
}
//#endregion
//#region src/lib/liveDataViewport.ts
var B = null;
function _e(e) {
	let t = Math.max(0, e.north - e.south), n = e.east - e.west;
	return n < 0 && (n += 360), n >= 300 || t >= 120;
}
function ve(e) {
	if (e === null) {
		B = null;
		return;
	}
	if (!Number.isFinite(e.south) || !Number.isFinite(e.west) || !Number.isFinite(e.north) || !Number.isFinite(e.east)) {
		B = null;
		return;
	}
	if (_e(e)) {
		B = null;
		return;
	}
	B = e;
}
function ye() {
	return B;
}
function be() {
	let e = B;
	return e ? `${Math.floor(e.south)},${Math.floor(e.west)},${Math.ceil(e.north)},${Math.ceil(e.east)}` : null;
}
function xe(e) {
	let t = B;
	return t ? `${e}${e.includes("?") ? "&" : "?"}s=${Math.floor(t.south)}&w=${Math.floor(t.west)}&n=${Math.ceil(t.north)}&e=${Math.ceil(t.east)}` : e;
}
//#endregion
//#region src/lib/viewportPrivacy.ts
var Se = 3958.7613, V = 180 / Math.PI, Ce = Math.PI / 180, we = 3e3;
function H(e, t, n) {
	return Math.max(t, Math.min(n, e));
}
function U(e) {
	if (!Number.isFinite(e)) return 0;
	let t = ((e + 180) % 360 + 360) % 360 - 180;
	return t === -180 && e > 0 && (t = 180), t;
}
function W(e) {
	let t = H(e.south, -90, 90), n = H(e.north, -90, 90), r = Math.abs(e.east - e.west);
	if (!Number.isFinite(r) || r >= 360) return {
		south: t,
		west: -180,
		north: n,
		east: 180
	};
	let i = U(e.west), a = U(e.east);
	return a < i ? {
		south: t,
		west: -180,
		north: n,
		east: 180
	} : {
		south: t,
		west: i,
		north: n,
		east: a
	};
}
function Te(e, t = we) {
	let n = W(e);
	if (!Number.isFinite(t) || t <= 0 || n.west === -180 && n.east === 180) return n;
	let r = (n.south + n.north) / 2, i = (n.west + n.east) / 2, a = t / Se, o = a * V, s = r * Ce, c = Math.cos(s), l = 180;
	if (c > 1e-6) {
		let e = Math.sin(a) / c;
		l = Math.min(180, Math.asin(Math.min(1, Math.max(-1, e))) * V);
	}
	let u = H(Math.min(n.south, r - o), -90, 90), d = H(Math.max(n.north, r + o), -90, 90), f = i - l, p = i + l;
	return f < -180 || p > 180 ? {
		south: u,
		west: -180,
		north: d,
		east: 180
	} : W({
		south: u,
		west: Math.min(n.west, f),
		north: d,
		east: Math.max(n.east, p)
	});
}
function Ee(e) {
	let t = Math.abs(e.north - e.south), n = Math.abs(e.east - e.west), r = Math.max(t, n);
	return !Number.isFinite(r) || r >= 180 ? 5 : r >= 80 ? 2 : r >= 20 ? 1 : r >= 8 ? .25 : r >= 3 ? .1 : .05;
}
function De(e) {
	return e >= 1 ? 0 : 2;
}
function G(e, t) {
	return Math.floor(e / t) * t;
}
function K(e, t) {
	return Math.ceil(e / t) * t;
}
function Oe(e, t) {
	let n = De(t), r = Number(H(G(e.south, t), -90, 90).toFixed(n)), i = Number(H(G(e.west, t), -180, 180).toFixed(n)), a = Number(H(K(e.north, t), -90, 90).toFixed(n)), o = Number(H(K(e.east, t), -180, 180).toFixed(n));
	return o - i >= 360 ? {
		south: r,
		west: -180,
		north: a,
		east: 180
	} : {
		south: r,
		west: i,
		north: a,
		east: o
	};
}
function ke(e) {
	let t = W(e);
	return t.west === -180 && t.east === 180 ? t : Oe(t, Ee(t));
}
//#endregion
//#region src/components/map/hooks/useViewportBounds.ts
var Ae = 2500, q = 12e3, J = 1.5, Y = "shadowbroker:viewport-committed";
function je(e, t) {
	return e ? Math.abs(e.south - t.south) > J || Math.abs(e.west - t.west) > J || Math.abs(e.north - t.north) > J || Math.abs(e.east - t.east) > J : !0;
}
function Me(e, t, r = !0) {
	let [i, a] = (0, u.useState)([
		-180,
		-90,
		180,
		90
	]), o = (0, u.useRef)(null), s = (0, u.useRef)(null), c = (0, u.useRef)(0), l = (0, u.useRef)(null), d = (0, u.useCallback)(() => {
		let i = e.current?.getMap();
		if (!i) return;
		let u = i.getBounds(), d = u.getNorth() - u.getSouth(), f = u.getEast() - u.getWest(), p = .2;
		a([
			u.getWest() - f * p,
			u.getSouth() - d * p,
			u.getEast() + f * p,
			u.getNorth() + d * p
		]);
		let m = ke(Te(W({
			south: u.getSouth(),
			west: u.getWest(),
			north: u.getNorth(),
			east: u.getEast()
		})));
		t && "current" in t && (t.current = m), je(l.current, m) && (l.current = m, window.dispatchEvent(new CustomEvent(Y))), ve({
			south: m.south,
			west: m.west,
			north: m.north,
			east: m.east
		}), o.current && clearTimeout(o.current), o.current = setTimeout(() => {
			if (!r) {
				s.current = null, c.current = 0;
				return;
			}
			let e = Date.now();
			!je(s.current, m) && e - c.current < q || e - c.current < q || (s.current = m, c.current = e, fetch(`${n}/api/viewport`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					s: m.south,
					w: m.west,
					n: m.north,
					e: m.east
				})
			}).catch((e) => console.error("Failed to update backend viewport:", e)));
		}, Ae);
	}, [
		r,
		e,
		t
	]);
	return {
		mapBounds: i,
		inView: (0, u.useCallback)((e, t) => t >= i[0] && t <= i[2] && e >= i[1] && e <= i[3], [i]),
		updateBounds: d,
		scheduleBoundsUpdate: (0, u.useCallback)(() => {
			d();
		}, [d])
	};
}
//#endregion
//#region src/components/ui/ConfirmDialog.tsx
var Ne = ({ open: e, title: t, message: n, confirmLabel: r = "CONFIRM", cancelLabel: i = "CANCEL", danger: a = !0, onConfirm: o, onCancel: s }) => {
	let c = (0, u.useRef)(null);
	(0, u.useEffect)(() => {
		e && setTimeout(() => c.current?.focus(), 50);
	}, [e]);
	let l = (0, u.useCallback)((e) => {
		e.stopPropagation(), e.nativeEvent.stopImmediatePropagation(), e.key === "Escape" && s(), e.key === "Enter" && o();
	}, [o, s]);
	if (!e) return null;
	let f = a ? "#ef4444" : "#8b5cf6";
	return /* @__PURE__ */ (0, d.jsx)("div", {
		className: "fixed inset-0 flex items-center justify-center",
		style: {
			zIndex: 99999,
			background: "rgba(0,0,0,0.65)",
			backdropFilter: "blur(2px)"
		},
		onClick: s,
		onKeyDown: l,
		children: /* @__PURE__ */ (0, d.jsxs)("div", {
			className: "bg-[#0d0d1a] border-2 font-mono text-white max-w-sm w-full mx-4",
			style: {
				borderColor: `${f}88`,
				boxShadow: `0 20px 60px rgba(0,0,0,0.8), 0 0 0 1px ${f}33`
			},
			onClick: (e) => e.stopPropagation(),
			children: [
				/* @__PURE__ */ (0, d.jsx)("div", {
					className: "px-4 py-2.5 border-b text-[11px] uppercase tracking-[0.2em] font-bold",
					style: {
						borderColor: `${f}44`,
						background: `${f}15`,
						color: f
					},
					children: t
				}),
				/* @__PURE__ */ (0, d.jsx)("div", {
					className: "px-4 py-4",
					children: /* @__PURE__ */ (0, d.jsx)("p", {
						className: "text-[12px] text-gray-300 leading-relaxed whitespace-pre-wrap",
						children: n
					})
				}),
				/* @__PURE__ */ (0, d.jsxs)("div", {
					className: "flex gap-2 px-4 pb-4",
					children: [/* @__PURE__ */ (0, d.jsx)("button", {
						ref: c,
						type: "button",
						onClick: o,
						className: "flex-1 py-2 text-[11px] font-mono tracking-wider border transition-colors",
						style: {
							background: `${f}30`,
							borderColor: `${f}66`,
							color: a ? "#fca5a5" : "#c4b5fd"
						},
						onMouseEnter: (e) => {
							e.currentTarget.style.background = `${f}50`;
						},
						onMouseLeave: (e) => {
							e.currentTarget.style.background = `${f}30`;
						},
						children: r
					}), /* @__PURE__ */ (0, d.jsx)("button", {
						type: "button",
						onClick: s,
						className: "px-4 py-2 text-[11px] font-mono tracking-wider border border-gray-600/40 text-gray-400 hover:text-white hover:border-gray-500/60 transition-colors",
						children: i
					})]
				})
			]
		})
	});
};
//#endregion
//#region src/lib/gtAlerts.ts
function Pe(e) {
	let t = String(e || "").trim();
	if (!t) return "unknown";
	let n = t.match(/^(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)$/);
	if (n) return `${Number(n[1]).toFixed(2)}°, ${Number(n[2]).toFixed(2)}°`;
	let r = t.split(",").map((e) => e.trim()).filter(Boolean);
	if (r.length >= 2) {
		let e = Number(r[0]), t = Number(r[r.length - 1]);
		if (Number.isFinite(e) && Number.isFinite(t)) return `${e.toFixed(2)}°, ${t.toFixed(2)}°`;
	}
	return t.replace(/_/g, " ");
}
function Fe(e) {
	if (!Array.isArray(e) || e.length < 2) return null;
	let t = Number(e[0]), n = Number(e[1]);
	return !Number.isFinite(n) || !Number.isFinite(t) || Math.abs(n) < .001 && Math.abs(t) < .001 ? null : {
		lat: n,
		lng: t
	};
}
function Ie(e) {
	let t = Number(e.risk ?? 0), n = Number(e.financial ?? 0), r = Number(e.unrest ?? 0), i = Number(e.conflict ?? 0);
	return Math.max(t, n, r, i);
}
function Le(e, t = 8) {
	let n = e?.heatmap?.features || [], r = e?.meta, i = [];
	for (let e of n) {
		let t = Fe(e.geometry?.coordinates);
		if (!t) continue;
		let n = e.properties || {}, r = String(n.region || "").trim().toLowerCase();
		r && i.push({
			region: r,
			regionLabel: Pe(r),
			risk: Number(n.risk ?? 0),
			financial: Number(n.financial ?? 0),
			unrest: Number(n.unrest ?? 0),
			conflict: Number(n.conflict ?? 0),
			contagion: Number(n.contagion ?? 0),
			lat: t.lat,
			lng: t.lng,
			score: Ie(n),
			ignition: !!n.micro_ignition,
			risk3d: n.risk_3d_avg == null ? void 0 : Number(n.risk_3d_avg),
			riskDelta: n.risk_delta == null ? void 0 : Number(n.risk_delta)
		});
	}
	return i.sort((e, t) => {
		if (e.ignition !== t.ignition) return e.ignition ? -1 : 1;
		let n = e.riskDelta ?? 0, r = t.riskDelta ?? 0;
		return n === r ? t.score - e.score : r - n;
	}), {
		alerts: i.slice(0, t),
		trackedRegions: r?.tracked_regions ?? n.length,
		plottedRegions: r?.plotted_regions ?? i.length,
		maxRegions: r?.max_regions ?? 500
	};
}
//#endregion
//#region src/embed/nextImageShim.tsx
function Re({ loader: e, unoptimized: t, priority: n, fill: r, src: i, alt: a = "", style: o, ...s }) {
	return /* @__PURE__ */ (0, d.jsx)("img", {
		src: e ? e({
			src: i,
			width: Number(s.width) || void 0
		}) : i,
		alt: a,
		style: {
			...r ? {
				position: "absolute",
				inset: 0,
				width: "100%",
				height: "100%",
				objectFit: "cover"
			} : void 0,
			...o
		},
		...s
	});
}
//#endregion
//#region src/components/ExternalImage.tsx
var ze = ({ src: e }) => e;
function Be({ unoptimized: e = !0, alt: t = "", fill: n, width: r, height: i, ...a }) {
	return n ? /* @__PURE__ */ (0, d.jsx)(Re, {
		loader: ze,
		unoptimized: e,
		fill: !0,
		alt: t,
		...a
	}) : /* @__PURE__ */ (0, d.jsx)(Re, {
		loader: ze,
		unoptimized: e,
		width: r ?? 640,
		height: i ?? 360,
		alt: t,
		...a
	});
}
//#endregion
//#region src/lib/wikimediaClient.ts
var X = /* @__PURE__ */ new Map(), Ve = 512;
function He() {
	if (X.size <= Ve) return;
	let e = X.keys().next().value;
	e && X.delete(e);
}
async function Ue(e) {
	let t = (e || "").trim();
	if (!t) return null;
	let r = X.get(t);
	if (r?.loaded) return r.summary;
	if (r?.inflight) return r.inflight;
	let i = (async () => {
		try {
			let e = `${n}/api/wikipedia/summary?title=${encodeURIComponent(t)}`, r = await fetch(e);
			if (r.status === 404 || !r.ok) return null;
			let i = await r.json();
			return {
				title: i?.title || t,
				description: i?.description || "",
				extract: i?.extract || "",
				thumbnail: i?.thumbnail || "",
				type: i?.type || "standard"
			};
		} catch {
			return null;
		}
	})().then((e) => (X.set(t, {
		summary: e,
		inflight: null,
		loaded: !0
	}), He(), e));
	return X.set(t, {
		summary: null,
		inflight: i,
		loaded: !1
	}), He(), i;
}
//#endregion
//#region src/components/WikiImage.tsx
function We({ wikiUrl: e, label: t, maxH: n = "max-h-52", accent: r = "hover:border-cyan-500/50" }) {
	let [i, a] = (0, u.useState)(null), [o, s] = (0, u.useState)(!0), c = e.replace(/^https?:\/\/[^/]+\/wiki\//, "");
	return (0, u.useEffect)(() => {
		let e = !1;
		if (!c) {
			a(null), s(!1);
			return;
		}
		return s(!0), Ue(c).then((t) => {
			e || (a(t?.thumbnail || null), s(!1));
		}), () => {
			e = !0;
		};
	}, [c]), /* @__PURE__ */ (0, d.jsxs)("div", {
		className: "pb-2",
		children: [
			o && /* @__PURE__ */ (0, d.jsx)("div", { className: "w-full h-20 rounded bg-[var(--bg-tertiary)]/60 animate-pulse" }),
			i && /* @__PURE__ */ (0, d.jsx)("a", {
				href: e,
				target: "_blank",
				rel: "noopener noreferrer",
				className: "block",
				children: /* @__PURE__ */ (0, d.jsx)(Be, {
					src: i,
					alt: t || c.replace(/_/g, " "),
					width: 640,
					height: 360,
					className: `w-full h-auto ${n} object-contain rounded border border-[var(--border-primary)]/50 ${r} transition-colors`,
					style: {
						width: "100%",
						height: "auto"
					}
				})
			}),
			/* @__PURE__ */ (0, d.jsxs)("a", {
				href: e,
				target: "_blank",
				rel: "noopener noreferrer",
				className: "text-[10px] text-cyan-400 hover:text-cyan-300 underline mt-1 inline-block font-mono",
				children: [
					"📖 ",
					t || c.replace(/_/g, " "),
					" — Wikipedia →"
				]
			})
		]
	});
}
//#endregion
//#region src/mesh/meshSchema.ts
function Z(e, t) {
	for (let n of t) if (!(n in e)) return {
		ok: !1,
		reason: `Missing field: ${n}`
	};
	return { ok: !0 };
}
function Ge(e) {
	let t = Z(e, [
		"message",
		"destination",
		"channel",
		"priority",
		"ephemeral"
	]);
	if (!t.ok) return t;
	let n = String(e.priority ?? "");
	if (![
		"normal",
		"high",
		"emergency",
		"low"
	].includes(n)) return {
		ok: !1,
		reason: "Invalid priority"
	};
	if (typeof e.ephemeral != "boolean") return {
		ok: !1,
		reason: "ephemeral must be boolean"
	};
	let r = String(e.transport_lock ?? "").toLowerCase();
	return r && r !== "meshtastic" ? {
		ok: !1,
		reason: "Invalid transport_lock"
	} : { ok: !0 };
}
function Ke(e) {
	let t = Z(e, [
		"gate",
		"epoch",
		"ciphertext",
		"nonce",
		"sender_ref"
	]);
	if (!t.ok) return t;
	if ("message" in e) return {
		ok: !1,
		reason: "plaintext gate message field is not allowed"
	};
	if (!String(e.gate ?? "").trim().toLowerCase()) return {
		ok: !1,
		reason: "gate cannot be empty"
	};
	let n = Number(e.epoch ?? 0);
	return !Number.isFinite(n) || Math.trunc(n) <= 0 ? {
		ok: !1,
		reason: "epoch must be a positive integer"
	} : String(e.ciphertext ?? "").trim() ? String(e.nonce ?? "").trim() ? String(e.sender_ref ?? "").trim() ? String(e.format ?? "g1").trim().toLowerCase() === "g1" ? { ok: !0 } : {
		ok: !1,
		reason: "Unsupported gate message format"
	} : {
		ok: !1,
		reason: "sender_ref cannot be empty"
	} : {
		ok: !1,
		reason: "nonce cannot be empty"
	} : {
		ok: !1,
		reason: "ciphertext cannot be empty"
	};
}
function qe(e) {
	let t = Z(e, [
		"target_id",
		"vote",
		"gate"
	]);
	if (!t.ok) return t;
	let n = Number(e.vote);
	return [1, -1].includes(n) ? { ok: !0 } : {
		ok: !1,
		reason: "Invalid vote"
	};
}
function Je(e) {
	let t = Z(e, [
		"gate_id",
		"display_name",
		"rules"
	]);
	return t.ok ? typeof e.rules == "object" ? { ok: !0 } : {
		ok: !1,
		reason: "rules must be an object"
	} : t;
}
function Ye(e) {
	return Z(e, [
		"market_title",
		"side",
		"stake_amount"
	]);
}
function Xe(e) {
	return Z(e, [
		"message_id",
		"poster_id",
		"side",
		"amount",
		"duration_days"
	]);
}
function Ze(e) {
	let t = Z(e, [
		"dh_pub_key",
		"dh_algo",
		"timestamp"
	]);
	if (!t.ok) return t;
	let n = String(e.dh_algo ?? "");
	if (![
		"X25519",
		"ECDH",
		"ECDH_P256"
	].includes(n)) return {
		ok: !1,
		reason: "Invalid dh_algo"
	};
	let r = String(e.transport_lock ?? "").trim().toLowerCase();
	return r && r !== "private_strong" ? {
		ok: !1,
		reason: "Invalid transport_lock"
	} : { ok: !0 };
}
function Qe(e) {
	let t = Z(e, [
		"recipient_id",
		"delivery_class",
		"recipient_token",
		"ciphertext",
		"msg_id",
		"timestamp"
	]);
	if (!t.ok) return t;
	let n = String(e.delivery_class ?? "").toLowerCase();
	if (!["request", "shared"].includes(n)) return {
		ok: !1,
		reason: "Invalid delivery_class"
	};
	if (n === "shared" && !String(e.recipient_token ?? "").trim()) return {
		ok: !1,
		reason: "recipient_token required for shared delivery"
	};
	let r = String(e.transport_lock ?? "").trim().toLowerCase();
	return r && r !== "private_strong" ? {
		ok: !1,
		reason: "Invalid transport_lock"
	} : { ok: !0 };
}
function $e(e) {
	if (!Array.isArray(e) || e.length === 0) return {
		ok: !1,
		reason: "mailbox_claims must be a non-empty list"
	};
	for (let t of e) {
		if (!t || typeof t != "object" || Array.isArray(t)) return {
			ok: !1,
			reason: "mailbox_claims entries must be objects"
		};
		let e = t, n = String(e.type ?? "").toLowerCase();
		if (![
			"self",
			"requests",
			"shared"
		].includes(n)) return {
			ok: !1,
			reason: "Invalid mailbox claim type"
		};
		if (!String(e.token ?? "").trim()) return {
			ok: !1,
			reason: `${n} mailbox claims require token`
		};
	}
	return { ok: !0 };
}
function et(e) {
	let t = Z(e, [
		"mailbox_claims",
		"timestamp",
		"nonce"
	]);
	if (!t.ok) return t;
	let n = String(e.transport_lock ?? "").trim().toLowerCase();
	return n && n !== "private_strong" ? {
		ok: !1,
		reason: "Invalid transport_lock"
	} : $e(e.mailbox_claims);
}
function tt(e) {
	return et(e);
}
function nt(e) {
	let t = Z(e, ["blocked_id", "action"]);
	if (!t.ok) return t;
	let n = String(e.action ?? "");
	if (!["block", "unblock"].includes(n)) return {
		ok: !1,
		reason: "Invalid action"
	};
	let r = String(e.transport_lock ?? "").trim().toLowerCase();
	return r && r !== "private_strong" ? {
		ok: !1,
		reason: "Invalid transport_lock"
	} : { ok: !0 };
}
function rt(e) {
	let t = Z(e, [
		"target_id",
		"dh_pub_key",
		"timestamp"
	]);
	if (!t.ok) return t;
	let n = Number(e.timestamp ?? 0);
	return !Number.isFinite(n) || n <= 0 ? {
		ok: !1,
		reason: "Invalid timestamp"
	} : { ok: !0 };
}
function it(e) {
	let t = Z(e, ["target_id", "timestamp"]);
	if (!t.ok) return t;
	let n = Number(e.timestamp ?? 0);
	return !Number.isFinite(n) || n <= 0 ? {
		ok: !1,
		reason: "Invalid timestamp"
	} : { ok: !0 };
}
function at(e) {
	return Z(e, [
		"old_node_id",
		"old_public_key",
		"old_public_key_algo",
		"new_public_key",
		"new_public_key_algo",
		"timestamp",
		"old_signature"
	]);
}
function ot(e) {
	let t = Z(e, [
		"revoked_public_key",
		"revoked_public_key_algo",
		"revoked_at",
		"grace_until",
		"reason"
	]);
	if (!t.ok) return t;
	let n = Number(e.revoked_at ?? 0), r = Number(e.grace_until ?? 0);
	return !Number.isFinite(n) || n <= 0 ? {
		ok: !1,
		reason: "revoked_at must be positive"
	} : !Number.isFinite(r) || r < n ? {
		ok: !1,
		reason: "grace_until must be >= revoked_at"
	} : { ok: !0 };
}
function st(e) {
	let t = Z(e, ["target_id", "reason"]);
	return t.ok ? String(e.reason ?? "").trim() ? { ok: !0 } : {
		ok: !1,
		reason: "reason cannot be empty"
	} : t;
}
var ct = {
	message: Ge,
	gate_message: Ke,
	vote: qe,
	gate_create: Je,
	prediction: Ye,
	stake: Xe,
	dm_key: Ze,
	dm_message: Qe,
	dm_poll: et,
	dm_count: tt,
	dm_block: nt,
	dm_key_witness: rt,
	trust_vouch: it,
	key_rotate: at,
	key_revoke: ot,
	abuse_report: st
};
function lt(e, t) {
	let n = ct[e];
	if (!n) return {
		ok: !1,
		reason: "Unknown event_type"
	};
	let i = r(e, t);
	return JSON.stringify(i) === JSON.stringify(t) ? e !== "message" && "ephemeral" in t ? {
		ok: !1,
		reason: "ephemeral not allowed for this event type"
	} : n(t) : {
		ok: !1,
		reason: "Payload is not normalized"
	};
}
//#endregion
//#region src/lib/aiIntelClient.ts
var Q = `${n}/api/ai`;
async function ut(e, t) {
	let n = new URL(`${Q}${e}`, window.location.origin);
	t && Object.entries(t).forEach(([e, t]) => {
		t !== "" && t !== void 0 && n.searchParams.set(e, String(t));
	});
	let r = await fetch(n.toString());
	if (!r.ok) throw Error(`AI Intel API error: ${r.status}`);
	return r.json();
}
async function $(e, t) {
	let n = await fetch(`${Q}${e}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(t)
	});
	if (!n.ok) throw Error(`AI Intel API error: ${n.status}`);
	return n.json();
}
async function dt(e, t) {
	let n = await fetch(`${Q}${e}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(t)
	});
	if (!n.ok) throw Error(`AI Intel API error: ${n.status}`);
	return n.json();
}
async function ft(e, t) {
	let n = new URL(`${Q}${e}`, window.location.origin);
	t && Object.entries(t).forEach(([e, t]) => {
		t && n.searchParams.set(e, t);
	});
	let r = await fetch(n.toString(), { method: "DELETE" });
	if (!r.ok) throw Error(`AI Intel API error: ${r.status}`);
	return r.json();
}
async function pt(e) {
	return $("/layers", e);
}
async function mt(e, t) {
	return dt(`/layers/${e}`, t);
}
async function ht(e) {
	return ft(`/layers/${e}`);
}
async function gt(e) {
	return $(`/layers/${e}/refresh`, {});
}
async function _t(e) {
	return ut(`/pins/${e}`);
}
async function vt(e, t) {
	return dt(`/pins/${e}`, t);
}
async function yt(e, t) {
	return $(`/pins/${e}/comments`, t);
}
async function bt(e, t) {
	return ft(`/pins/${e}/comments/${t}`);
}
async function xt(e, t, n = 3) {
	return ut("/satellite-images", {
		lat: e,
		lng: t,
		count: n
	});
}
//#endregion
//#region src/lib/constants.ts
var St = 2200, Ct = .12, wt = 2e3;
//#endregion
export { me as A, P as B, ye as C, fe as D, ue as E, ae as F, v as G, N as H, ie as I, m as J, w as K, re as L, ce as M, se as N, de as O, oe as P, ne as R, xe as S, pe as T, E as U, te as V, C as W, s as X, l as Y, a as Z, Le as _, pt as a, Y as b, _t as c, vt as d, mt as f, Be as g, Ue as h, yt as i, he as j, ge as k, xt as l, We as m, St as n, bt as o, lt as p, p as q, wt as r, ht as s, Ct as t, gt as u, Pe as v, be as w, Me as x, Ne as y, F as z };
