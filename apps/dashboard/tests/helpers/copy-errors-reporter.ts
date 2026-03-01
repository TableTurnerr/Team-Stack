/**
 * copy-errors-reporter.ts
 * Custom Playwright reporter that generates an errors-summary.html file
 * in the playwright-report/ directory with a "Copy All Errors" button.
 *
 * The button copies brief, AI-friendly error summaries for all failed tests
 * so users can paste them into an AI model or share with developers.
 */
import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as fs from 'fs';
import * as path from 'path';

interface FailedTest {
  spec: string;
  title: string;
  error: string;
}

class CopyErrorsReporter implements Reporter {
  private failures: FailedTest[] = [];
  private rootDir = '';

  onBegin(config: FullConfig, _suite: Suite) {
    this.rootDir = config.rootDir;
  }

  onTestEnd(test: TestCase, result: TestResult) {
    if (result.status === 'failed' || result.status === 'timedOut') {
      const spec = path.relative(this.rootDir || process.cwd(), test.location.file);
      const errMsg = this.extractBriefError(result);

      this.failures.push({
        spec,
        title: test.title,
        error: errMsg,
      });
    }
  }

  async onEnd(_result: FullResult) {
    try {
      this.generateHTML();
    } catch (err) {
      console.error('CopyErrorsReporter: Failed to generate errors-summary.html:', err);
    }
  }

  /* ── helpers ─────────────────────────────────────────────────────────── */

  /** Extract a concise, one-line error message from a test result. */
  private extractBriefError(result: TestResult): string {
    if (!result.errors || result.errors.length === 0) {
      return result.status === 'timedOut' ? 'Test timed out' : 'Unknown failure';
    }

    const raw = result.errors[0].message || result.errors[0].stack || '';

    // Take just the first meaningful line (strip ANSI, stack traces)
    const cleaned = raw
      .replace(/\x1b\[[0-9;]*m/g, '') // strip ANSI
      .split('\n')
      .map((l: string) => l.trim())
      .filter(
        (l: string) =>
          l.length > 0 &&
          !l.startsWith('at ') &&
          !l.startsWith('─') &&
          !l.startsWith('|')
      )[0] || 'Unknown error';

    // Cap at 200 chars for brevity
    return cleaned.length > 200 ? cleaned.slice(0, 197) + '...' : cleaned;
  }

  /** Generate the errors-summary.html page. */
  private generateHTML() {
    // Write to playwright-report/ at the project root (process.cwd() is apps/dashboard)
    const outputDir = path.resolve(process.cwd(), 'playwright-report');
    fs.mkdirSync(outputDir, { recursive: true });

    const totalFailed = this.failures.length;
    const timestamp = new Date().toLocaleString();

    // Build the clipboard text
    const clipboardLines = this.failures
      .map(
        (f, i) =>
          `${i + 1}. [${f.spec}] "${f.title}" — ${f.error}`
      )
      .join('\n');

    const clipboardText = totalFailed > 0
      ? `${totalFailed} Playwright test(s) failed (${timestamp}):\n\n${clipboardLines}\n\nPlease analyze and fix these test failures.`
      : 'All tests passed! ✓';

    // Build HTML rows
    const rows = this.failures
      .map(
        (f, i) => `
        <tr>
          <td class="idx">${i + 1}</td>
          <td class="spec">${this.esc(f.spec)}</td>
          <td class="title">${this.esc(f.title)}</td>
          <td class="error">${this.esc(f.error)}</td>
        </tr>`
      )
      .join('');

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Test Errors Summary</title>
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #e6edf3; --muted: #8b949e; --accent: #58a6ff;
      --error: #f85149; --success: #3fb950; --warning: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg); color: var(--text);
      min-height: 100vh; padding: 2rem;
    }
    .container { max-width: 1100px; margin: 0 auto; }
    header {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 1rem; margin-bottom: 1.5rem;
    }
    h1 { font-size: 1.5rem; font-weight: 600; }
    .badge {
      display: inline-flex; align-items: center; gap: .4rem;
      padding: .3rem .8rem; border-radius: 999px; font-size: .85rem; font-weight: 600;
    }
    .badge.fail { background: rgba(248,81,73,.15); color: var(--error); }
    .badge.pass { background: rgba(63,185,80,.15); color: var(--success); }
    .meta { color: var(--muted); font-size: .85rem; margin-bottom: 1.5rem; }
    .copy-btn {
      display: inline-flex; align-items: center; gap: .5rem;
      padding: .65rem 1.3rem; border: 1px solid var(--accent); border-radius: 8px;
      background: rgba(88,166,255,.1); color: var(--accent);
      font-size: .95rem; font-weight: 600; cursor: pointer;
      transition: all .2s ease;
    }
    .copy-btn:hover { background: rgba(88,166,255,.2); transform: translateY(-1px); }
    .copy-btn:active { transform: scale(.97); }
    .copy-btn.copied { border-color: var(--success); color: var(--success); background: rgba(63,185,80,.1); }
    table {
      width: 100%; border-collapse: collapse;
      background: var(--surface); border-radius: 8px; overflow: hidden;
      border: 1px solid var(--border);
    }
    th, td { padding: .7rem .9rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: rgba(110,118,129,.1); color: var(--muted); font-size: .8rem; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }
    td { font-size: .88rem; vertical-align: top; }
    td.idx { color: var(--muted); width: 2.5rem; text-align: center; }
    td.spec { color: var(--accent); max-width: 220px; word-break: break-all; font-family: monospace; font-size: .82rem; }
    td.title { font-weight: 500; max-width: 280px; }
    td.error { color: var(--error); font-family: monospace; font-size: .82rem; max-width: 400px; word-break: break-word; }
    tr:last-child td { border-bottom: none; }
    tr:hover { background: rgba(110,118,129,.06); }
    .empty {
      text-align: center; padding: 4rem 2rem;
      color: var(--success); font-size: 1.2rem;
    }
    .empty svg { width: 48px; height: 48px; margin-bottom: 1rem; }
    .report-link { margin-top: 1.5rem; text-align: center; }
    .report-link a { color: var(--accent); text-decoration: none; font-size: .9rem; }
    .report-link a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div>
        <h1>Test Errors Summary</h1>
        <p class="meta">${timestamp} &nbsp;&middot;&nbsp;
          <span class="badge ${totalFailed > 0 ? 'fail' : 'pass'}">
            ${totalFailed > 0 ? '&#10007; ' + totalFailed + ' failed' : '&#10003; All passed'}
          </span>
        </p>
      </div>
      ${totalFailed > 0 ? `<button class="copy-btn" onclick="copyErrors()" id="copyBtn">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"></path><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"></path></svg>
        Copy All Errors
      </button>` : ''}
    </header>

    ${totalFailed > 0 ? `
    <table>
      <thead><tr><th>#</th><th>Spec File</th><th>Test Name</th><th>Error</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>` : `
    <div class="empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
      <p>All tests passed! No errors to report.</p>
    </div>`}

    <div class="report-link">
      <a href="./index.html">&larr; Back to full Playwright report</a>
    </div>
  </div>

  <script>
    var errorText = ${JSON.stringify(clipboardText)};

    function copyErrors() {
      var btn = document.getElementById('copyBtn');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(errorText).then(function() {
          btn.classList.add('copied');
          btn.textContent = '\\u2713 Copied!';
          setTimeout(function() {
            btn.classList.remove('copied');
            btn.textContent = '\\ud83d\\udccb Copy All Errors';
          }, 2500);
        }).catch(fallbackCopy);
      } else {
        fallbackCopy();
      }
    }

