# TSM Personal Transactions Tracker v6.12

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
