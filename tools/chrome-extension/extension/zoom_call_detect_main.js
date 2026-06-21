// zoom_call_detect_main.js
//
// MAIN-world helper for Zoom web-phone call detection (Workstream E).
//
// Runs in the PAGE's JS world (manifest `"world": "MAIN"`, `run_at:"document_start"`)
// so it can monkey-patch the page's own `window.WebSocket`. Zoom Phone signaling
// rides one or more WebSockets; the message PAYLOADS are opaque/minified, but the
// OPEN/CLOSE *timing* of the signaling socket is a usable proxy for "a call is
// live / has ended". We never read the audio or message bodies — only connection
// lifecycle + a coarse "active traffic" heartbeat.
//
// This script CANNOT use chrome.* (MAIN world has no extension APIs), so it
// communicates with the isolated content script (zoom_call_detect.js) purely via
// window.postMessage. The isolated side validates origin/source and forwards to
// the service worker.
//
// Defensive throughout: a thrown error here would break Zoom's own networking, so
// every patch path is wrapped and falls back to the native behavior.

(function () {
    'use strict';

    // Guard against double-injection (all_frames + SPA reloads can re-run us).
    if (window.__GMES_ZOOM_WS_PATCH__) return;
    window.__GMES_ZOOM_WS_PATCH__ = true;

    var TAG = '__GMES_ZOOM__';          // postMessage discriminator
    var SourceWS = 'ws';

    // Heuristics for "this socket is Zoom phone/call signaling" vs. some unrelated
    // socket (analytics, chat, etc.). We can't trust class names, so we match the
    // socket URL against known Zoom signaling host/path fragments. Kept permissive:
    // a false positive only means we *might* fire a spurious start that the
    // isolated-side observer corroboration and the worker's idempotent START guard
    // can absorb; a false negative falls back to the DOM observer.
    // ---- TUNE against a live Zoom web-phone session (check the WS URLs in DevTools) ----
    var CALL_URL_HINTS = [
        'pwa',          // pwa.zoom.us socket
        'phone',        // *phone* signaling
        'rwg',          // Zoom real-time web gateway
        'rwc',          // real-time web client
        'wc',           // web client
        'aws',          // zoom media edges
        'voip',
        'call',
        'sip',
        'rtcp',
        'pbx'
    ];
    // ---- end tuning block ----

    function looksLikeCallSocket(url) {
        if (!url) return false;
        var u = String(url).toLowerCase();
        // Only consider zoom.us sockets at all.
        if (u.indexOf('zoom.us') === -1 && u.indexOf('zoom.com') === -1) return false;
        for (var i = 0; i < CALL_URL_HINTS.length; i++) {
            if (u.indexOf(CALL_URL_HINTS[i]) !== -1) return true;
        }
        // Any wss to a zoom host is a weak signal; let it through so we don't miss
        // the call socket on a Zoom build that renamed paths. The DOM observer and
        // the worker dedup keep this safe.
        return /^wss:/.test(u);
    }

    function post(kind, detail) {
        try {
            window.postMessage({
                __gmesZoom: TAG,
                source: SourceWS,
                kind: kind,                 // 'open' | 'close' | 'activity'
                // 'close' is only emitted once the LAST call socket drops (see
                // openCallSockets below). Flag it as a definitive/hard end so the
                // isolated side can confirm the call end on a short grace instead of
                // the long DOM-only grace — this is what lets a fast back-to-back
                // second call get its own START/STOP pair.
                hard: detail && detail.hard ? true : false,
                url: detail && detail.url ? detail.url : '',
                ts: Date.now()
            }, '*');
        } catch (e) { /* never throw into the page */ }
    }

    var NativeWS = window.WebSocket;
    if (typeof NativeWS !== 'function') return;

    // Track how many candidate call sockets are currently open, so we only emit a
    // "close" (call may have ended) when the LAST one drops, and an "open" when the
    // FIRST appears. This collapses Zoom's multiple parallel sockets into one
    // call-level signal.
    var openCallSockets = 0;

    function Patched(url, protocols) {
        var ws;
        try {
            ws = (protocols === undefined) ? new NativeWS(url) : new NativeWS(url, protocols);
        } catch (e) {
            // Preserve native throw semantics.
            throw e;
        }

        var isCall = false;
        try { isCall = looksLikeCallSocket(url); } catch (e) { isCall = false; }

        if (isCall) {
            try {
                ws.addEventListener('open', function () {
                    openCallSockets++;
                    if (openCallSockets === 1) post('open', { url: url });
                });
                var onGone = function () {
                    if (openCallSockets > 0) openCallSockets--;
                    // Last call socket gone => definitive ("hard") end. Mark it so the
                    // isolated side ends fast, freeing the state machine for the next call.
                    if (openCallSockets === 0) post('close', { url: url, hard: true });
                };
                ws.addEventListener('close', onGone);
                ws.addEventListener('error', function () {
                    // An errored socket may never fire 'close'; treat it as gone after
                    // a short grace period so we don't leak the open count.
                    setTimeout(function () {
                        try {
                            if (ws.readyState === NativeWS.CLOSED || ws.readyState === NativeWS.CLOSING) onGone();
                        } catch (e2) {}
                    }, 1500);
                });
                // Coarse activity heartbeat: an actively-signaling call socket keeps
                // receiving frames. The isolated side uses this only as a liveness
                // hint; we throttle hard so we never flood postMessage.
                var lastBeat = 0;
                ws.addEventListener('message', function () {
                    var now = Date.now();
                    if (now - lastBeat > 5000) { lastBeat = now; post('activity', { url: url }); }
                });
            } catch (e) { /* listeners are best-effort */ }
        }

        return ws;
    }

    // Preserve the prototype + statics so page code that does
    // `ws instanceof WebSocket` or reads WebSocket.OPEN still works.
    try {
        Patched.prototype = NativeWS.prototype;
        Patched.CONNECTING = NativeWS.CONNECTING;
        Patched.OPEN = NativeWS.OPEN;
        Patched.CLOSING = NativeWS.CLOSING;
        Patched.CLOSED = NativeWS.CLOSED;
        // Keep a handle to the original for debugging / un-patch.
        Patched.__gmesNative = NativeWS;
        window.WebSocket = Patched;
    } catch (e) {
        // If anything about re-binding fails, leave the native WebSocket intact.
        try { window.WebSocket = NativeWS; } catch (e2) {}
    }
})();
