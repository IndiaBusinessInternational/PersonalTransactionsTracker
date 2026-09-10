# TSM Personal Transactions Tracker v6.8

Dr. T. Sasimurugan's personal income and expense PWA — ledger, monthly plan,
commitments and reports.

**Live:** <https://indiabusinessinternational.github.io/PersonalTransactionsTracker/>

**Voice entry (v6.8)** — speak one sentence, check it on screen, confirm (or say
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
