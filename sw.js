importScripts("/scram/scramjet.all.js");

const { ScramjetServiceWorker } = $scramjetLoadWorker();
const scramjet = new ScramjetServiceWorker();

// Must match the Scramjet prefix (the default is "/scramjet/").
const PROXY_PREFIX = "/scramjet/";

// After some logins (GeForce NOW), the page ends up navigating to an address that is
// already proxied. It gets wrapped a second time and Scramjet refuses it with
// "attempted to fetch from same origin". Peel off the extra layers and redirect to the
// correctly proxied address instead. Normal proxied URLs are left alone.
function unwrapNestedProxyUrl(requestUrl) {
	const selfPrefix = self.location.origin + PROXY_PREFIX;
	let current = requestUrl;
	let changed = false;
	for (let i = 0; i < 5; i++) {
		if (!current.startsWith(selfPrefix)) break;
		let inner;
		try {
			inner = decodeURIComponent(current.slice(selfPrefix.length));
		} catch (_) {
			break;
		}
		if (!inner.startsWith(selfPrefix)) break;
		current = inner;
		changed = true;
	}
	return changed ? current : null;
}

// ROOT-CAUSE FIX (Scramjet 1.1.0).
// When a page calls scramjet.init() it posts {scramjet$type:"loadConfig"} to the worker. Scramjet
// then stores that config on the worker object but never sets its internal global config, and
// loadConfig() skips loading because the config already "exists". route() works, but fetch()
// crashes with "Cannot read properties of undefined (reading 'prefix')". It happens whenever the
// browser had put the worker to sleep and the page's message wakes a fresh copy first.
// Fix: once per worker start (and again whenever the page pushes a new config), drop the
// pushed copy and let Scramjet load the config from IndexedDB, which sets everything up properly.
let primed = null;

self.addEventListener("message", (e) => {
	if (e.data && e.data.scramjet$type === "loadConfig") primed = null;
	// The "Try again" button on the error page asks for a fresh connection first.
	if (e.data && e.data.lemniscate$type === "reset-request") {
		lastReset = 0;
		const port = e.ports && e.ports[0];
		e.waitUntil(
			resetTransport().then((ok) => {
				try {
					port && port.postMessage({ ok });
				} catch (_) {}
			})
		);
	}
});

function primeConfig() {
	if (!primed) {
		primed = (async () => {
			scramjet.config = undefined;
			await scramjet.loadConfig();
			if (!scramjet.config) throw new Error("Scramjet config is not saved yet (open the home page first).");
		})().catch((err) => {
			primed = null;
			throw err;
		});
	}
	return primed;
}

async function serve(event) {
	await primeConfig();
	if (scramjet.route(event)) {
		const res = await scramjet.fetch(event);
		// Flash games: Ruffle sometimes asks for the .swf at the site root instead of inside
		// the game's own folder. If that request fails, retry in the game's folder.
		return res.ok ? res : (await swfFallback(event)) || res;
	}
	return fetch(event.request);
}

// The proxy talks to the server over ONE shared Wisp WebSocket. If it drops (server restart,
// network blip, idle timeout) every request fails with "Wisp: MuxTaskEnded" until the transport
// is set up again, and nothing did that. When we see such an error, ask the open page(s) to
// reconnect the transport, then retry the request once.
const CONNECTION_ERROR = /wisp|muxtask|multiplexor|hyper client|websocket|network ?error|failed to fetch/i;
let resetting = null;
let lastReset = 0;

function resetTransport() {
	// Several requests fail together when the socket drops; reconnect once for all of them.
	if (resetting) return resetting;
	if (Date.now() - lastReset < 1500) return Promise.resolve(true);
	resetting = (async () => {
		try {
			const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			if (!pages.length) return false;
			return await new Promise((resolve) => {
				const timer = setTimeout(() => resolve(false), 4000);
				for (const page of pages) {
					const channel = new MessageChannel();
					channel.port1.onmessage = (e) => {
						if (e.data && e.data.ok) {
							clearTimeout(timer);
							resolve(true);
						}
					};
					try {
						page.postMessage({ lemniscate$type: "reset-transport" }, [channel.port2]);
					} catch (_) {}
				}
			});
		} catch (_) {
			return false;
		} finally {
			lastReset = Date.now();
			resetting = null;
		}
	})();
	return resetting;
}

