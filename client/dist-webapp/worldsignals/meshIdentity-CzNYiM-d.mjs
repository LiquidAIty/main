import { r as e } from "./chunk-HEgqtunE.mjs";
import { t } from "./api-BTRrcK48.mjs";
//#region src/mesh/meshProtocol.ts
var n = "infonet/2", r = "sb-testnet-0";
function i(e) {
	if (typeof e != "object" || !e) return JSON.stringify(e);
	if (Array.isArray(e)) return `[${e.map((e) => i(e)).join(",")}]`;
	let t = e;
	return `{${Object.keys(t).sort().map((e) => `${JSON.stringify(e)}:${i(t[e])}`).join(",")}}`;
}
function a(e) {
	return i(e);
}
function o(e) {
	let t = {
		message: String(e.message ?? ""),
		destination: String(e.destination ?? ""),
		channel: String(e.channel ?? "LongFast"),
		priority: String(e.priority ?? "normal"),
		ephemeral: !!(e.ephemeral ?? !1)
	}, n = String(e.transport_lock ?? "").toLowerCase();
	return n && (t.transport_lock = n), t;
}
function s(e) {
	let t = Number(e.epoch ?? 0);
	return {
		gate: String(e.gate ?? "").trim().toLowerCase(),
		epoch: Number.isFinite(t) ? Math.trunc(t) : 0,
		ciphertext: String(e.ciphertext ?? ""),
		nonce: String(e.nonce ?? e.iv ?? ""),
		sender_ref: String(e.sender_ref ?? ""),
		format: String(e.format ?? "g1")
	};
}
function c(e) {
	let t = Number(e.vote ?? 0);
	return {
		target_id: String(e.target_id ?? ""),
		vote: Number.isFinite(t) ? Math.trunc(t) : 0,
		gate: String(e.gate ?? "")
	};
}
function l(e) {
	return {
		gate_id: String(e.gate_id ?? "").toLowerCase(),
		display_name: String(e.display_name ?? ""),
		rules: e.rules ?? {}
	};
}
function ee(e) {
	return {
		market_title: String(e.market_title ?? ""),
		side: String(e.side ?? ""),
		stake_amount: Number(e.stake_amount ?? 0)
	};
}
function te(e) {
	return {
		message_id: String(e.message_id ?? ""),
		poster_id: String(e.poster_id ?? ""),
		side: String(e.side ?? ""),
		amount: Number(e.amount ?? 0),
		duration_days: Number(e.duration_days ?? 0)
	};
}
function ne(e) {
	let t = {
		dh_pub_key: String(e.dh_pub_key ?? ""),
		dh_algo: String(e.dh_algo ?? ""),
		timestamp: Number(e.timestamp ?? 0)
	}, n = String(e.transport_lock ?? "").trim().toLowerCase();
	return n && (t.transport_lock = n), t;
}
function re(e) {
	let t = {
		recipient_id: String(e.recipient_id ?? ""),
		delivery_class: String(e.delivery_class ?? "").toLowerCase(),
		recipient_token: String(e.recipient_token ?? ""),
		ciphertext: String(e.ciphertext ?? ""),
		msg_id: String(e.msg_id ?? ""),
		timestamp: Number(e.timestamp ?? 0),
		format: String(e.format ?? "dm1").trim().toLowerCase()
	}, n = e.session_welcome;
	n && (t.session_welcome = String(n));
	let r = e.sender_seal;
	r && (t.sender_seal = String(r));
	let i = e.relay_salt;
	i && (t.relay_salt = String(i).trim().toLowerCase());
	let a = String(e.transport_lock ?? "").trim().toLowerCase();
	return a && (t.transport_lock = a), t;
}
function ie(e) {
	return (Array.isArray(e.mailbox_claims) ? e.mailbox_claims : []).flatMap((e) => {
		if (!e || typeof e != "object" || Array.isArray(e)) return [];
		let t = e;
		return [{
			type: String(t.type ?? "").toLowerCase(),
			token: String(t.token ?? "")
		}];
	});
}
function ae(e) {
	let t = {
		mailbox_claims: ie(e),
		timestamp: Number(e.timestamp ?? 0),
		nonce: String(e.nonce ?? "")
	}, n = String(e.transport_lock ?? "").trim().toLowerCase();
	return n && (t.transport_lock = n), t;
}
function oe(e) {
	return ae(e);
}
function se(e) {
	let t = {
		blocked_id: String(e.blocked_id ?? ""),
		action: String(e.action ?? "block").toLowerCase()
	}, n = String(e.transport_lock ?? "").trim().toLowerCase();
	return n && (t.transport_lock = n), t;
}
function ce(e) {
	return {
		target_id: String(e.target_id ?? ""),
		dh_pub_key: String(e.dh_pub_key ?? ""),
		timestamp: Number(e.timestamp ?? 0)
	};
}
function le(e) {
	return {
		target_id: String(e.target_id ?? ""),
		note: String(e.note ?? "").slice(0, 140),
		timestamp: Number(e.timestamp ?? 0)
	};
}
function ue(e) {
	return {
		old_node_id: String(e.old_node_id ?? ""),
		old_public_key: String(e.old_public_key ?? ""),
		old_public_key_algo: String(e.old_public_key_algo ?? ""),
		new_public_key: String(e.new_public_key ?? ""),
		new_public_key_algo: String(e.new_public_key_algo ?? ""),
		timestamp: Number(e.timestamp ?? 0),
		old_signature: String(e.old_signature ?? "")
	};
}
function de(e) {
	return {
		revoked_public_key: String(e.revoked_public_key ?? ""),
		revoked_public_key_algo: String(e.revoked_public_key_algo ?? ""),
		revoked_at: Number(e.revoked_at ?? 0),
		grace_until: Number(e.grace_until ?? 0),
		reason: String(e.reason ?? "").slice(0, 140)
	};
}
function fe(e) {
	return {
		target_id: String(e.target_id ?? ""),
		reason: String(e.reason ?? "").slice(0, 280),
		gate: String(e.gate ?? ""),
		evidence: String(e.evidence ?? "").slice(0, 256)
	};
}
function pe(e, t) {
	return e === "message" ? o(t) : e === "gate_message" ? s(t) : e === "vote" ? c(t) : e === "gate_create" ? l(t) : e === "prediction" ? ee(t) : e === "stake" ? te(t) : e === "dm_key" ? ne(t) : e === "dm_message" ? re(t) : e === "dm_poll" ? ae(t) : e === "dm_count" ? oe(t) : e === "dm_block" ? se(t) : e === "dm_key_witness" ? ce(t) : e === "trust_vouch" ? le(t) : e === "key_rotate" ? ue(t) : e === "key_revoke" ? de(t) : e === "abuse_report" ? fe(t) : t;
}
function me(e) {
	let t = a(pe(e.eventType, e.payload));
	return [
		n,
		r,
		e.eventType,
		e.nodeId,
		String(e.sequence),
		t
	].join("|");
}
//#endregion
//#region src/mesh/meshKeyStore.ts
var he = "sb_mesh_keystore", ge = 1, u = "keys";
function _e() {
	return new Promise((e, t) => {
		let n = indexedDB.open(he, ge);
		n.onupgradeneeded = () => {
			let e = n.result;
			e.objectStoreNames.contains(u) || e.createObjectStore(u);
		}, n.onsuccess = () => e(n.result), n.onerror = () => t(n.error);
	});
}
async function ve(e, t) {
	let n = await _e();
	return new Promise((r, i) => {
		let a = n.transaction(u, e), o = t(a.objectStore(u));
		o.onsuccess = () => r(o.result), o.onerror = () => i(o.error), a.oncomplete = () => n.close(), a.onerror = () => {
			n.close(), i(a.error);
		};
	});
}
async function d(e, t) {
	await ve("readwrite", (n) => n.put(t, e));
}
async function f(e) {
	try {
		return await ve("readonly", (t) => t.get(e)) || null;
	} catch {
		return null;
	}
}
async function p(e) {
	try {
		await ve("readwrite", (t) => t.delete(e));
	} catch {}
}
//#endregion
//#region src/mesh/meshMailbox.ts
var ye = 360 * 60, be = "sb_mesh_mailbox_claim_key";
function xe(e) {
	return Array.from(new Uint8Array(e)).map((e) => e.toString(16).padStart(2, "0")).join("");
}
async function Se() {
	let e = await f(be);
	if (e) return e;
	let t = await crypto.subtle.generateKey({
		name: "HMAC",
		hash: "SHA-256",
		length: 256
	}, !1, ["sign"]);
	return await d(be, t), t;
}
function Ce(e) {
	let t = typeof e == "number" ? e : Date.now() / 1e3;
	return Math.floor(t / ye);
}
async function we(e, t, n) {
	let r = String(t || "").trim();
	if (!r) throw Error("nodeId required for mailbox claim token");
	let i = await Se(), a = Ce(n), o = new TextEncoder().encode(`sb_mailbox_claim|v2|${e}|${a}|${r}`);
	return xe(await crypto.subtle.sign("HMAC", i, o));
}
async function Te(e, t) {
	let n = await Se(), r = Ce(t), i = Math.max(0, Number(e || 0)), a = new TextEncoder().encode(`sb_mailbox_claim|v1|shared_decoy|${r}|${i}`);
	return xe(await crypto.subtle.sign("HMAC", n, a));
}
async function Ee() {
	await p(be);
}
//#endregion
//#region src/lib/adminSession.ts
var De = !1;
function Oe() {
	if (typeof window > "u") return "";
	let e = sessionStorage.getItem("sb_admin_key") || "", t = localStorage.getItem("sb_admin_key") || "", n = e || t;
	try {
		sessionStorage.removeItem("sb_admin_key"), localStorage.removeItem("sb_admin_key");
	} catch {}
	return n;
}
async function ke() {
	try {
		let e = await fetch(`${t}/api/admin/session`, { cache: "no-store" }), n = await e.json().catch(() => ({}));
		return !!(e.ok && n?.hasSession);
	} catch {
		return !1;
	}
}
async function Ae(e) {
	if (!e && await ke()) return;
	let n = String(e || Oe() || "").trim();
	if (!n) throw Error("admin_session_required");
	if (De && await ke()) return;
	let r = await fetch(`${t}/api/admin/session`, {
		method: "POST",
		cache: "no-store",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ adminKey: n })
	}), i = await r.json().catch(() => ({}));
	if (!r.ok || i?.ok === !1) throw Error(i?.detail || i?.message || "admin_session_failed");
	De = !0;
}
async function je() {
	if (De = !1, typeof window < "u") try {
		sessionStorage.removeItem("sb_admin_key"), localStorage.removeItem("sb_admin_key");
	} catch {}
	await fetch(`${t}/api/admin/session`, {
		method: "DELETE",
		cache: "no-store"
	}).catch(() => null);
}
//#endregion
//#region src/lib/desktopControlRouting.ts
function Me(e) {
	if (e) try {
		return JSON.parse(e);
	} catch {
		return;
	}
}
function Ne(e, t, n) {
	let r = Me(n), i = t.toUpperCase();
	return i === "GET" && e === "/api/wormhole/status" ? {
		command: "wormhole.status",
		payload: void 0
	} : i === "POST" && e === "/api/wormhole/connect" ? {
		command: "wormhole.connect",
		payload: void 0
	} : i === "POST" && e === "/api/wormhole/disconnect" ? {
		command: "wormhole.disconnect",
		payload: void 0
	} : i === "POST" && e === "/api/wormhole/restart" ? {
		command: "wormhole.restart",
		payload: void 0
	} : i === "POST" && e === "/api/wormhole/gate/enter" ? {
		command: "wormhole.gate.enter",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/leave" ? {
		command: "wormhole.gate.leave",
		payload: r
	} : i === "GET" && /^\/api\/wormhole\/gate\/[^/]+\/personas$/.test(e) ? {
		command: "wormhole.gate.personas.get",
		payload: { gate_id: decodeURIComponent(e.split("/")[4] || "") }
	} : i === "POST" && e === "/api/wormhole/gate/persona/create" ? {
		command: "wormhole.gate.persona.create",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/persona/activate" ? {
		command: "wormhole.gate.persona.activate",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/persona/clear" ? {
		command: "wormhole.gate.persona.clear",
		payload: r
	} : i === "GET" && /^\/api\/wormhole\/gate\/[^/]+\/key$/.test(e) ? {
		command: "wormhole.gate.key.get",
		payload: { gate_id: decodeURIComponent(e.split("/")[4] || "") }
	} : i === "POST" && e === "/api/wormhole/gate/key/rotate" ? {
		command: "wormhole.gate.key.rotate",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/state/export" ? {
		command: "wormhole.gate.state.resync",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/proof" ? {
		command: "wormhole.gate.proof",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/message/compose" ? {
		command: "wormhole.gate.message.compose",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/message/post" ? {
		command: "wormhole.gate.message.post",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/message/decrypt" ? {
		command: "wormhole.gate.message.decrypt",
		payload: r
	} : i === "POST" && e === "/api/wormhole/gate/messages/decrypt" ? {
		command: "wormhole.gate.messages.decrypt",
		payload: r
	} : i === "GET" && e === "/api/settings/wormhole" ? {
		command: "settings.wormhole.get",
		payload: void 0
	} : i === "PUT" && e === "/api/settings/wormhole" ? {
		command: "settings.wormhole.set",
		payload: r
	} : i === "GET" && e === "/api/settings/privacy-profile" ? {
		command: "settings.privacy.get",
		payload: void 0
	} : i === "PUT" && e === "/api/settings/privacy-profile" ? {
		command: "settings.privacy.set",
		payload: r
	} : i === "GET" && e === "/api/settings/api-keys" ? {
		command: "settings.api_keys.get",
		payload: void 0
	} : i === "GET" && e === "/api/settings/news-feeds" ? {
		command: "settings.news.get",
		payload: void 0
	} : i === "PUT" && e === "/api/settings/news-feeds" ? {
		command: "settings.news.set",
		payload: r
	} : i === "POST" && e === "/api/settings/news-feeds/reset" ? {
		command: "settings.news.reset",
		payload: void 0
	} : i === "POST" && e === "/api/system/update" ? {
		command: "system.update",
		payload: void 0
	} : null;
}
//#endregion
//#region src/lib/localControlTransport.ts
function Pe() {
	return typeof window > "u" ? null : window.__SHADOWBROKER_LOCAL_CONTROL__ || null;
}
function Fe() {
	return !!Pe();
}
function Ie(e, t = {}) {
	return Pe()?.invoke ? !!Ne(e, String(t.method || "GET"), Re(t.body)) : !1;
}
function Le(e) {
	let t = new Headers(e), n = {};
	return t.forEach((e, t) => {
		n[t] = e;
	}), n;
}
function Re(e) {
	if (e != null) {
		if (typeof e == "string") return e;
		if (e instanceof URLSearchParams) return e.toString();
	}
}
async function ze(e, n = {}) {
	let r = Pe();
	if (!r) return fetch(`${t}${e}`, n);
	let { capabilityIntent: i, sessionProfileHint: a, enforceProfileHint: o, ...s } = n, c = r.invoke ? Ne(e, String(s.method || "GET"), Re(s.body)) : null;
	if (r.invoke && c) try {
		let e = await r.invoke({
			...c,
			meta: {
				...c.meta,
				...i ? { capability: i } : {},
				...a ? { sessionProfileHint: a } : {},
				...o ? { enforceProfileHint: !0 } : {}
			}
		});
		return new Response(JSON.stringify(e ?? {}), {
			status: 200,
			headers: { "Content-Type": "application/json" }
		});
	} catch (e) {
		if (!(e instanceof Error ? e.message : typeof e == "string" ? e : "").includes("desktop_runtime_shim_enforcement_inactive")) throw e;
	}
	if (!r.request) return fetch(`${t}${e}`, s);
	let l = await r.request({
		path: e,
		method: s.method || "GET",
		headers: Le(s.headers),
		bodyText: Re(s.body)
	});
	return new Response(l.bodyText || "", {
		status: l.status,
		headers: l.headers
	});
}
//#endregion
//#region src/lib/controlPlane.ts
async function Be(e, t = {}) {
	let { requireAdminSession: n = !0, capabilityIntent: r, sessionProfileHint: i, enforceProfileHint: a, ...o } = t, s = Fe() && Ie(e, o);
	return n && !s && await Ae(), ze(e, {
		...o,
		capabilityIntent: r,
		sessionProfileHint: i,
		enforceProfileHint: a
	});
}
async function m(e, t = {}) {
	let n = await Be(e, t), r = await n.json().catch(() => ({}));
	if (!n.ok || r?.ok === !1) {
		let e = n.status === 429 ? "control_plane_rate_limited" : n.status === 530 ? "local_control_plane_unavailable" : n.status === 502 ? "backend_unavailable" : `control_plane_request_failed:${n.status || "unknown"}`;
		throw Error(r?.detail || r?.message || r?.error || e);
	}
	return r;
}
//#endregion
//#region src/mesh/meshIdentity.ts
var Ve = /* @__PURE__ */ e({
	addContact: () => wn,
	blockContact: () => En,
	cacheWormholeIdentityDescriptor: () => _t,
	clearBrowserIdentityState: () => St,
	createIdentityCandidate: () => Ut,
	declineSovereignty: () => qt,
	decryptDM: () => G,
	decryptIdentityBoundStoragePayload: () => Rt,
	decryptSenderSealPayloadLocally: () => pn,
	deriveNodeIdFromPublicKey: () => jt,
	deriveSenderSealKey: () => dn,
	deriveSharedKey: () => cn,
	deriveSharedSecret: () => ln,
	encryptDM: () => hn,
	encryptIdentityBoundStoragePayload: () => Lt,
	ensureDhKeysFresh: () => an,
	generateDHKeys: () => V,
	generateNodeKeys: () => Wt,
	getContacts: () => Q,
	getDHAlgo: () => U,
	getDHLastRotation: () => rn,
	getDHPubKey: () => H,
	getDMNotify: () => An,
	getNodeIdentity: () => Gt,
	getPublicKeyAlgo: () => Ct,
	getSequence: () => wt,
	getStoredNodeDescriptor: () => vt,
	getWormholeIdentityDescriptor: () => yt,
	hasSovereignty: () => Kt,
	hydrateWormholeContacts: () => yn,
	hydrateWormholeContactsFromNode: () => bn,
	isDeclined: () => Jt,
	isSecureModeCached: () => N,
	migrateLegacyNodeIds: () => Nt,
	nextSequence: () => Et,
	persistIdentity: () => Ht,
	purgeBrowserContactGraph: () => xt,
	purgeBrowserSigningMaterial: () => bt,
	removeContact: () => On,
	setDMNotify: () => jn,
	setSecureModeCached: () => gt,
	setSequence: () => Tt,
	severContact: () => kn,
	signEvent: () => Xt,
	signMessage: () => Yt,
	signWithStoredKey: () => Vt,
	unblockContact: () => Dn,
	unwrapSenderSealPayload: () => mn,
	updateContact: () => Tn,
	verifyEventSignature: () => nn,
	verifyNodeIdBindingFromPublicKey: () => Mt,
	verifyRawSignature: () => tn
}), h = "sb_mesh_pubkey", g = "sb_mesh_privkey", _ = "sb_mesh_node_id", v = "sb_mesh_sovereignty_accepted", y = "sb_wormhole_desc_pubkey", b = "sb_wormhole_desc_node_id", He = "sb_wormhole_desc_algo", Ue = "sb_mesh_dh_pubkey", x = "sb_mesh_dh_privkey", S = "sb_mesh_dh_algo", We = "sb_mesh_dh_last_ts", C = "sb_mesh_dh_priv", w = "sb_mesh_dh_prev_priv", T = "sb_mesh_sign_priv", E = "sb_mesh_contacts", Ge = "sb_mesh_dm_notify", Ke = "sb_dm_bundle_fingerprint", qe = "sb_dm_bundle_sequence", Je = "sb_mesh_dm_ratchet", Ye = "sb_mesh_ratchet_telemetry", D = "sb_mesh_sequence", Xe = "sb_mesh_session_mode", O = "sb_mesh_algo", k = "sb_wormhole_secure_required", Ze = "sb_mesh_ratchet_crypto", Qe = "sb:identity-state-changed", $e = [
	"sb_mesh_",
	"sb_wormhole_",
	"sb_dm_"
], et = "enc:", tt = "SB-CONTACTS-WRAP-V1", nt = "SB-CONTACTS-STORAGE-V1";
function A() {
	if (!(typeof window > "u")) try {
		window.dispatchEvent(new CustomEvent(Qe));
	} catch {}
}
function rt() {
	if (typeof window > "u") return !1;
	try {
		return localStorage.getItem(Xe) !== "false";
	} catch {
		return !0;
	}
}
function it() {
	if (typeof window > "u") return null;
	try {
		return rt() ? sessionStorage : localStorage;
	} catch {
		return sessionStorage;
	}
}
function at(e) {
	return typeof window > "u" || !e ? null : e === sessionStorage ? localStorage : sessionStorage;
}
function j(e) {
	let t = it();
	if (!t) return null;
	let n = t.getItem(e);
	if (n !== null) return n;
	let r = at(t);
	if (!r) return null;
	let i = r.getItem(e);
	return i !== null && (t.setItem(e, i), r.removeItem(e)), i;
}
function M(e, t) {
	let n = it();
	if (!n) return;
	n.setItem(e, t);
	let r = at(n);
	r && r.removeItem(e);
}
function ot(e) {
	for (let t of [localStorage, sessionStorage]) try {
		t.removeItem(e);
	} catch {}
}
function st() {
	if (!(typeof window > "u")) for (let e of [localStorage, sessionStorage]) try {
		e.removeItem(g);
	} catch {}
}
function ct(e) {
	let t = [];
	for (let n = 0; n < e.length; n += 1) {
		let r = e.key(n);
		r && $e.some((e) => r.startsWith(e)) && t.push(r);
	}
	for (let n of t) try {
		e.removeItem(n);
	} catch {}
}
async function lt(e) {
	typeof indexedDB > "u" || await new Promise((t) => {
		try {
			let n = indexedDB.deleteDatabase(e);
			n.onsuccess = () => t(), n.onerror = () => t(), n.onblocked = () => t();
		} catch {
			t();
		}
	});
}
function ut(e, t) {
	let n = String(e || "").trim();
	return RegExp(`^${Mn}[0-9a-f]{${t}}$`, "i").test(n);
}
function dt(e) {
	return ut(e, Fn);
}
function ft(e) {
	return ut(e, Pn);
}
function pt(e) {
	return ut(e, Nn);
}
function mt(e) {
	return dt(e) || ft(e);
}
async function ht(e, t, n) {
	let r = await jt(e);
	return !mt(t) || t === r || n(r), r;
}
function gt(e) {
	if (!(typeof window > "u")) try {
		let t = e ? "true" : "false", n = sessionStorage.getItem(k);
		sessionStorage.setItem(k, t), n !== t && A();
	} catch {}
}
function N() {
	if (typeof window > "u") return !1;
	try {
		return sessionStorage.getItem(k) === "true";
	} catch {
		return !1;
	}
}
function _t(e) {
	if (!(typeof window > "u")) try {
		sessionStorage.setItem(y, e.publicKey), sessionStorage.setItem(b, e.nodeId), sessionStorage.setItem(He, e.publicKeyAlgo || "Ed25519"), A();
	} catch {}
}
function vt() {
	if (typeof window > "u") return null;
	let e = j(h), t = j(_);
	return !e || !t ? null : {
		publicKey: e,
		nodeId: t,
		publicKeyAlgo: j(O) || "Ed25519"
	};
}
function yt() {
	if (typeof window > "u") return null;
	try {
		let e = sessionStorage.getItem(y), t = sessionStorage.getItem(b);
		return !e || !t ? null : {
			publicKey: e,
			nodeId: t,
			publicKeyAlgo: sessionStorage.getItem(He) || "Ed25519"
		};
	} catch {
		return null;
	}
}
async function bt() {
	if (!(typeof window > "u")) {
		for (let e of [localStorage, sessionStorage]) try {
			e.removeItem(g), e.removeItem(D);
		} catch {}
		await p(T);
	}
}
function xt() {
	if (!(typeof window > "u")) {
		K = {}, q = null;
		for (let e of [localStorage, sessionStorage]) try {
			e.removeItem(E);
		} catch {}
	}
}
async function St() {
	if (!(typeof window > "u")) {
		K = {}, q = null;
		for (let e of [localStorage, sessionStorage]) {
			try {
				e.removeItem(h), e.removeItem(g), e.removeItem(_), e.removeItem(v), e.removeItem(D), e.removeItem(O), e.removeItem(Ue), e.removeItem(x), e.removeItem(S), e.removeItem(We), e.removeItem(E), e.removeItem(Ge), e.removeItem(y), e.removeItem(b), e.removeItem(He), e.removeItem(k), e.removeItem(Ke), e.removeItem(qe), e.removeItem(Je), e.removeItem(Ye), e.removeItem(Xe);
			} catch {}
			ct(e);
		}
		await p(C), await p(w), await p(T), await Ee(), await lt(Ze), await lt("sb_mesh_dm_worker"), A();
	}
}
async function P() {
	if (N()) throw Error("browser_identity_blocked_secure_mode");
}
function Ct() {
	return typeof window > "u" ? "Ed25519" : j(O) || "Ed25519";
}
function F(e) {
	let t = (e || "").toUpperCase();
	return t === "ED25519" || t === "EDDSA" ? "Ed25519" : "ECDSA";
}
function wt() {
	if (typeof window > "u") return 0;
	let e = j(D), t = e ? parseInt(e, 10) : 0;
	return Number.isFinite(t) ? t : 0;
}
function Tt(e) {
	typeof window > "u" || M(D, String(e));
}
function Et() {
	let e = wt() + 1;
	return M(D, String(e)), e;
}
function Dt(e) {
	return Array.from(new Uint8Array(e)).map((e) => e.toString(16).padStart(2, "0")).join("");
}
function I(e) {
	return btoa(String.fromCharCode(...new Uint8Array(e)));
}
function L(e) {
	let t = atob(e), n = new Uint8Array(t.length);
	for (let e = 0; e < t.length; e++) n[e] = t.charCodeAt(e);
	return n.buffer;
}
function R(e) {
	return new TextEncoder().encode(e);
}
function z(e) {
	let t = ArrayBuffer.isView(e) ? new Uint8Array(e.buffer, e.byteOffset, e.byteLength) : new Uint8Array(e), n = new Uint8Array(t.byteLength);
	return n.set(t), n;
}
async function Ot(e, t) {
	return Mn + Dt(await crypto.subtle.digest("SHA-256", z(e))).slice(0, t);
}
async function kt(e) {
	return Ot(e, Nn);
}
async function At(e) {
	let t = [];
	for (let n of [Nn, Pn]) {
		let r = await Ot(e, n);
		t.includes(r) || t.push(r);
	}
	return t;
}
async function jt(e) {
	return kt(L(e));
}
async function Mt(e, t) {
	try {
		return (await At(L(e))).includes(String(t || "").trim());
	} catch {
		return !1;
	}
}
async function Nt() {
	if (typeof window > "u") return;
	let e = j(h), t = j(_);
	if (e && t && mt(t) && !pt(t)) try {
		let n = await ht(e, t, (e) => {
			M(_, e);
		});
		n !== t && console.warn(`[mesh] migrated legacy browser node id ${t} -> ${n}`);
	} catch (e) {
		console.warn(`[mesh] failed to migrate legacy browser node id ${t}`, e);
	}
	try {
		let e = sessionStorage.getItem(y), t = sessionStorage.getItem(b);
		if (e && t && mt(t) && !pt(t)) try {
			let n = await ht(e, t, (e) => {
				sessionStorage.setItem(b, e);
			});
			n !== t && console.warn(`[mesh] migrated legacy Wormhole descriptor ${t} -> ${n}`);
		} catch (e) {
			console.warn(`[mesh] failed to migrate legacy Wormhole descriptor ${t}`, e);
		}
	} catch {}
}
async function Pt() {
	let e, t;
	try {
		e = await crypto.subtle.generateKey("Ed25519", !0, ["sign", "verify"]), t = "Ed25519";
	} catch {
		e = await crypto.subtle.generateKey({
			name: "ECDSA",
			namedCurve: "P-256"
		}, !0, ["sign", "verify"]), t = "ECDSA";
	}
	let n = await crypto.subtle.exportKey("raw", e.publicKey), r = await crypto.subtle.exportKey("jwk", e.privateKey), i = I(n), a = JSON.stringify(r), o = await kt(n);
	try {
		await d(T, await crypto.subtle.importKey("jwk", r, t === "Ed25519" ? "Ed25519" : {
			name: "ECDSA",
			namedCurve: "P-256"
		}, !1, ["sign"]));
	} catch (e) {
		console.warn("[mesh] signing key IndexedDB storage unavailable — key will not persist for this session", e);
	}
	return {
		publicKey: i,
		privateKey: a,
		nodeId: o,
		algo: t
	};
}
async function Ft() {
	let e = await f(T);
	if (e) return e;
	let t = j(g);
	if (!t) return null;
	try {
		let e = JSON.parse(t), n = F(j(O) || "Ed25519"), r = await crypto.subtle.importKey("jwk", e, n === "Ed25519" ? "Ed25519" : {
			name: "ECDSA",
			namedCurve: "P-256"
		}, !1, ["sign"]);
		return await d(T, r), st(), r;
	} catch (e) {
		return console.warn("[mesh] legacy signing key migration failed — clearing extractable browser copy", e), st(), null;
	}
}
async function It(e) {
	let t = vt();
	if (!t?.publicKey || !t.nodeId) throw Error("No local identity available for encrypted browser storage");
	let r = H(), i = U() || "X25519", a = await W();
	if ((!r || !a) && (r = await V(), i = U() || i, a = await W()), !r || !a) throw Error("No DH key available for contact encryption");
	let o = z(L(r)), s, c;
	i === "X25519" ? (s = await crypto.subtle.importKey("raw", o, "X25519", !1, []), c = await crypto.subtle.deriveBits({
		name: "X25519",
		public: s
	}, a, 256)) : (s = await crypto.subtle.importKey("raw", o, {
		name: "ECDH",
		namedCurve: "P-256"
	}, !1, []), c = await crypto.subtle.deriveBits({
		name: "ECDH",
		public: s
	}, a, 256));
	let l = await crypto.subtle.importKey("raw", z(c), "HKDF", !1, ["deriveKey"]);
	return crypto.subtle.deriveKey({
		name: "HKDF",
		hash: "SHA-256",
		salt: R(`${tt}|${t.nodeId}|${t.publicKey}|${n}`),
		info: R(e)
	}, l, {
		name: "AES-GCM",
		length: 256
	}, !1, ["encrypt", "decrypt"]);
}
async function Lt(e, t) {
	let n = await It(t), r = crypto.getRandomValues(new Uint8Array(12)), i = new TextEncoder().encode(JSON.stringify(e)), a = await crypto.subtle.encrypt({
		name: "AES-GCM",
		iv: r,
		additionalData: new TextEncoder().encode(t)
	}, n, i), o = new Uint8Array(r.length + a.byteLength);
	return o.set(r, 0), o.set(new Uint8Array(a), r.length), `${et}${I(o.buffer)}`;
}
async function Rt(e, t, n) {
	let r = String(e || "").trim();
	if (!r) return n;
	if (!r.startsWith(et)) return JSON.parse(r);
	let i = await It(t), a = r.slice(4), o = new Uint8Array(L(a)), s = o.slice(0, 12), c = o.slice(12), l = await crypto.subtle.decrypt({
		name: "AES-GCM",
		iv: s,
		additionalData: new TextEncoder().encode(t)
	}, i, c);
	return JSON.parse(new TextDecoder().decode(l));
}
async function zt(e) {
	return Lt(e, nt);
}
async function Bt(e) {
	return X(await Rt(e, nt, {}));
}
async function Vt(e) {
	let t = await Ft();
	if (!t) throw Error("No signing key available");
	let n = F(j(O) || "Ed25519"), r = new TextEncoder().encode(e), i;
	return i = n === "Ed25519" ? await crypto.subtle.sign("Ed25519", t, r) : await crypto.subtle.sign({
		name: "ECDSA",
		hash: "SHA-256"
	}, t, r), Dt(i);
}
function Ht(e, t, n) {
	if (N()) throw Error("browser_identity_blocked_secure_mode");
	M(h, e.publicKey), M(_, e.nodeId), M(v, "true"), M(D, String(n)), M(O, t), st(), A();
}
async function Ut() {
	await P();
	let { publicKey: e, privateKey: t, nodeId: n, algo: r } = await Pt();
	return {
		identity: {
			publicKey: e,
			privateKey: t,
			nodeId: n
		},
		algo: r
	};
}
async function Wt() {
	await P();
	let { publicKey: e, privateKey: t, nodeId: n, algo: r } = await Pt();
	return Ht({
		publicKey: e,
		privateKey: t,
		nodeId: n
	}, r, 0), await V(), {
		publicKey: e,
		privateKey: t,
		nodeId: n
	};
}
function Gt() {
	if (typeof window > "u" || N()) return null;
	let e = j(h), t = j(_);
	return !e || !t ? null : (j(g) && Ft(), {
		publicKey: e,
		privateKey: "",
		nodeId: t
	});
}
function Kt() {
	return typeof window > "u" ? !1 : j(v) === "true";
}
function qt() {
	M(v, "declined");
}
function Jt() {
	return typeof window > "u" ? !1 : j(v) === "declined";
}
async function Yt(e, t, n) {
	let r = String(t || "").trim();
	if (!r) throw Error("Explicit private signing material required");
	let i = JSON.parse(r), a = n || j("sb_mesh_algo") || "Ed25519", o;
	o = F(a) === "Ed25519" ? await crypto.subtle.importKey("jwk", i, "Ed25519", !1, ["sign"]) : await crypto.subtle.importKey("jwk", i, {
		name: "ECDSA",
		namedCurve: "P-256"
	}, !1, ["sign"]);
	let s = new TextEncoder().encode(e), c;
	return c = F(a) === "Ed25519" ? await crypto.subtle.sign("Ed25519", o, s) : await crypto.subtle.sign({
		name: "ECDSA",
		hash: "SHA-256"
	}, o, s), Dt(c);
}
async function Xt(e, t, n, r) {
	return Vt(me({
		eventType: e,
		nodeId: t,
		sequence: n,
		payload: r
	}));
}
var Zt = 512, B = /* @__PURE__ */ new Map();
function Qt(e, t) {
	return `${F(t)}:${e}`;
}
async function $t(e, t) {
	let n = F(t), r = Qt(e, n), i = B.get(r);
	if (i) return i;
	let a = (async () => {
		let t = L(e);
		return n === "Ed25519" ? crypto.subtle.importKey("raw", t, "Ed25519", !1, ["verify"]) : crypto.subtle.importKey("raw", t, {
			name: "ECDSA",
			namedCurve: "P-256"
		}, !1, ["verify"]);
	})().catch((e) => {
		throw B.delete(r), e;
	});
	if (B.set(r, a), B.size > Zt) {
		let e = B.keys().next().value;
		e && B.delete(e);
	}
	return a;
}
async function en(e, t, n, r) {
	let i = F(r || j("sb_mesh_algo") || "Ed25519"), a = await $t(n, i), o = new TextEncoder().encode(e), s = new Uint8Array(t.match(/.{2}/g).map((e) => parseInt(e, 16))).buffer;
	return i === "Ed25519" ? crypto.subtle.verify("Ed25519", a, s, o) : crypto.subtle.verify({
		name: "ECDSA",
		hash: "SHA-256"
	}, a, s, o);
}
async function tn(e) {
	try {
		return await en(e.message, e.signature, e.publicKey, e.publicKeyAlgo);
	} catch {
		return !1;
	}
}
async function nn(e) {
	return await Mt(e.publicKey, e.nodeId) ? en(me({
		eventType: e.eventType,
		nodeId: e.nodeId,
		sequence: e.sequence,
		payload: e.payload
	}), e.signature, e.publicKey, e.publicKeyAlgo) : !1;
}
async function V() {
	await P();
	let e = await f(C), t, n;
	try {
		t = await crypto.subtle.generateKey("X25519", !0, ["deriveBits", "deriveKey"]), n = "X25519";
	} catch {
		t = await crypto.subtle.generateKey({
			name: "ECDH",
			namedCurve: "P-256"
		}, !0, ["deriveBits", "deriveKey"]), n = "ECDH";
	}
	let r = await crypto.subtle.exportKey("raw", t.publicKey), i = await crypto.subtle.exportKey("jwk", t.privateKey), a = I(r);
	M(Ue, a), M(S, n), M(We, String(Math.floor(Date.now() / 1e3)));
	try {
		let t = await crypto.subtle.importKey("jwk", i, n === "X25519" ? "X25519" : {
			name: "ECDH",
			namedCurve: "P-256"
		}, !1, ["deriveBits", "deriveKey"]);
		e ? await d(w, e) : await p(w), await d(C, t), ot(x);
	} catch (e) {
		throw ot(x), console.warn("[mesh] DH key IndexedDB storage unavailable — DM encryption disabled", e), Error("IndexedDB required for DH key storage");
	}
	return a;
}
function rn() {
	if (typeof window > "u") return 0;
	let e = j(We), t = e ? parseInt(e, 10) : 0;
	return Number.isFinite(t) ? t : 0;
}
async function an(e = 168 * 3600) {
	if (typeof window > "u") return {
		pub: null,
		rotated: !1
	};
	let t = Math.floor(Date.now() / 1e3), n = rn(), r = H(), i = !1;
	return (!r || !n || t - n >= e) && (r = await V(), i = !0), await W(), {
		pub: r || null,
		rotated: i
	};
}
function H() {
	return typeof window > "u" ? null : j(Ue);
}
function U() {
	return typeof window > "u" ? "" : j(S) || "";
}
async function W() {
	return await f(C) || (j(x) && (ot(x), console.warn("[mesh] cleared legacy DH private key fallback from browser storage")), null);
}
async function on() {
	let e = [], t = await f(C);
	t && e.push(t);
	let n = await f(w);
	return n && n !== t && e.push(n), e;
}
async function sn(e, t) {
	let n = z(L(e));
	if (t.algorithm.name === "X25519") {
		let e = await crypto.subtle.importKey("raw", n, "X25519", !1, []);
		return crypto.subtle.deriveBits({
			name: "X25519",
			public: e
		}, t, 256);
	}
	let r = t.algorithm, i = await crypto.subtle.importKey("raw", n, {
		name: "ECDH",
		namedCurve: r.namedCurve || "P-256"
	}, !1, []);
	return crypto.subtle.deriveBits({
		name: "ECDH",
		public: i
	}, t, 256);
}
async function cn(e) {
	let t = j(S) || "X25519", n = await W();
	if (!n) throw Error("Missing DH private key");
	let r = z(L(e)), i;
	return t === "X25519" ? (i = await crypto.subtle.importKey("raw", r, "X25519", !1, []), crypto.subtle.deriveKey({
		name: "X25519",
		public: i
	}, n, {
		name: "AES-GCM",
		length: 256
	}, !1, ["encrypt", "decrypt"])) : (i = await crypto.subtle.importKey("raw", r, {
		name: "ECDH",
		namedCurve: "P-256"
	}, !1, []), crypto.subtle.deriveKey({
		name: "ECDH",
		public: i
	}, n, {
		name: "AES-GCM",
		length: 256
	}, !1, ["encrypt", "decrypt"]));
}
async function ln(e) {
	let t = j(S) || "X25519", n = await W();
	if (!n) throw Error("Missing DH private key");
	let r = z(L(e)), i;
	return t === "X25519" ? (i = await crypto.subtle.importKey("raw", r, "X25519", !1, []), crypto.subtle.deriveBits({
		name: "X25519",
		public: i
	}, n, 256)) : (i = await crypto.subtle.importKey("raw", r, {
		name: "ECDH",
		namedCurve: "P-256"
	}, !1, []), crypto.subtle.deriveBits({
		name: "ECDH",
		public: i
	}, n, 256));
}
async function un(e) {
	return crypto.subtle.digest("SHA-256", R(e));
}
async function dn(e, t, r) {
	let i = await ln(e), a = await un(`SB-SEAL-SALT|${t}|${r}|${n}`), o = await crypto.subtle.importKey("raw", z(i), "HKDF", !1, ["deriveKey"]);
	return crypto.subtle.deriveKey({
		name: "HKDF",
		hash: "SHA-256",
		salt: a,
		info: R("SB-SENDER-SEAL-V2")
	}, o, {
		name: "AES-GCM",
		length: 256
	}, !1, ["encrypt", "decrypt"]);
}
async function fn(e, t, r, i) {
	let a = await on();
	for (let o of a) try {
		let a = await sn(t, o), s = await un(`SB-SEAL-SALT|${r}|${i}|${n}|${t}`), c = await crypto.subtle.importKey("raw", z(a), "HKDF", !1, ["deriveKey"]);
		return await G(e, await crypto.subtle.deriveKey({
			name: "HKDF",
			hash: "SHA-256",
			salt: s,
			info: R("SB-SENDER-SEAL-V3")
		}, c, {
			name: "AES-GCM",
			length: 256
		}, !1, ["encrypt", "decrypt"]));
	} catch {}
	return null;
}
async function pn(e, t, n, r) {
	let i = mn(e);
	try {
		if (i.version === "v3") {
			let e = String(i.ephemeralPub || "").trim();
			return e ? await fn(i.payload, e, n, r) : null;
		}
		let e = i.version === "v2" ? await dn(t, n, r) : await cn(t);
		return await G(i.payload, e);
	} catch {
		return null;
	}
}
function mn(e) {
	let t = String(e || "").trim();
	if (t.startsWith("v3:")) {
		let [, e, n] = t.split(":", 3);
		return {
			version: "v3",
			payload: n,
			ephemeralPub: e
		};
	}
	return t.startsWith("v2:") ? {
		version: "v2",
		payload: t.slice(3)
	} : {
		version: "legacy",
		payload: t
	};
}
async function hn(e, t) {
	let n = crypto.getRandomValues(new Uint8Array(12)), r = new TextEncoder().encode(e), i = await crypto.subtle.encrypt({
		name: "AES-GCM",
		iv: n
	}, t, r), a = new Uint8Array(n.length + i.byteLength);
	return a.set(n, 0), a.set(new Uint8Array(i), n.length), I(a.buffer);
}
async function G(e, t) {
	let n = new Uint8Array(L(e)), r = n.slice(0, 12), i = n.slice(12), a = await crypto.subtle.decrypt({
		name: "AES-GCM",
		iv: r
	}, t, i);
	return new TextDecoder().decode(a);
}
var K = {}, q = null, gn = 0, _n = Promise.resolve();
function J() {
	return N();
}
function Y(e) {
	let t = e?.trustSummary;
	return {
		alias: String(e?.alias || ""),
		blocked: !!e?.blocked,
		dhPubKey: String(e?.dhPubKey || ""),
		dhAlgo: String(e?.dhAlgo || ""),
		sharedAlias: String(e?.sharedAlias || ""),
		previousSharedAliases: Array.isArray(e?.previousSharedAliases) ? e?.previousSharedAliases.filter(Boolean).map(String).slice(-2) : [],
		pendingSharedAlias: String(e?.pendingSharedAlias || ""),
		sharedAliasGraceUntil: Number(e?.sharedAliasGraceUntil || 0),
		sharedAliasRotatedAt: Number(e?.sharedAliasRotatedAt || 0),
		verify_inband: !!e?.verify_inband,
		verify_registry: !!e?.verify_registry,
		verified: !!e?.verified,
		verify_mismatch: !!e?.verify_mismatch,
		verified_at: Number(e?.verified_at || 0),
		trust_level: String(e?.trust_level || ""),
		invitePinnedTrustFingerprint: String(e?.invitePinnedTrustFingerprint || ""),
		invitePinnedNodeId: String(e?.invitePinnedNodeId || ""),
		invitePinnedPublicKey: String(e?.invitePinnedPublicKey || ""),
		invitePinnedPublicKeyAlgo: String(e?.invitePinnedPublicKeyAlgo || ""),
		invitePinnedDhPubKey: String(e?.invitePinnedDhPubKey || ""),
		invitePinnedDhAlgo: String(e?.invitePinnedDhAlgo || ""),
		invitePinnedPrekeyLookupHandle: String(e?.invitePinnedPrekeyLookupHandle || ""),
		invitePinnedLookupPeerUrl: String(e?.invitePinnedLookupPeerUrl || ""),
		invitePinnedRootFingerprint: String(e?.invitePinnedRootFingerprint || ""),
		invitePinnedRootManifestFingerprint: String(e?.invitePinnedRootManifestFingerprint || ""),
		invitePinnedRootWitnessPolicyFingerprint: String(e?.invitePinnedRootWitnessPolicyFingerprint || ""),
		invitePinnedRootWitnessThreshold: Number(e?.invitePinnedRootWitnessThreshold || 0),
		invitePinnedRootWitnessCount: Number(e?.invitePinnedRootWitnessCount || 0),
		invitePinnedRootWitnessDomainCount: Number(e?.invitePinnedRootWitnessDomainCount || 0),
		invitePinnedRootManifestGeneration: Number(e?.invitePinnedRootManifestGeneration || 0),
		invitePinnedRootRotationProven: !!e?.invitePinnedRootRotationProven,
		invitePinnedRootNodeId: String(e?.invitePinnedRootNodeId || ""),
		invitePinnedRootPublicKey: String(e?.invitePinnedRootPublicKey || ""),
		invitePinnedRootPublicKeyAlgo: String(e?.invitePinnedRootPublicKeyAlgo || ""),
		invitePinnedIssuedAt: Number(e?.invitePinnedIssuedAt || 0),
		invitePinnedExpiresAt: Number(e?.invitePinnedExpiresAt || 0),
		invitePinnedAt: Number(e?.invitePinnedAt || 0),
		remotePrekeyFingerprint: String(e?.remotePrekeyFingerprint || ""),
		remotePrekeyObservedFingerprint: String(e?.remotePrekeyObservedFingerprint || ""),
		remotePrekeyRootFingerprint: String(e?.remotePrekeyRootFingerprint || ""),
		remotePrekeyRootManifestFingerprint: String(e?.remotePrekeyRootManifestFingerprint || ""),
		remotePrekeyRootWitnessPolicyFingerprint: String(e?.remotePrekeyRootWitnessPolicyFingerprint || ""),
		remotePrekeyRootWitnessThreshold: Number(e?.remotePrekeyRootWitnessThreshold || 0),
		remotePrekeyRootWitnessCount: Number(e?.remotePrekeyRootWitnessCount || 0),
		remotePrekeyRootWitnessDomainCount: Number(e?.remotePrekeyRootWitnessDomainCount || 0),
		remotePrekeyRootManifestGeneration: Number(e?.remotePrekeyRootManifestGeneration || 0),
		remotePrekeyRootRotationProven: !!e?.remotePrekeyRootRotationProven,
		remotePrekeyObservedRootFingerprint: String(e?.remotePrekeyObservedRootFingerprint || ""),
		remotePrekeyObservedRootManifestFingerprint: String(e?.remotePrekeyObservedRootManifestFingerprint || ""),
		remotePrekeyObservedRootWitnessPolicyFingerprint: String(e?.remotePrekeyObservedRootWitnessPolicyFingerprint || ""),
		remotePrekeyObservedRootWitnessThreshold: Number(e?.remotePrekeyObservedRootWitnessThreshold || 0),
		remotePrekeyObservedRootWitnessCount: Number(e?.remotePrekeyObservedRootWitnessCount || 0),
		remotePrekeyObservedRootWitnessDomainCount: Number(e?.remotePrekeyObservedRootWitnessDomainCount || 0),
		remotePrekeyObservedRootManifestGeneration: Number(e?.remotePrekeyObservedRootManifestGeneration || 0),
		remotePrekeyObservedRootRotationProven: !!e?.remotePrekeyObservedRootRotationProven,
		remotePrekeyRootNodeId: String(e?.remotePrekeyRootNodeId || ""),
		remotePrekeyRootPublicKey: String(e?.remotePrekeyRootPublicKey || ""),
		remotePrekeyRootPublicKeyAlgo: String(e?.remotePrekeyRootPublicKeyAlgo || ""),
		remotePrekeyRootPinnedAt: Number(e?.remotePrekeyRootPinnedAt || 0),
		remotePrekeyRootLastSeenAt: Number(e?.remotePrekeyRootLastSeenAt || 0),
		remotePrekeyRootMismatch: !!e?.remotePrekeyRootMismatch,
		remotePrekeyPinnedAt: Number(e?.remotePrekeyPinnedAt || 0),
		remotePrekeyLastSeenAt: Number(e?.remotePrekeyLastSeenAt || 0),
		remotePrekeySequence: Number(e?.remotePrekeySequence || 0),
		remotePrekeySignedAt: Number(e?.remotePrekeySignedAt || 0),
		remotePrekeyMismatch: !!e?.remotePrekeyMismatch,
		remotePrekeyTransparencyHead: String(e?.remotePrekeyTransparencyHead || ""),
		remotePrekeyTransparencySize: Number(e?.remotePrekeyTransparencySize || 0),
		remotePrekeyTransparencySeenAt: Number(e?.remotePrekeyTransparencySeenAt || 0),
		remotePrekeyTransparencyConflict: !!e?.remotePrekeyTransparencyConflict,
		remotePrekeyLookupMode: String(e?.remotePrekeyLookupMode || "").trim().toLowerCase(),
		witness_count: Number(e?.witness_count || 0),
		witness_checked_at: Number(e?.witness_checked_at || 0),
		vouch_count: Number(e?.vouch_count || 0),
		vouch_checked_at: Number(e?.vouch_checked_at || 0),
		trustSummary: t ? {
			state: String(t.state || "").trim(),
			label: String(t.label || "").trim(),
			severity: String(t.severity || "warn").trim(),
			detail: String(t.detail || "").trim(),
			verifiedFirstContact: !!t.verifiedFirstContact,
			recommendedAction: String(t.recommendedAction || "show_sas").trim(),
			legacyLookup: !!t.legacyLookup,
			inviteAttested: !!t.inviteAttested,
			rootAttested: !!t.rootAttested,
			rootWitnessed: !!t.rootWitnessed,
			rootDistributionState: String(t.rootDistributionState || "none").trim(),
			rootWitnessPolicyFingerprint: String(t.rootWitnessPolicyFingerprint || ""),
			rootWitnessCount: Number(t.rootWitnessCount || 0),
			rootWitnessThreshold: Number(t.rootWitnessThreshold || 0),
			rootWitnessQuorumMet: !!t.rootWitnessQuorumMet,
			rootWitnessProvenanceState: String(t.rootWitnessProvenanceState || "none").trim(),
			rootWitnessDomainCount: Number(t.rootWitnessDomainCount || 0),
			rootWitnessIndependentQuorumMet: !!t.rootWitnessIndependentQuorumMet,
			rootManifestGeneration: Number(t.rootManifestGeneration || 0),
			rootRotationProven: !!t.rootRotationProven,
			rootMismatch: !!t.rootMismatch,
			registryMismatch: !!t.registryMismatch,
			transparencyConflict: !!t.transparencyConflict
		} : void 0
	};
}
function X(e) {
	return Object.fromEntries(Object.entries(e || {}).map(([e, t]) => [e, Y(t)]));
}
async function Z(e, t) {
	await m("/api/wormhole/dm/contact", {
		method: "PUT",
		requireAdminSession: !1,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			peer_id: e,
			contact: t
		})
	});
}
async function vn(e) {
	await m(`/api/wormhole/dm/contact/${encodeURIComponent(e)}`, {
		method: "DELETE",
		requireAdminSession: !1
	});
}
async function yn(e = !1) {
	return J() ? (!e && q || (q = bn().catch(() => K)), q) : (!e && q || (q = (async () => {
		if (typeof window > "u") return K = {}, K;
		let e = j(E) || "";
		if (!e) return K = {}, K;
		try {
			let t = await Bt(e);
			return K = t, e.startsWith(et) || Sn(t), K;
		} catch (e) {
			return console.warn("[mesh] contact storage unreadable — treating as empty contacts", e), K = {}, K;
		}
	})()), q);
}
async function bn() {
	return K = X((await m("/api/wormhole/dm/contacts", { requireAdminSession: !1 })).contacts || {}), q = Promise.resolve(K), K;
}
function xn() {
	return !J() && !q && typeof window < "u" && yn(), K;
}
function Q() {
	return J() ? K : xn();
}
async function Sn(e) {
	try {
		M(E, await zt(X(e)));
	} catch (e) {
		console.warn("[mesh] contact storage encryption unavailable — contacts kept in memory only", e);
	}
}
function Cn(e) {
	let t = ++gn, n = X(e);
	_n = _n.catch(() => {}).then(async () => {
		t === gn && await Sn(n);
	});
}
function $(e) {
	let t = X(e);
	K = t, !J() && Cn(t);
}
function wn(e, t, n, r) {
	let i = Q(), a = Y({
		alias: n || i[e]?.alias,
		blocked: i[e]?.blocked || !1,
		dhPubKey: t,
		dhAlgo: r || i[e]?.dhAlgo,
		sharedAlias: i[e]?.sharedAlias,
		previousSharedAliases: i[e]?.previousSharedAliases,
		pendingSharedAlias: i[e]?.pendingSharedAlias,
		sharedAliasGraceUntil: i[e]?.sharedAliasGraceUntil,
		sharedAliasRotatedAt: i[e]?.sharedAliasRotatedAt,
		verify_inband: i[e]?.verify_inband,
		verify_registry: i[e]?.verify_registry,
		verified: i[e]?.verified,
		verify_mismatch: i[e]?.verify_mismatch,
		verified_at: i[e]?.verified_at,
		trust_level: i[e]?.trust_level,
		invitePinnedTrustFingerprint: i[e]?.invitePinnedTrustFingerprint,
		invitePinnedNodeId: i[e]?.invitePinnedNodeId,
		invitePinnedPublicKey: i[e]?.invitePinnedPublicKey,
		invitePinnedPublicKeyAlgo: i[e]?.invitePinnedPublicKeyAlgo,
		invitePinnedDhPubKey: i[e]?.invitePinnedDhPubKey,
		invitePinnedDhAlgo: i[e]?.invitePinnedDhAlgo,
		invitePinnedPrekeyLookupHandle: i[e]?.invitePinnedPrekeyLookupHandle,
		invitePinnedRootFingerprint: i[e]?.invitePinnedRootFingerprint,
		invitePinnedRootNodeId: i[e]?.invitePinnedRootNodeId,
		invitePinnedRootPublicKey: i[e]?.invitePinnedRootPublicKey,
		invitePinnedRootPublicKeyAlgo: i[e]?.invitePinnedRootPublicKeyAlgo,
		invitePinnedIssuedAt: i[e]?.invitePinnedIssuedAt,
		invitePinnedExpiresAt: i[e]?.invitePinnedExpiresAt,
		invitePinnedAt: i[e]?.invitePinnedAt,
		remotePrekeyFingerprint: i[e]?.remotePrekeyFingerprint,
		remotePrekeyObservedFingerprint: i[e]?.remotePrekeyObservedFingerprint,
		remotePrekeyRootFingerprint: i[e]?.remotePrekeyRootFingerprint,
		remotePrekeyObservedRootFingerprint: i[e]?.remotePrekeyObservedRootFingerprint,
		remotePrekeyRootNodeId: i[e]?.remotePrekeyRootNodeId,
		remotePrekeyRootPublicKey: i[e]?.remotePrekeyRootPublicKey,
		remotePrekeyRootPublicKeyAlgo: i[e]?.remotePrekeyRootPublicKeyAlgo,
		remotePrekeyRootPinnedAt: i[e]?.remotePrekeyRootPinnedAt,
		remotePrekeyRootLastSeenAt: i[e]?.remotePrekeyRootLastSeenAt,
		remotePrekeyRootMismatch: i[e]?.remotePrekeyRootMismatch,
		remotePrekeyPinnedAt: i[e]?.remotePrekeyPinnedAt,
		remotePrekeyLastSeenAt: i[e]?.remotePrekeyLastSeenAt,
		remotePrekeySequence: i[e]?.remotePrekeySequence,
		remotePrekeySignedAt: i[e]?.remotePrekeySignedAt,
		remotePrekeyMismatch: i[e]?.remotePrekeyMismatch,
		remotePrekeyTransparencyHead: i[e]?.remotePrekeyTransparencyHead,
		remotePrekeyTransparencySize: i[e]?.remotePrekeyTransparencySize,
		remotePrekeyTransparencySeenAt: i[e]?.remotePrekeyTransparencySeenAt,
		remotePrekeyTransparencyConflict: i[e]?.remotePrekeyTransparencyConflict,
		remotePrekeyLookupMode: i[e]?.remotePrekeyLookupMode,
		witness_count: i[e]?.witness_count,
		witness_checked_at: i[e]?.witness_checked_at,
		vouch_count: i[e]?.vouch_count,
		vouch_checked_at: i[e]?.vouch_checked_at
	});
	i[e] = a, $(i), J() && Z(e, a);
}
function Tn(e, t) {
	let n = Q();
	n[e] = Y({
		...n[e] || Y({ blocked: !1 }),
		...t
	}), $(n), J() && Z(e, n[e]);
}
function En(e) {
	let t = Q();
	t[e] ? t[e].blocked = !0 : t[e] = Y({ blocked: !0 }), $(t), J() && Z(e, Y(t[e]));
}
function Dn(e) {
	let t = Q();
	t[e] && (t[e].blocked = !1, $(t), J() && Z(e, Y(t[e])));
}
function On(e) {
	let t = Q();
	e in t && (delete t[e], $(t), J() && vn(e));
}
async function kn(e, t = {}) {
	let n = String(e || "").trim();
	if (!n) return;
	await m(`/api/wormhole/dm/contact/${encodeURIComponent(n)}/sever`, {
		method: "POST",
		requireAdminSession: !1,
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ block: !!t.block })
	});
	let r = Q();
	n in r && (r[n] = Y({
		...r[n],
		sharedAlias: void 0,
		previousSharedAliases: [],
		pendingSharedAlias: void 0,
		sharedAliasGraceUntil: void 0,
		sharedAliasRotatedAt: void 0,
		...t.block ? { blocked: !0 } : {}
	}), $(r), J() && await Z(n, r[n]));
}
function An() {
	return typeof window > "u" ? !0 : j(Ge) !== "false";
}
function jn(e) {
	M(Ge, e ? "true" : "false");
}
var Mn = "!sb_", Nn = 32, Pn = 16, Fn = 8;
//#endregion
export { Fe as $, N as A, Tt as B, Ct as C, yn as D, Kt as E, xt as F, Dn as G, Xt as H, bt as I, nn as J, mn as K, On as L, Nt as M, Et as N, bn as O, Ht as P, m as Q, jn as R, Gt as S, yt as T, Yt as U, kn as V, Vt as W, tn as X, Mt as Y, Be as Z, Wt as _, Ut as a, Te as at, H as b, Rt as c, pe as ct, cn as d, je as et, ln as f, V as g, an as h, St as i, we as it, Ve as j, Jt as k, pn as l, Lt as m, En as n, Ae as nt, qt as o, n as ot, hn as p, Tn as q, _t as r, Ce as rt, G as s, me as st, wn as t, ke as tt, dn as u, Q as v, vt as w, An as x, U as y, gt as z };
