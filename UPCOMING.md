# 🚀 Feature Request: Instagram Lead Scraper & AI Enrichment Agent

## 📋 Executive Summary
**Goal:** Shift focus to high-leverage prospecting by eliminating manual data entry.
**Problem:** Currently copying/pasting Instagram profile data into Google Sheets manually (Ctrl+C/Ctrl+V) is time-consuming.
**Solution:** A browser extension to scrape contact info with one click, followed by an automated AI agent to enrich that data with technical insights (SEO, Ordering Systems, etc.).

---

## 🛠 Phase 1: The Browser Extension (The "Scraper")
**Objective:** Reduce lead entry time to near-zero. Save ~2 hours/day.

### Functional Requirements
* **Platform:** Instagram Desktop (Web).
* **UI Overlay:** Inject a simple button (e.g., a "Yes" or "Add Lead" button) directly onto the Instagram Profile interface.
* **Trigger:** On click, scrape specific fields and push to a row in the Master Google Sheet.
* **Data Points to Scrape:**
    * [ ] `Target Website URL` (Link in bio)
    * [ ] `Phone Number` (If visible/available)
    * [ ] `Instagram Handle/Name`

> **User Note:** *"I want to just click 'Yes' and have it automatically grab the data... avoiding the clutter of Ctrl+C/Ctrl+V."*

---

## 🧠 Phase 2: AI Data Enrichment (The "Analyzer")
**Objective:** After the URL is scraped, an AI agent must analyze the target's website to qualify the lead before a sales call.

### Automated Checks & Logic
The AI should visit the scraped URL and determine the following:

#### 1. SEO Audit
* **Action:** Analyze H1 headers and page keywords.
* **Comparison:** Cross-reference content with the owner's website (if available) to check for keyword alignment.
* **Output Boolean:** `SEO Optimized` vs. `No SEO`.

#### 2. Ordering System Detection
* **Action:** Simulate a click on "Order Online" or similar buttons.
* **Identification:** Determine if the fulfillment is **Direct** (First-party) or **Third-Party** (e.g., DoorDash, UberEats).
* **Output Tag:** `Direct Ordering` or `Using 3rd Party`.

#### 3. Tech Stack & Business Scope
* **Loyalty:** Is there a rewards/loyalty program? (Y/N)
* **Mobile App:** Do they have a proprietary mobile app? (Y/N)
* **Locations:** Count the number of store locations listed.

---

## 📊 Phase 3: Data Output & UI
**Objective:** The output in Google Sheets must be optimized for **speed-reading** during a cold call.

### Formatting Rules
* **No Long Prose:** Do not output paragraphs or long summaries.
* **Keywords Only:** Use "Quick Notes" format.
* **Example Output Column:**
    > `No SEO | Direct Ordering | No App | 3 Locations`

---

## 📈 Scope & Volume
* **Immediate Target:** Process a backlog of **~15,000 leads** (previous outreach/follows).
* **Priority:** High. This is the primary leverage point to enable high-volume cold calling.

## Notes Editor Update
* **Use Notion Like Text Editor:** Core Features and Code from (https://github.com/yoopta-editor/Yoopta-Editor.git)
 