async function handleRequest(event) {
	const nested = unwrapNestedProxyUrl(event.request.url);
	if (nested) return Response.redirect(nested, 302);

	try {
		try {
			return await serve(event);
		} catch (err) {
			const msg = String((err && (err.message || err)) || "");
			const retryable = event.request.method === "GET" || event.request.method === "HEAD";
			if (!retryable || !CONNECTION_ERROR.test(msg)) throw err;
			if (!(await resetTransport())) throw err;
			return await serve(event);
		}
	} catch (err) {
		// When the proxy connection is down (Wisp socket closed, transport not set, server
		// restarting) Scramjet throws and Chrome would show its blank "might be temporarily
		// down" page. For page loads, show the real reason and a retry button instead.
		const dest = event.request.destination;
		if (event.request.mode === "navigate" || dest === "document" || dest === "iframe") {
			return proxyErrorPage(err);
		}
		throw err;
	}
}

// The real (unproxied) address inside a /scramjet/<encoded address> URL, or null.
function realUrlOf(url) {
	const prefix = self.location.origin + PROXY_PREFIX;
	if (!url || !url.startsWith(prefix)) return null;
	try {
		return decodeURIComponent(url.slice(prefix.length));
	} catch (_) {
		return null;
	}
}

// Pure helper: given the failed .swf address and the game page that asked for it, return the
// address of the same file inside that game's folder (".../semag/<game>/<file>.swf"), or null.
function swfCandidate(swfUrl, pageUrl) {
	if (!swfUrl || !pageUrl) return null;
	let swf, dir;
	try {
		swf = new URL(swfUrl);
		dir = new URL(pageUrl);
	} catch (_) {
		return null;
	}
	if (!/\.swf$/i.test(swf.pathname)) return null;
	const m = dir.pathname.match(/^(.*\/semag\/[^/]+\/)/);
	if (!m) return null;
	const file = swf.pathname.split("/").pop();
	const candidate = dir.origin + m[1] + file + swf.search;
	return candidate === swf.href ? null : candidate;
}

async function swfFallback(event) {
	try {
		const swfUrl = realUrlOf(event.request.url);
		if (!swfUrl || !/\.swf(\?|$)/i.test(swfUrl)) return null;
		let pageUrl = null;
		if (event.clientId) {
			const client = await self.clients.get(event.clientId);
			pageUrl = client && realUrlOf(client.url);
		}
		pageUrl = pageUrl || realUrlOf(event.request.referrer);
		const candidate = swfCandidate(swfUrl, pageUrl);
		if (!candidate) return null;
		return Response.redirect(self.location.origin + PROXY_PREFIX + encodeURIComponent(candidate), 302);
	} catch (_) {
		return null;
	}
}

const escapeHtml = (s) =>
	String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function proxyErrorPage(err) {
	const detail = escapeHtml((err && (err.stack || err.message)) || err);
	const html =
		'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
		"<title>Connection problem</title>" +
		"<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050607;color:#e8f5ea;" +
		"font:15px system-ui,sans-serif}main{max-width:34rem;padding:1.5rem}h1{font-size:1.2rem;color:#7dff8a}" +
		"button{padding:.6rem 1.1rem;border-radius:.6rem;border:1px solid #7dff8a;background:transparent;color:#7dff8a;" +
		"font:inherit;cursor:pointer}pre{white-space:pre-wrap;word-break:break-word;opacity:.6;font-size:12px;" +
		"max-height:9rem;overflow:auto}</style><main><h1>Couldn't reach the proxy</h1>" +
		"<p>The connection to the proxy server dropped. This is usually temporary.</p>" +
		'<p><button id="retry">Try again</button></p><pre>' +
		detail +
		"</pre></main><script>" +
		"document.getElementById('retry').onclick=function(){var b=this;b.disabled=true;b.textContent='Reconnecting...';" +
		"var done=false,go=function(){if(!done){done=true;location.reload();}};setTimeout(go,5000);" +
		"try{var c=new MessageChannel();c.port1.onmessage=go;" +
		"navigator.serviceWorker.controller.postMessage({lemniscate$type:'reset-request'},[c.port2]);}catch(e){go();}};" +
		"</script>";
	return new Response(html, { status: 502, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// Take over right away so updates to this file apply without unregistering.
self.addEventListener("install", (event) => {
	self.skipWaiting();
	// Only wake this worker for proxied pages (/scramjet/...). Everything else, such as
	// games and site files, goes straight to the network, so the worker (and Scramjet in
	// its memory) can sleep while someone plays. Chrome 123+; older browsers just skip this.
	try {
		if (event.addRoutes) {
			event.addRoutes([
				{
					condition: { urlPattern: { pathname: PROXY_PREFIX + "*" } },
					source: "fetch-event",
				},
				{ condition: { not: { urlPattern: { pathname: PROXY_PREFIX + "*" } } }, source: "network" },
			]);
		}
	} catch (_) {}
});
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
	event.respondWith(handleRequest(event));
});
