(function () {
  'use strict';

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Apply pill toggle state (add/remove .on class and update label text)
  function applyPill(btn, active) {
    if (!btn) return;
    if (active) {
      btn.classList.add('on');
      btn.querySelector('.pill-text').textContent = 'ON';
    } else {
      btn.classList.remove('on');
      btn.querySelector('.pill-text').textContent = 'OFF';
    }
  }

  // Wire a pill toggle to a chrome.storage.local boolean key.
  // defaultOn: if true, treat a missing/undefined value as ON (value !== false).
  //            if false, treat missing as OFF (value === true).
  function initPillToggle(btnId, storageKey, defaultOn) {
    var btn = document.getElementById(btnId);
    if (!btn) return;

    chrome.storage.local.get([storageKey], function (data) {
      var value = data[storageKey];
      var active = defaultOn ? (value !== false) : (value === true);
      applyPill(btn, active);
    });

    btn.addEventListener('click', function () {
      var nowOn = !btn.classList.contains('on');
      applyPill(btn, nowOn);
      var entry = {};
      entry[storageKey] = nowOn;
      chrome.storage.local.set(entry);
    });
  }

  // ── Pill toggles ─────────────────────────────────────────────────────────────

  // Replace GHL dialer with Zoom — default ON
  initPillToggle('zoomEnabledToggle', 'gmes_zoom_enabled', true);

  // Click phone numbers to call (Zoom) — default ON
  initPillToggle('zoomClickToCallToggle', 'gmes_zoom_click_to_call', true);

  // Hide LeadConnector dialer — default ON
  initPillToggle('zoomHideLcToggle', 'gmes_zoom_hide_lc', true);

  // Pre-launch Zoom on GHL pages — default OFF
  initPillToggle('zoomPrewarmToggle', 'gmes_zoom_prewarm', false);

  // Record Zoom web phone calls via the local CRM Agent — default ON
  initPillToggle('zoomRecordCallsToggle', 'gmes_zoom_record_calls', true);

  // ── Caller ID input ───────────────────────────────────────────────────────────

  var callerIdInput = document.getElementById('zoomCallerIdInput');
  var callerIdTimer = null;

  if (callerIdInput) {
    // Load stored value on init
    chrome.storage.local.get(['gmes_zoom_caller_id'], function (data) {
      callerIdInput.value = data.gmes_zoom_caller_id || '';
    });

    // Debounced save on input — allows digits, +, spaces, dashes, parens
    callerIdInput.addEventListener('input', function () {
      clearTimeout(callerIdTimer);
      callerIdTimer = setTimeout(function () {
        var raw = callerIdInput.value.trim();
        chrome.storage.local.set({ gmes_zoom_caller_id: raw });
      }, 400);
    });

    callerIdInput.addEventListener('change', function () {
      clearTimeout(callerIdTimer);
      var raw = callerIdInput.value.trim();
      chrome.storage.local.set({ gmes_zoom_caller_id: raw });
    });
  }

  // ── Custom GHL Domains list ───────────────────────────────────────────────────

  var domainsList = document.getElementById('ghlDomainsList');
  var domainInput = document.getElementById('ghlDomainInput');
  var domainAddBtn = document.getElementById('ghlDomainAddBtn');

  // Normalize a user-typed value to a bare lowercase hostname.
  // Handles inputs with or without a scheme (e.g. "https://crm.agency.com/path" → "crm.agency.com").
  function normalizeHostname(raw) {
    var trimmed = (raw || '').trim().toLowerCase();
    if (!trimmed) return '';
    // Prepend a scheme if missing so URL parsing works
    var withScheme = trimmed.indexOf('://') === -1 ? 'https://' + trimmed : trimmed;
    try {
      return new URL(withScheme).hostname;
    } catch (e) {
      // Fall back to stripping anything after the first slash
      return trimmed.replace(/^[a-z]+:\/\//, '').split('/')[0];
    }
  }

  function renderDomains(domains) {
    if (!domainsList) return;
    if (!Array.isArray(domains) || !domains.length) {
      domainsList.innerHTML = '<div class="exceptions-empty">No custom domains added yet.</div>';
      return;
    }
    domainsList.innerHTML = '';
    domains.forEach(function (hostname) {
      var item = document.createElement('div');
      item.className = 'exception-item';
      item.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" style="flex-shrink:0"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>' +
        '<span class="exception-hostname">' + escapeHtml(hostname) + '</span>' +
        '<button class="exception-remove-btn" data-hostname="' + escapeHtml(hostname) + '" title="Remove domain">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>';
      domainsList.appendChild(item);
    });

    domainsList.querySelectorAll('.exception-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var host = btn.dataset.hostname;
        chrome.storage.local.get(['gmes_ghl_domains'], function (data) {
          var updated = (Array.isArray(data.gmes_ghl_domains) ? data.gmes_ghl_domains : [])
            .filter(function (d) { return d !== host; });
          chrome.storage.local.set({ gmes_ghl_domains: updated }, function () {
            renderDomains(updated);
          });
        });
      });
    });
  }

  function loadDomains() {
    chrome.storage.local.get(['gmes_ghl_domains'], function (data) {
      var domains = Array.isArray(data.gmes_ghl_domains) ? data.gmes_ghl_domains : [];
      renderDomains(domains);
    });
  }

  function addDomain() {
    if (!domainInput) return;
    var hostname = normalizeHostname(domainInput.value);
    if (!hostname) return;

    chrome.storage.local.get(['gmes_ghl_domains'], function (data) {
      var existing = Array.isArray(data.gmes_ghl_domains) ? data.gmes_ghl_domains : [];
      // Dedupe — skip if already in the list
      if (existing.indexOf(hostname) !== -1) {
        domainInput.value = '';
        return;
      }
      var updated = existing.concat([hostname]);
      chrome.storage.local.set({ gmes_ghl_domains: updated }, function () {
        domainInput.value = '';
        renderDomains(updated);
      });
    });
  }

  if (domainAddBtn) {
    domainAddBtn.addEventListener('click', addDomain);
  }

  if (domainInput) {
    domainInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        addDomain();
      }
    });
  }

  // Load the domains list on init so it is ready when the settings panel opens
  loadDomains();

})();
