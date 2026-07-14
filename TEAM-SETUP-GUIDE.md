# 📞 Team Setup Guide — Cold Calling Tools

**Who this is for:** every sales rep. No technical skills needed — just follow the steps in order and you'll be ready to call in about 10 minutes.

**What you're installing (2 things):**
1. **CRM Agent** — a tiny app that sits in your system tray (bottom-right of your screen, near the clock). It detects your Zoom Phone calls and records them automatically.
2. **Lead Scraper extension** — a Chrome extension that supercharges GoHighLevel and detects calls made from the Zoom web page.

**What your admin should have sent you:** a folder (or zip) containing:
- `Setup-CRM-Agent-<YourName>.bat` ← made just for you, has your personal settings inside
- The Tool Manager installer files
- A link to this guide

> ⚠️ If you don't have your personal `Setup-CRM-Agent-<YourName>.bat` file, stop and ask your admin (Hashaam) for it first. Don't use someone else's file — your calls would be logged under their name.

---

## Part 1 — Install the Tool Manager (3 clicks)

1. **Unzip** the folder your admin sent you (right-click the zip → **Extract All…** → **Extract**).
2. Open the extracted folder and **double-click `install.bat`**.
3. 🛡️ **If Windows shows a blue "Windows protected your PC" screen:** click **More info**, then **Run anyway**. This is expected — our tools are made in-house and Windows doesn't recognize the publisher yet.
4. A window will open and install everything, then close by itself. You'll see a new **Tool Manager** icon in your system tray.

✅ **Check:** click the small `^` arrow near your clock — you should see the Tool Manager icon.

---

## Part 2 — Run YOUR personal setup file (1 click)

There are two ways to do this — **either one works**:

**Option A — the popup (easiest).** If a window titled **"CRM Agent Setup"** appears saying the agent needs your setup file:
1. Click **Select my setup file…**.
2. In the file picker, find and click **`Setup-CRM-Agent-<YourName>.bat`** (check your Downloads folder or wherever you saved the file your admin sent), then click **Open**.
3. Wait for the **"All set!"** message. Done.

> The popup appears automatically (shortly after the Tool Manager starts or updates) whenever the CRM Agent isn't set up yet. If you closed it with "Remind me later", you can reopen it any time: right-click the **Tool Manager** tray icon → **Set Up CRM Agent…**

**Option B — double-click the file.**
1. **Double-click `Setup-CRM-Agent-<YourName>.bat`** (the one with *your* name).
2. If Windows warns you: **More info → Run anyway**.
3. Wait for the big **SUCCESS** message, then press any key to close it.

This step tells the CRM Agent who you are, so your calls and recordings are credited to you.

✅ **Check:** look in your system tray (click `^`). You should see a **lightning-bolt dot icon** — that's the CRM Agent. Gray is normal when you're not on a call.

> 💡 **Tip:** drag the lightning icon out of the `^` menu onto the visible tray bar so you can always see it.

---

## Part 3 — Install the Chrome extension (one-time, ~2 minutes)

This part looks technical but it's just clicking. Go slowly:

1. Open **Chrome**.
2. In the address bar, type exactly: `chrome://extensions` and press **Enter**.
3. In the **top-right corner**, turn ON the switch that says **Developer mode**.
4. Three new buttons appear in the top-left. Click **Load unpacked**.
5. A folder picker opens. Paste this into the address bar at the top of the picker and press Enter:
   `%LocalAppData%\TableTurnerr\ToolManager\tools\lead-scraper`
6. Click **Select Folder**.
7. The **Lead Scraper** extension appears in your list. Make sure its switch is **ON** (blue).
8. Click the puzzle-piece 🧩 icon next to Chrome's address bar, find **Lead Scraper**, and click the **pin 📌** so it's always visible.

✅ **Check:** you can see the Lead Scraper icon next to Chrome's address bar.

---

## Part 4 — Connect GoHighLevel (1 minute)

1. Click the **Lead Scraper icon** in Chrome.
2. Click **Connect GoHighLevel** and log in with your usual GHL account.
3. Done — the extension now works inside GHL automatically.

---

## Part 5 — Make sure everything works (do this once)

1. Open the CRM dashboard in Chrome and go to the **Session** page.
2. Look for the **green checkmark** that says the agent is connected. If instead you see **"Click to launch"**, click it — the agent will start.
3. Make **one short test call** on Zoom Phone (call a teammate).
4. During the call, the tray lightning icon turns **green**. After you hang up, right-click the lightning icon — you should see **"Uploads: 0 pending"** after a minute or two. That means the recording was delivered. 🎉

---

## Updates — mostly automatic

- The **CRM Agent and Tool Manager update themselves.** You don't need to do anything.
- The **Chrome extension** updates its files automatically, but Chrome needs one click from you: when your admin announces an extension update, go to `chrome://extensions` and click the **circular reload arrow ↻** on the Lead Scraper card. That's it.

---

## ⚠️ Troubleshooting — read this before asking for help

| What you see | What it means | What to do |
|---|---|---|
| No lightning icon in the tray | The agent isn't running | Press the Windows key, type **Local CRM Agent**, press Enter. |
| Tray says **"Uploads paused — server offline, retrying automatically"** | Our home server is temporarily down | **Nothing! Keep calling.** Your recordings are saved on your PC and upload themselves later. Nothing is ever lost. |
| Tray says **"Uploading via cloud relay"** | Home server is down, cloud backup is catching your uploads | Nothing — this is the system working as designed. |
| Dashboard shows an **amber banner: "CRM server unreachable — calls are being saved locally"** | Same as above, seen from the dashboard | **Keep calling.** Your saved calls are queued on your PC and sync automatically when the server is back. |
| Dashboard shows **"Syncing N queued calls…"** | The server just came back | Nothing — wait for the green "All queued calls synced". |
| A call recording didn't show up in GHL | It may still be uploading or waiting for the server | Right-click the lightning icon and check "Uploads: N pending". If it stays stuck for a whole day, tell your admin. |
| Zoom **web** calls aren't being recorded | The agent must run at least once before the extension can talk to it | Make sure the lightning icon is in your tray, then restart Chrome. |
| "Windows protected your PC" blue screen | Normal for our in-house tools | **More info → Run anyway**. |
| Extension disappeared from Chrome | Chrome sometimes disables developer extensions | Go to `chrome://extensions`, turn the Lead Scraper switch back **ON**. |

**Still stuck?** Message Hashaam with: (1) what you clicked, (2) what you saw, (3) a screenshot if you can. Don't uninstall or delete anything — your unsent recordings live in `Documents\CRM Recordings` and deleting that folder is the only way to actually lose them.

---

## The one rule 🏆

**You can always keep calling.** Server down, internet hiccup, whatever — the tools save everything on your computer and send it automatically when things recover. Never stop a calling session because of a technical warning; the warnings just mean "syncing later".
