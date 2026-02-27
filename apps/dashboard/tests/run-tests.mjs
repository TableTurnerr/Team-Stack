#!/usr/bin/env node
/**
 * run-tests.mjs
 * Interactive CLI menu for the CRM Dashboard Playwright test suite.
 * Run with:  node tests/run-tests.mjs
 *        or: pnpm test:menu
 */

import { createInterface } from 'readline';
import { spawn }           from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath }   from 'url';

const __dir = dirname(fileURLToPath(import.meta.url));
const ROOT  = resolve(__dir, '..'); // apps/dashboard/

// ─── ANSI colours ─────────────────────────────────────────────────────────────
const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  // text
  white:   '\x1b[97m',
  gray:    '\x1b[90m',
  cyan:    '\x1b[96m',
  green:   '\x1b[92m',
  yellow:  '\x1b[93m',
  red:     '\x1b[91m',
  blue:    '\x1b[94m',
  magenta: '\x1b[95m',
  // bg
  bgDark:  '\x1b[48;5;235m',
  bgBlue:  '\x1b[48;5;17m',
};

const W = 62; // box width

// ─── Drawing helpers ──────────────────────────────────────────────────────────

const pad  = (s, n) => s + ' '.repeat(Math.max(0, n - stripAnsi(s).length));
const line = (char = '─', w = W) => char.repeat(w);

