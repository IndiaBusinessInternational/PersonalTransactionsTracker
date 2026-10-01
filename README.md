# TSM Finance Tracker v6.17

**Instant save (v6.17)** — a new entry appears at once (list and totals) and goes into an on-device outbox that syncs to Google Drive in the background, in order, retrying with growing gaps; the NO REPEATS request id makes every retry safe. A small badge in the status bar shows "N syncing…" or, if the server refuses one, "N not saved — tap" (send again / remove). The outbox survives closing the app. Edits update the row in place instead of re-downloading the ledger. Measured before: Apps Script took 4–50 s just to start a request.


**Balances: edit, rename, delete (v6.16)** — every account card now has **Edit** (latest reading), **Rename** (renaming to an existing account's name offers to MERGE them — e.g. "HDFC Bank Savings Account" into "HDFC Savings"), and **Delete** (the account and all its readings, after a confirm); History rows gain a delete button. Changes show on screen at once and are sent in the background. GAS is a number-only bump.


**Profile & Photo (v6.15)** — tap the photo (or the name) to change the photo, display name and subtitle any time; also in the menu. The photo is cropped square, shrunk to fit a Sheet cell, and kept in the Sheet's hidden **Settings** tab, so it shows on every device. It is UPLOADED in the request body (doPost reads the JSON) — Google refuses a URL over ~12,000 characters. "No photo" shows the TSM mark. Paste PersonalTransactions_GAS.gs 6.15 for the sync.


**Renamed (v6.14)** — the app is now called **TSM Finance Tracker** wherever a person reads it (title, top bar "Finance Tracker" beside the TSM mark, footer, print and CSV headers, install name "TSM Finance", link preview + a redrawn og-banner.png, GAS ping). The address, repo and PersonalTransactions_ file names are unchanged, so bookmarks and the installed app keep working.


**Bank & Cash Balances (v6.13)** — a new **Balances** section (bottom bar on a phone) keeps each account's balance as a *reading*, never as a transaction: account, date, balance, note. Each account shows its latest reading, the change since the one before and its history; the section totals every account and flags one not updated for 30 days. Readings live in their own **Balances** sheet (date stored as text, read with getDisplayValues), so they never touch Income, Expenses or any report — no more ₹1 entries. *Review & move* finds the old ₹1 / ₹0 balance rows in the ledger, reads the figure out of the description, and moves the ticked ones into Balances (idempotent: each reading's ID is BL + the ledger row's ID). Typing a ₹1 balance into the ledger now offers to record it under Balances instead. Paste the Apps Script v6.13 for the server half.


**No repeated entries (v6.12)** — Save no longer retries silently (that automatic second send after a slow reply is what put the same entry in the books twice). Every new ledger entry, plan line and commitment carries a request id (the industry-standard idempotency key); the Apps Script remembers it for six hours and answers a repeat with the first row instead of writing a second. A genuinely new entry with the same date, party and amount shows a *Possible repeat* warning (OK = save anyway, Cancel = go back), and Plan → Record it offers to link to a matching ledger row. Paste PersonalTransactions_GAS.gs 6.12 for the server half.


**Payment mode EFT (v6.11)** — *EFT — Electronic Funds Transfer* sits beside Bank transfer in every payment-mode list (ledger form, plan payment, commitment editor, voice check screen), and voice entry hears "by EFT" / "electronic funds transfer". Added for royalties such as Amazon KDP, whose payment reports name the method EFT. It is a label only — no total is split by mode — and the backend stores it as typed, so no Apps Script change is needed.


Dr. T. Sasimurugan's personal income and expense PWA — ledger, monthly plan,
commitments and reports.

**Live:** <https://indiabusinessinternational.github.io/PersonalTransactionsTracker/>

**Voice entry (v6.9)** — speak one sentence, check it on screen, confirm (or say
“save”). The same block as the two sibling trackers (Mini Personal Finance
Tracker, IBI Finance Tracker), byte-identical apart from the worked examples.
Nothing is written to the Sheet until Confirm & Save.

## Files

The repo keeps **both** the prefixed source files and the plain copies GitHub
Pages serves — a deploy must update both:

| Source | Served as |
|---|---|
| `PersonalTransactions_index.html` | `index.html` |
| `PersonalTransactions_sw.js` | `sw.js` |
| `PersonalTransactions_manifest.json` | `manifest.json` |

`PersonalTransactions_GAS.gs` is the Apps Script backend — paste it into the
Sheet's script editor, then **Deploy → Manage deployments → Edit → New
version** (never *New deployment*: that changes the `/exec` URL the app calls).