    function fallbackCopy() {
      var btn = document.getElementById('copyBtn');
      var ta = document.createElement('textarea');
      ta.value = errorText;
      ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      btn.textContent = '\\u2713 Copied!';
      setTimeout(function() { btn.textContent = '\\ud83d\\udccb Copy All Errors'; }, 2500);
    }
  </script>
</body>
</html>`;

    const outPath = path.join(outputDir, 'errors-summary.html');
    fs.writeFileSync(outPath, html, 'utf8');

    if (totalFailed > 0) {
      console.log(
        `\n📋 Errors summary: ${outPath}\n   ${totalFailed} failed test(s) — open in browser to copy all errors.\n`
      );
    } else {
      console.log(`\n✅ All tests passed! Errors summary: ${outPath}\n`);
    }

    // Inject floating button into Playwright's index.html
    const indexHtmlPath = path.join(outputDir, 'index.html');
    if (fs.existsSync(indexHtmlPath)) {
      let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
      if (!indexHtml.includes('<!-- COPY_ERRORS_BTN -->')) {
        const floatingBtn = `
<!-- COPY_ERRORS_BTN -->
<div style="position:fixed;bottom:20px;right:20px;z-index:99999;">
  <a href="./errors-summary.html" style="background:#58a6ff;color:#fff;padding:10px 15px;border-radius:8px;text-decoration:none;font-family:sans-serif;font-weight:bold;box-shadow:0 4px 6px rgba(0,0,0,0.3);font-size:14px;">📋 Copy All Errors</a>
</div>
        `;
        indexHtml = indexHtml.replace('</body>', `${floatingBtn}\n</body>`);
        fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');
      }
    }
  }

  /** Escape HTML entities. */
  private esc(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export default CopyErrorsReporter;