function stripAnsi(str) {
  return String(str).replace(/\x1b\[[0-9;]*m/g, '');
}

function box(title, rows, footer) {
  const inner = W - 2;
  const lines = [];

  lines.push(`${C.blue}╔${line('═', inner)}╗${C.reset}`);

  if (title) {
    const t    = `${C.bold}${C.white} ${title} ${C.reset}`;
    const tLen = stripAnsi(t);
    const pad1 = Math.floor((inner - tLen.length + 2) / 2); // +2 for the spaces
    const pad2 = inner - tLen.length + 2 - pad1;
    lines.push(`${C.blue}║${C.reset}${' '.repeat(pad1)}${t}${' '.repeat(pad2)}${C.blue}║${C.reset}`);
    lines.push(`${C.blue}╠${line('═', inner)}╣${C.reset}`);
  }

  for (const row of rows) {
    if (row === null) {
      lines.push(`${C.blue}╠${line('─', inner)}╣${C.reset}`);
    } else {
      const content = ` ${row} `;
      const bare    = stripAnsi(content);
      const padding = inner - bare.length;
      lines.push(`${C.blue}║${C.reset}${content}${' '.repeat(Math.max(0, padding))}${C.blue}║${C.reset}`);
    }
  }

  if (footer) {
    lines.push(`${C.blue}╠${line('─', inner)}╣${C.reset}`);
    const f    = ` ${footer} `;
    const fLen = stripAnsi(f);
    lines.push(`${C.blue}║${C.reset}${f}${' '.repeat(Math.max(0, inner - fLen.length))}${C.blue}║${C.reset}`);
  }

  lines.push(`${C.blue}╚${line('═', inner)}╝${C.reset}`);
  return lines.join('\n');
}

function label(key, text, hint = '') {
  const k    = `${C.bgBlue}${C.white}${C.bold} ${key} ${C.reset}`;
  const t    = `${C.white}${text}${C.reset}`;
  const h    = hint ? `  ${C.dim}${hint}${C.reset}` : '';
  return `${k} ${t}${h}`;
}

function sectionHeader(text) {
  return `${C.yellow}${C.bold}${text}${C.reset}`;
}

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[H');
}

// ─── Env / config reader ──────────────────────────────────────────────────────

function readEnvTest() {
  const envPath = resolve(ROOT, '.env.test');
  if (!existsSync(envPath)) return {};
  const raw = readFileSync(envPath, 'utf8');
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    result[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return result;
}

function envStatus() {
  const env     = readEnvTest();
  const envPath = resolve(ROOT, '.env.test');
  const hasFile = existsSync(envPath);

  const check = (val) => val && val !== 'your_admin@example.com' && val !== 'your_password_here'
    ? `${C.green}✓${C.reset}`
    : `${C.red}✗${C.reset}`;

  return {
    hasFile,
    email:        env.TEST_USER_EMAIL,
    pbAdmin:      env.TEST_PB_ADMIN_EMAIL,
    pbUrl:        env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090',
    liveCalls:    env.TEST_LIVE_CALLS === 'true',
    callDuration: env.TEST_CALL_DURATION_SEC || '10',
    emailOk:      hasFile && check(env.TEST_USER_EMAIL),
    pbOk:         hasFile && check(env.TEST_PB_ADMIN_EMAIL),
  };
}

// ─── Playwright runner ────────────────────────────────────────────────────────

const PW = 'pnpm exec playwright';

/**
 * Ask the OS for a free TCP port by binding to port 0, then release it.
 * Returns the port number so Playwright and Next.js can use the same one.
 */
async function getFreePort() {
  const { createServer } = await import('net');
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Spawn a playwright command, streaming output live to the terminal.
 * Returns the exit code when done.
 */
async function runCommand(args, { cwd = ROOT, env = {} } = {}) {
  const port = await getFreePort();

  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const shell = isWin ? 'cmd' : '/bin/bash';
    const flag  = isWin ? '/c' : '-c';
    const cmd   = `${PW} test ${args}`.trim();

    console.log(`\n${C.dim}▶ ${cmd}${C.reset}\n`);

    const child = spawn(shell, [flag, cmd], {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, TEST_PORT: String(port), ...env },
    });

    child.on('error', (err) => {
      console.error(`\n${C.red}Failed to start test runner: ${err.message}${C.reset}`);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}

async function openReport() {
  const isWin = process.platform === 'win32';
  const shell = isWin ? 'cmd' : '/bin/bash';
  const flag  = isWin ? '/c' : '-c';
  const child = spawn(shell, [flag, `${PW} show-report`], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  child.on('close', () => {});
}

// ─── PocketBase cleanup ───────────────────────────────────────────────────────

async function runCleanup() {
  const env    = readEnvTest();
  const pbUrl  = env.NEXT_PUBLIC_POCKETBASE_URL || 'http://localhost:8090';
  const email  = env.TEST_PB_ADMIN_EMAIL;
  const passwd = env.TEST_PB_ADMIN_PASSWORD;

  if (!email || !passwd) {
    console.log(`\n${C.red}✗ TEST_PB_ADMIN_EMAIL / TEST_PB_ADMIN_PASSWORD not set in .env.test${C.reset}`);
    return;
  }

  console.log(`\n${C.cyan}Connecting to PocketBase at ${pbUrl}...${C.reset}`);

  // Inline PocketBase cleanup without importing the SDK
  // (avoids module resolution issues in .mjs context)
  const cleanupScript = `
import PocketBase from '${resolve(ROOT, 'node_modules/pocketbase/dist/pocketbase.es.mjs').replace(/\\/g, '/')}';

const pb = new PocketBase('${pbUrl}');
await pb.admins.authWithPassword('${email}', '${passwd}');

const PREFIX = 'TEST_PW_';

const targets = [
  { col: 'call_logs',              field: 'post_call_notes' },
  { col: 'follow_ups',             field: 'notes'           },
  { col: 'recordings',             field: 'note'            },
  { col: 'cold_calling_sessions',  field: 'session_notes'   },
  { col: 'phone_numbers',          field: 'receptionist_name' },
  { col: 'companies',              field: 'company_name'    },
  { col: 'notes',                  field: 'title'           },
];

let total = 0;
for (const { col, field } of targets) {
  try {
    const records = await pb.collection(col).getFullList({
      filter: \`\${field} ~ '\${PREFIX}'\`,
      fields: 'id',
    });
    for (const r of records) {
      await pb.collection(col).delete(r.id);
    }
    if (records.length) console.log(\`  Deleted \${records.length} from \${col}\`);
    total += records.length;
  } catch(e) {
    if (e?.status !== 404) console.warn(\`  Skipped \${col}: \${e?.message}\`);
  }
}
console.log(\`\\nTotal deleted: \${total} test records.\`);
`;

  const tmpFile = resolve(ROOT, 'tests/.cleanup-tmp.mjs');
  const { writeFileSync, unlinkSync } = await import('fs');
  writeFileSync(tmpFile, cleanupScript);

  await new Promise((res) => {
    const child = spawn(process.execPath, ['--input-type=module'], {
      cwd: ROOT,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    child.stdin.write(cleanupScript);
    child.stdin.end();
    child.on('close', res);
  });
}

// ─── Pause helper ─────────────────────────────────────────────────────────────

async function pause(rl) {
  return new Promise((resolve) => {
    process.stdout.write(`\n${C.dim}Press Enter to return to the menu...${C.reset} `);
    rl.once('line', resolve);
  });
}

async function ask(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// ─── SCREENS ─────────────────────────────────────────────────────────────────

const SUITES = [
  { key: '1',  file: 'tests/01-auth.spec.ts',            label: 'Authentication',              tag: '@smoke' },
  { key: '2',  file: 'tests/02-overview.spec.ts',         label: 'Overview / Dashboard',        tag: '@smoke' },
  { key: '3',  file: 'tests/03-companies.spec.ts',        label: 'Companies (CRUD + inline edit)'             },
  { key: '4',  file: 'tests/04-cold-calls.spec.ts',       label: 'Cold Calls + Phone Numbers'                 },
  { key: '5',  file: 'tests/05-session.spec.ts',          label: 'Session (lifecycle + dialer)'               },
  { key: '6',  file: 'tests/06-session-logs.spec.ts',     label: 'Session Logs'                               },
  { key: '7',  file: 'tests/07-notes.spec.ts',            label: 'Notes (CRUD + archive/delete)'              },
  { key: '8',  file: 'tests/08-actors-team-goals.spec.ts',label: 'Actors / Team / Goals'                      },
  { key: '9',  file: 'tests/09-recordings.spec.ts',       label: 'Recordings'                                 },
  { key: '10', file: 'tests/10-settings.spec.ts',         label: 'Settings (all 8 sections)'                  },
  { key: '11', file: 'tests/11-integration.spec.ts',      label: 'Integration (cross-component)'              },
  { key: '12', file: 'tests/12-live-call-flow.spec.ts',   label: 'Live Call Flow',              live: true    },
];

function drawMain() {
  const st  = envStatus();
  const now = new Date().toLocaleTimeString();
  const envOk   = st.hasFile;
  const envBadge = envOk
    ? `${C.green}✓ .env.test found${C.reset}`
    : `${C.red}✗ .env.test missing — run Setup first${C.reset}`;

  const rows = [
    `${C.dim}${now}  ${envBadge}${C.reset}`,
    null,
    sectionHeader('  QUICK RUN'),
    label('1', 'All Tests',                    '~8–15 min'),
    label('2', 'Smoke Tests Only',             '~2 min · @smoke tag'),
    label('3', 'Specific Suite…',              'pick one file'),
    null,
    sectionHeader('  MODES'),
    label('4', 'Headed Mode',                  'visible browser'),
    label('5', 'Interactive UI Mode',          'Playwright GUI'),
    label('6', 'Live Call Tests',              st.liveCalls
      ? `${C.green}enabled${C.reset}` : `${C.gray}disabled — toggle in Config${C.reset}`),
    null,
    sectionHeader('  REPORTS & TOOLS'),
    label('7', 'View Last HTML Report'),
    label('8', 'Clean Up TEST_PW_ Data',       'removes test entries from DB'),
    label('9', 'Configuration',                '.env.test values'),
    label('0', 'First-Time Setup',             'env file + browser install'),
    null,
    label('Q', 'Quit'),
  ];

  console.log(box('  CRM Dashboard · Test Runner', rows));
  process.stdout.write(`\n${C.bold}${C.white}Select: ${C.reset}`);
}

function drawSuiteMenu() {
  const rows = [
    sectionHeader('  SELECT TEST SUITE'),
    null,
    ...SUITES.map((s) => {
      const liveBadge = s.live ? `  ${C.yellow}⚡ live calls${C.reset}` : '';
      return label(s.key.padStart(2), s.label) + liveBadge;
    }),
    null,
    label(' B', 'Back to main menu'),
  ];

  clearScreen();
  console.log(box('  Choose a Suite', rows));
  process.stdout.write(`\n${C.bold}${C.white}Select: ${C.reset}`);
}

function drawConfig() {
  const st  = envStatus();
  const yes = `${C.green}Yes${C.reset}`;
  const no  = `${C.red}No${C.reset}`;

  const mask = (v) => v ? v.replace(/.(?=.{4})/g, '•') : `${C.red}(not set)${C.reset}`;

  const rows = [
    sectionHeader('  .env.test'),
    ` File exists:       ${st.hasFile ? yes : no}`,
    ` User email:        ${C.cyan}${st.email || `${C.red}(not set)`}${C.reset}`,
    ` PB admin email:    ${C.cyan}${st.pbAdmin || `${C.red}(not set)`}${C.reset}`,
    ` PocketBase URL:    ${C.cyan}${st.pbUrl}${C.reset}`,
    null,
    sectionHeader('  LIVE CALLS'),
    ` Enabled:           ${st.liveCalls ? yes : no}`,
    ` Call duration:     ${C.cyan}${st.callDuration}s${C.reset}`,
    null,
    sectionHeader('  AUTH CACHE'),
    ` Auth state file:   ${existsSync(resolve(__dir, '.auth/user.json'))
        ? `${C.green}exists (cached)${C.reset}`
        : `${C.yellow}not yet created${C.reset}`}`,
    null,
    ` Edit: ${C.dim}${resolve(ROOT, '.env.test')}${C.reset}`,
  ];

  clearScreen();
  console.log(box('  Configuration', rows));
}

async function drawSetup(rl) {
  clearScreen();
  const envSrc  = resolve(ROOT, '.env.test.example');
  const envDest = resolve(ROOT, '.env.test');
  const { copyFileSync } = await import('fs');

  const rows = [
    sectionHeader('  FIRST-TIME SETUP'),
    null,
    label('1', 'Copy .env.test.example → .env.test'),
    label('2', 'Install Playwright browser (Chromium)'),
    label('3', 'Do both'),
    null,
    label('B', 'Back'),
  ];

  console.log(box('  Setup', rows));
  process.stdout.write(`\n${C.bold}${C.white}Select: ${C.reset}`);

  const choice = (await ask(rl, '')).trim().toLowerCase();

  if (choice === '1' || choice === '3') {
    if (!existsSync(envDest)) {
      copyFileSync(envSrc, envDest);
      console.log(`\n${C.green}✓ Created .env.test — open it and fill in your credentials.${C.reset}`);
    } else {
      console.log(`\n${C.yellow}.env.test already exists — not overwritten.${C.reset}`);
    }
  }

  if (choice === '2' || choice === '3') {
    console.log(`\n${C.cyan}Installing Playwright Chromium browser...${C.reset}\n`);
    await new Promise((res) => {
      const isWin = process.platform === 'win32';
      const child = spawn(isWin ? 'cmd' : '/bin/bash',
        [isWin ? '/c' : '-c', 'npx playwright install chromium'],
        { cwd: ROOT, stdio: 'inherit' });
      child.on('close', res);
    });
  }
}

// ─── MAIN LOOP ────────────────────────────────────────────────────────────────

async function main() {
  const rl = createInterface({
    input:  process.stdin,
    output: process.stdout,
    terminal: !!process.stdout.isTTY,
  });

  // Ensure clean exit on Ctrl+C
  rl.on('close', () => {
    console.log(`\n${C.dim}Goodbye.${C.reset}\n`);
    process.exit(0);
  });

  let running = true;

  while (running) {
    clearScreen();
    drawMain();

    const choice = (await ask(rl, '')).trim().toLowerCase();

    switch (choice) {
      // ── All Tests ──────────────────────────────────────────────────────────
      case '1': {
        clearScreen();
        const code = await runCommand('');
        console.log(code === 0
          ? `\n${C.green}${C.bold}✓ All tests passed.${C.reset}`
          : `\n${C.red}${C.bold}✗ Some tests failed (exit ${code}).${C.reset}`);
        await pause(rl);
        break;
      }

      // ── Smoke Tests ────────────────────────────────────────────────────────
      case '2': {
        clearScreen();
        const code = await runCommand('--grep @smoke');
        console.log(code === 0
          ? `\n${C.green}${C.bold}✓ Smoke tests passed.${C.reset}`
          : `\n${C.red}${C.bold}✗ Smoke tests failed.${C.reset}`);
        await pause(rl);
        break;
      }

      // ── Specific Suite ─────────────────────────────────────────────────────
      case '3': {
        let inSuite = true;
        while (inSuite) {
          drawSuiteMenu();
          const sc = (await ask(rl, '')).trim().toLowerCase();

          if (sc === 'b' || sc === '') { inSuite = false; break; }

          const suite = SUITES.find((s) => s.key === sc);
          if (!suite) { console.log(`${C.red}Unknown option.${C.reset}`); continue; }

          // Warn for live tests
          if (suite.live) {
            const st = envStatus();
            if (!st.liveCalls) {
              clearScreen();
              console.log(`\n${C.yellow}⚠  Live call tests are disabled.${C.reset}`);
              console.log(`   Set ${C.cyan}TEST_LIVE_CALLS=true${C.reset} in .env.test to enable them.\n`);
              await pause(rl);
              continue;
            }
          }

          clearScreen();
          console.log(`\n${C.cyan}${C.bold}Running: ${suite.label}${C.reset}\n`);

          // Ask for headed mode
          process.stdout.write(`Run ${C.yellow}headed${C.reset} (visible browser)? [y/N]: `);
          const headed = (await ask(rl, '')).trim().toLowerCase();
          clearScreen();

          const extraFlags = headed === 'y' ? '--headed' : '';
          const liveEnv    = suite.live ? { TEST_LIVE_CALLS: 'true' } : {};
          const code = await runCommand(`${suite.file} ${extraFlags}`.trim(), { env: liveEnv });

          console.log(code === 0
            ? `\n${C.green}✓ ${suite.label} passed.${C.reset}`
            : `\n${C.red}✗ ${suite.label} failed (exit ${code}).${C.reset}`);
          await pause(rl);
          inSuite = false;
        }
        break;
      }

      // ── Headed Mode ────────────────────────────────────────────────────────
      case '4': {
        clearScreen();
        const code = await runCommand('--headed');
        console.log(code === 0
          ? `\n${C.green}✓ Headed run complete.${C.reset}`
          : `\n${C.red}✗ Run finished with failures.${C.reset}`);
        await pause(rl);
        break;
      }

      // ── Interactive UI ─────────────────────────────────────────────────────
      case '5': {
        clearScreen();
        console.log(`\n${C.cyan}Opening Playwright UI...${C.reset}`);
        console.log(`${C.dim}Close the Playwright UI window to return to this menu.${C.reset}\n`);
        await runCommand('--ui');
        await pause(rl);
        break;
      }

      // ── Live Call Tests ────────────────────────────────────────────────────
      case '6': {
        const st = envStatus();
        clearScreen();

        if (!st.liveCalls) {
          console.log(`\n${C.yellow}⚠  Live call tests are currently DISABLED.${C.reset}`);
          console.log(`   Set ${C.cyan}TEST_LIVE_CALLS=true${C.reset} in .env.test and re-run.\n`);
          console.log(` .env.test location: ${C.dim}${resolve(ROOT, '.env.test')}${C.reset}\n`);
          await pause(rl);
          break;
        }

        console.log(`\n${C.yellow}${C.bold}⚡ LIVE CALL TESTS${C.reset}`);
        console.log(` This will dial ${C.bold}5 real phone numbers${C.reset} using Zoom Phone.`);
        console.log(` Make sure Zoom desktop app is running and logged in.\n`);
        console.log(` Numbers to be called:`);
        console.log(`   • 1 (804) 222-1111  Richmond, VA  — All-in-One echo/DTMF`);
        console.log(`   • 1 (909) 390-0003  Ontario, CA   — Instant audio echo`);
        console.log(`   • 1 (800) 444-4444  Toll-Free     — Caller ID readback`);
        console.log(`   • 1 (631) 791-8378  New York, NY  — CallCentric audio test`);
        console.log(`   • 1 (206) 456-0649  Seattle, WA   — IPKall echo + music`);
        console.log(`\n   Call duration: ${C.cyan}${st.callDuration}s${C.reset} each`);

        process.stdout.write(`\n${C.red}Proceed? [y/N]: ${C.reset}`);
        const confirm = (await ask(rl, '')).trim().toLowerCase();

        if (confirm === 'y') {
          clearScreen();
          const code = await runCommand(
            'tests/12-live-call-flow.spec.ts --headed',
            { env: { TEST_LIVE_CALLS: 'true' } }
          );
          console.log(code === 0
            ? `\n${C.green}✓ Live call tests passed.${C.reset}`
            : `\n${C.red}✗ Live call tests finished with failures.${C.reset}`);
          await pause(rl);
        }
        break;
      }

      // ── HTML Report ────────────────────────────────────────────────────────
      case '7': {
        const reportDir = resolve(ROOT, 'playwright-report');
        if (!existsSync(reportDir)) {
          console.log(`\n${C.yellow}No report found yet. Run tests first.${C.reset}\n`);
          await pause(rl);
          break;
        }
        clearScreen();
        console.log(`\n${C.cyan}Opening HTML report in browser...${C.reset}`);
        console.log(`${C.dim}Ctrl+C here when done viewing.${C.reset}\n`);
        await openReport();
        await pause(rl);
        break;
      }

      // ── Cleanup ────────────────────────────────────────────────────────────
      case '8': {
        clearScreen();
        console.log(`\n${C.yellow}${C.bold}Clean Up TEST_PW_ Records${C.reset}`);
        console.log(` This deletes all test entries prefixed with ${C.cyan}TEST_PW_${C.reset}`);
        console.log(` from: companies, phone_numbers, call_logs, sessions, notes,`);
        console.log(`        recordings, follow_ups\n`);
        process.stdout.write(`${C.red}Proceed? [y/N]: ${C.reset}`);
        const confirm = (await ask(rl, '')).trim().toLowerCase();
        if (confirm === 'y') {
          await runCleanup();
        }
        await pause(rl);
        break;
      }

      // ── Configuration ──────────────────────────────────────────────────────
      case '9': {
        drawConfig();
        await pause(rl);
        break;
      }

      // ── Setup ──────────────────────────────────────────────────────────────
      case '0': {
        await drawSetup(rl);
        await pause(rl);
        break;
      }

      // ── Quit ───────────────────────────────────────────────────────────────
      case 'q':
      case 'exit':
      case 'quit': {
        running = false;
        break;
      }

      default: {
        // Unknown input — just redraw
        break;
      }
    }
  }

  rl.close();
  console.log(`\n${C.dim}Goodbye.${C.reset}\n`);
}

main().catch((err) => {
  console.error(`\n${C.red}Fatal error:${C.reset}`, err);
  process.exit(1);
});
