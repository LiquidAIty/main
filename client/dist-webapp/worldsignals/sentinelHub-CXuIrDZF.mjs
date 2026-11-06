import { r as e } from "./chunk-HEgqtunE.mjs";
import { t } from "./api-BTRrcK48.mjs";
//#region src/lib/sentinelHub.ts
var n = /* @__PURE__ */ e({
	buildSentinelTileUrl: () => y,
	checkBackendSentinelStatus: () => l,
	fetchSentinelTile: () => h,
	getSentinelToken: () => p,
	getSentinelUsage: () => S,
	hasSentinelCredentials: () => d,
	hasSentinelInfoBeenSeen: () => T,
	markSentinelInfoSeen: () => E,
	migrateLegacySentinelBrowserKeys: () => f,
	onTileLoadingChange: () => A,
	recordTileFetch: () => C,
	refreshSentinelStatus: () => u,
	registerSentinelProtocol: () => _,
	resetTileLoading: () => P,
	tileLoadEnd: () => N,
	tileLoadStart: () => M
}), r = `${t}/api/sentinel/token`, i = null, a = 0, o = null, s = null, c = null;
async function l() {
	return s === null ? c || (c = (async () => {
		try {
			let e = await fetch(`${t}/api/settings/api-keys`, { headers: { Accept: "application/json" } });
			if (!e.ok) return !1;
			let n = await e.json(), r = new Set(["sentinel_client_id", "sentinel_client_secret"]), i = Array.isArray(n) && n.filter((e) => e && e.id && r.has(e.id) && e.is_set === !0).length === 2;
			return s = i, i;
		} catch {
			return s = !1, !1;
		} finally {
			c = null;
		}
	})(), c) : s;
}
function u() {
	s = null, i = null, a = 0;
}
function d() {
	return s === !0;
}
function f() {
	if (typeof window > "u") return { cleared: [] };
	let e = [
		"sb_sentinel_client_id",
		"sb_sentinel_client_secret",
		"sb_sentinel_instance_id"
	], t = [];
	for (let n of e) {
		try {
			window.localStorage?.getItem(n) !== null && (window.localStorage.removeItem(n), t.push(n));
		} catch {}
		try {
			window.sessionStorage?.getItem(n) !== null && (window.sessionStorage.removeItem(n), t.includes(n) || t.push(n));
		} catch {}
	}
	return { cleared: t };
}
function p() {
	return i && Date.now() < a - 3e4 ? Promise.resolve(i) : o || (o = (async () => {
		try {
			let e = await fetch(r, {
				method: "POST",
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
				body: new URLSearchParams({})
			});
			if (!e.ok) {
				let t = await e.text().catch(() => "");
				throw Error(`Sentinel Hub token request failed (${e.status}): ${t}`);
			}
			let t = await e.json();
			return i = t.access_token, a = Date.now() + (t.expires_in ?? 300) * 1e3, i;
		} finally {
			o = null;
		}
	})(), o);
}
var m = `${t}/api/sentinel/tile`;
async function h(e, t, n, r, i) {
	let a = await fetch(m, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			preset: r,
			date: i,
			z: e,
			x: t,
			y: n
		})
	});
	return a.ok ? a.arrayBuffer() : null;
}
var g = !1;
function _(e) {
	g || (g = !0, e.addProtocol("sentinel", async (e) => {
		let t = new URL(e.url.replace("sentinel://", "http://dummy/")), n = t.pathname.split("/").filter(Boolean), r = parseInt(n[0], 10), i = parseInt(n[1], 10), a = parseInt(n[2], 10), o = t.searchParams.get("preset") || "TRUE-COLOR", s = t.searchParams.get("date") || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
		M();
		try {
			let e = await h(r, i, a, o, s);
			return e ? (C(), { data: e }) : { data: v };
		} finally {
			N();
		}
	}));
}
var v = new Uint8Array([
	137,
	80,
	78,
	71,
	13,
	10,
	26,
	10,
	0,
	0,
	0,
	13,
	73,
	72,
	68,
	82,
	0,
	0,
	0,
	1,
	0,
	0,
	0,
	1,
	8,
	6,
	0,
	0,
	0,
	31,
	21,
	196,
	137,
	0,
	0,
	0,
	10,
	73,
	68,
	65,
	84,
	120,
	156,
	98,
	0,
	0,
	0,
	2,
	0,
	1,
	226,
	33,
	188,
	51,
	0,
	0,
	0,
	0,
	73,
	69,
	78,
	68,
	174,
	66,
	96,
	130
]).buffer;
function y(e, t) {
	return `sentinel://{z}/{x}/{y}?preset=${encodeURIComponent(e)}&date=${encodeURIComponent(t)}`;
}
var b = "sb_sentinel_usage";
function x() {
	return (/* @__PURE__ */ new Date()).toISOString().slice(0, 7);
}
function S() {
	if (typeof window > "u") return {
		month: x(),
		tiles: 0,
		pu: 0
	};
	try {
		let e = localStorage.getItem(b);
		if (e) {
			let t = JSON.parse(e);
			if (t.month === x()) return t;
		}
	} catch {}
	return {
		month: x(),
		tiles: 0,
		pu: 0
	};
}
function C(e = 1) {
	let t = S();
	t.tiles += e, t.pu = Math.round(t.tiles * .25 * 100) / 100, t.month = x(), localStorage.setItem(b, JSON.stringify(t));
}
var w = "sb_sentinel_info_seen";
function T() {
	return typeof window > "u" ? !0 : localStorage.getItem(w) === "true";
}
function E() {
	localStorage.setItem(w, "true");
}
var D = 0, O = 0, k = [];
function A(e) {
	return k.push(e), () => {
		k = k.filter((t) => t !== e);
	};
}
function j() {
	for (let e of k) e(D, O);
}
function M() {
	D++, j();
}
function N() {
	D = Math.max(0, D - 1), O++, j();
}
function P() {
	D = 0, O = 0, j();
}
//#endregion
export { T as a, A as c, n as d, d as i, _ as l, l as n, E as o, p as r, f as s, y as t, P as u };
