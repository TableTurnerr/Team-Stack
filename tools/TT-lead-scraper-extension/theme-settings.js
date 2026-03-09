(function () {
  'use strict';

  // ── Dark mode ───────────────────────────────────────
  var themeToggleBtn = document.getElementById('themeToggleBtn');
  var darkModeToggle = document.getElementById('darkModeToggle');
  var sunIcon = document.getElementById('themeIconSun');
  var moonIcon = document.getElementById('themeIconMoon');

  function applyTheme(dark) {
    if (dark) {
      document.body.setAttribute('data-theme', 'dark');
      sunIcon.style.display = 'block';
      moonIcon.style.display = 'none';
      darkModeToggle.classList.add('on');
      darkModeToggle.querySelector('.pill-text').textContent = 'ON';
    } else {
      document.body.removeAttribute('data-theme');
      sunIcon.style.display = 'none';
      moonIcon.style.display = 'block';
      darkModeToggle.classList.remove('on');
      darkModeToggle.querySelector('.pill-text').textContent = 'OFF';
    }
  }

  chrome.storage.local.get(['gmes_dark_mode'], function (data) {
    applyTheme(data.gmes_dark_mode === true);
  });

  function toggleTheme() {
    var isDark = document.body.getAttribute('data-theme') === 'dark';
    var newDark = !isDark;
    chrome.storage.local.set({ gmes_dark_mode: newDark });
    applyTheme(newDark);
  }

  themeToggleBtn.addEventListener('click', toggleTheme);
  darkModeToggle.addEventListener('click', toggleTheme);

  // ── Settings panel toggle ────────────────────────────
  var settingsToggleBtn = document.getElementById('settingsToggleBtn');
  var settingsContent = document.getElementById('settingsContent');

  settingsToggleBtn.addEventListener('click', function () {
    var open = settingsContent.classList.toggle('open');
    settingsToggleBtn.classList.toggle('open', open);
    if (open) loadExceptions();
  });

  // ── Exceptions management ────────────────────────────
  var exceptionsList = document.getElementById('exceptionsList');
  var exceptionsActions = document.getElementById('exceptionsActions');
  var clearExceptionsBtn = document.getElementById('clearExceptionsBtn');

  function loadExceptions() {
    chrome.storage.local.get(['gmes_exception_sites'], function (data) {
      var sites = Array.isArray(data.gmes_exception_sites) ? data.gmes_exception_sites : [];
      renderExceptions(sites);
    });
  }

  function renderExceptions(sites) {
    if (!sites.length) {
      exceptionsList.innerHTML = '<div class="exceptions-empty">No exceptions added yet.<br><small style="color:var(--text-muted)">Click the shield icon (🛡) in any page overlay to add a site.</small></div>';
      exceptionsActions.style.display = 'none';
      return;
    }
    exceptionsActions.style.display = 'block';
    exceptionsList.innerHTML = '';
    sites.forEach(function (hostname) {
      var item = document.createElement('div');
      item.className = 'exception-item';
      item.innerHTML =
        '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="2" style="flex-shrink:0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>' +
        '<span class="exception-hostname">' + escapeHtml(hostname) + '</span>' +
        '<button class="exception-remove-btn" data-hostname="' + escapeHtml(hostname) + '" title="Remove exception">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
        '</button>';
      exceptionsList.appendChild(item);
    });

    exceptionsList.querySelectorAll('.exception-remove-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var host = btn.dataset.hostname;
        chrome.storage.local.get(['gmes_exception_sites'], function (data) {
          var updated = (data.gmes_exception_sites || []).filter(function (s) { return s !== host; });
          chrome.storage.local.set({ gmes_exception_sites: updated }, function () {
            renderExceptions(updated);
          });
        });
      });
    });
  }

  clearExceptionsBtn.addEventListener('click', function () {
    if (confirm('Clear all exception sites?')) {
      chrome.storage.local.set({ gmes_exception_sites: [] }, function () {
        renderExceptions([]);
      });
    }
  });

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Advanced toggle chevron animation
  var crmAdvancedToggle = document.getElementById('crmAdvancedToggle');
  if (crmAdvancedToggle) {
    crmAdvancedToggle.addEventListener('click', function () {
      this.classList.toggle('open');
    });
  }
})();
