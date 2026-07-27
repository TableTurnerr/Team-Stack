(function () {
  'use strict';

  var logs = [];
  var sessions = [];
  var activeSessionId = '';
  var els = {};

  function isDevBuild() {
    try {
      var mf = chrome.runtime.getManifest();
      return Boolean(mf && /\(dev\)/i.test(String(mf.name || '')));
    } catch (e) {
      return false;
    }
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function formatTime(ts) {
    if (!ts) return '-';
    try {
      return new Date(Number(ts)).toLocaleString();
    } catch (e) {
      return '-';
    }
  }

  function selectedValues(select) {
    return Array.prototype.slice.call(select.options || [])
      .filter(function (option) { return option.selected; })
      .map(function (option) { return option.value; });
  }

  function sessionIdsForLog(log) {
    var ids = [];
    var details = (log && log.details) || {};
    function add(value) {
      if (value == null || value === '') return;
      var text = String(value);
      if (ids.indexOf(text) === -1) ids.push(text);
    }
    add(log && log.sessionId);
    add(details.sessionId);
    add(details.session_id);
    add(details.scrapingSessionId);
    add(details.activeSessionId);
    if (/^session\./.test(String(log && log.event || ''))) add(details.id);
    return ids;
  }

  function sessionLabel(id) {
    var found = sessions.find(function (session) { return session && String(session.id) === id; });
    var name = found && found.name ? String(found.name) : '';
    var date = found && found.createdAt ? formatTime(found.createdAt) : '';
    var suffix = id === activeSessionId ? ' (active)' : '';
    if (name && date) return name + ' - ' + date + suffix;
    if (name) return name + suffix;
    return id + suffix;
  }

  function classify(event) {
    event = String(event || '').toLowerCase();
    if (event.indexOf('reject') !== -1 || event.indexOf('failed') !== -1 || event.indexOf('removed') !== -1) return 'reject failed';
    if (event.indexOf('accept') !== -1 || event.indexOf('success') !== -1) return 'accept success';
    if (event.indexOf('warn') !== -1) return 'warn';
    return '';
  }

  function downloadText(filename, text) {
    var blob = new Blob([text], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  function loadLogs() {
    chrome.storage.local.get(['gmes_debug_logs', 'gmes_sessions', 'gmes_active_session_id'], function (data) {
      logs = Array.isArray(data.gmes_debug_logs) ? data.gmes_debug_logs.slice() : [];
      sessions = Array.isArray(data.gmes_sessions) ? data.gmes_sessions.slice() : [];
      activeSessionId = data.gmes_active_session_id || '';
      logs.sort(function (a, b) { return (Number(b.ts) || 0) - (Number(a.ts) || 0); });
      renderFilters();
      render();
    });
  }

  function renderFilters() {
    var current = els.eventFilter.value;
    var selectedSessions = selectedValues(els.sessionFilter);
    var seen = {};
    var seenSessions = {};
    logs.forEach(function (log) {
      if (log && log.event) seen[String(log.event)] = true;
      sessionIdsForLog(log).forEach(function (id) { seenSessions[id] = true; });
    });
    sessions.forEach(function (session) {
      if (session && session.id) seenSessions[String(session.id)] = true;
    });
    if (activeSessionId) seenSessions[String(activeSessionId)] = true;
    var events = Object.keys(seen).sort();
    var sessionIds = Object.keys(seenSessions).sort(function (a, b) {
      var aActive = a === activeSessionId ? -1 : 0;
      var bActive = b === activeSessionId ? -1 : 0;
      if (aActive !== bActive) return aActive - bActive;
      return sessionLabel(a).localeCompare(sessionLabel(b));
    });
    els.eventFilter.innerHTML = '<option value="">All events</option>' + events.map(function (event) {
      return '<option value="' + escapeHtml(event) + '">' + escapeHtml(event) + '</option>';
    }).join('');
    if (current && seen[current]) els.eventFilter.value = current;
    els.sessionFilter.innerHTML = sessionIds.map(function (id) {
      return '<option value="' + escapeHtml(id) + '">' + escapeHtml(sessionLabel(id)) + '</option>';
    }).join('');
    Array.prototype.forEach.call(els.sessionFilter.options, function (option) {
      option.selected = selectedSessions.indexOf(option.value) !== -1;
    });
  }

  function filteredLogs() {
    var q = String(els.searchInput.value || '').trim().toLowerCase();
    var event = els.eventFilter.value;
    var sessionIds = selectedValues(els.sessionFilter);
    return logs.filter(function (log) {
      if (event && log.event !== event) return false;
      if (sessionIds.length) {
        var ids = sessionIdsForLog(log);
        if (!ids.some(function (id) { return sessionIds.indexOf(id) !== -1; })) return false;
      }
      if (!q) return true;
      return JSON.stringify(log || {}).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderStats(items) {
    var visible = Array.isArray(items) ? items : logs;
    var accepted = visible.filter(function (log) { return /accepted|success/i.test(log.event || ''); }).length;
    var rejected = visible.filter(function (log) { return /rejected|failed|removed/i.test(log.event || ''); }).length;
    els.totalStat.textContent = String(visible.length);
    els.acceptedStat.textContent = String(accepted);
    els.rejectedStat.textContent = String(rejected);
    els.newestStat.textContent = visible.length ? formatTime(visible[0].ts) : '-';
  }

  function render() {
    var items = filteredLogs();
    renderStats(items);
    if (!items.length) {
      els.logList.innerHTML = '<div class="empty">No debug logs match the current filters.</div>';
      return;
    }
    els.logList.innerHTML = items.map(function (log) {
      var event = escapeHtml(log.event || 'event');
      var details = JSON.stringify(log.details || {}, null, 2);
      return '<article class="log ' + classify(log.event) + '">' +
        '<div class="log-top"><div class="event">' + event + '</div><div class="time">' + escapeHtml(formatTime(log.ts)) + '</div></div>' +
        '<pre>' + escapeHtml(details) + '</pre>' +
        '</article>';
    }).join('');
  }

  function init() {
    if (!isDevBuild()) {
      $('releaseBlock').style.display = 'block';
      $('app').style.display = 'none';
      chrome.storage.local.set({ gmes_debug_enabled: false, gmes_debug_logs: [] });
      return;
    }

    els = {
      searchInput: $('searchInput'),
      eventFilter: $('eventFilter'),
      sessionFilter: $('sessionFilter'),
      clearSessionFilterBtn: $('clearSessionFilterBtn'),
      refreshBtn: $('refreshBtn'),
      exportBtn: $('exportBtn'),
      clearBtn: $('clearBtn'),
      logList: $('logList'),
      totalStat: $('totalStat'),
      acceptedStat: $('acceptedStat'),
      rejectedStat: $('rejectedStat'),
      newestStat: $('newestStat')
    };

    els.searchInput.addEventListener('input', render);
    els.eventFilter.addEventListener('change', render);
    els.sessionFilter.addEventListener('change', render);
    els.clearSessionFilterBtn.addEventListener('click', function () {
      Array.prototype.forEach.call(els.sessionFilter.options, function (option) {
        option.selected = false;
      });
      render();
    });
    els.refreshBtn.addEventListener('click', loadLogs);
    els.exportBtn.addEventListener('click', function () {
      downloadText('tableturner-extension-debug-logs.json', JSON.stringify(logs, null, 2));
    });
    els.clearBtn.addEventListener('click', function () {
      if (!confirm('Clear all debug logs?')) return;
      chrome.storage.local.set({ gmes_debug_logs: [] }, loadLogs);
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && changes.gmes_debug_logs) loadLogs();
    });

    loadLogs();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
