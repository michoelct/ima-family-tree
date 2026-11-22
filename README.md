# Ima's Family Tree

A phone-first family tree for Ima's birthday. Everyone in the tree gets a printed name badge with a QR code.
When a guest scans their own badge, the page remembers who they are. After that, scanning anyone else's badge
(or tapping a person on the tree) shows how the two are related, with the line between them lit up on the tree.

## Where the data comes from
The Google Sheet (tabs **Family_Tree** and **Ima_Friends**) must be shared as *Anyone with the link can view*.
Open pages check it every 45 seconds, so a row added during the party shows up on everyone's phone without reprinting.
`data/snapshot.json` is a saved copy the page shows first, so it opens fast and still works on bad Wi-Fi.
To refresh that copy, run `node tools/snapshot.mjs`.

Settings (sheet, root person, refresh time, people not in the sheet yet) are in `js/config.js`.

## Organiser tools
Open the page with `#organizer` at the end of the address. From there you can:
- print name badges (A4, 8 per page): newspaper style sized to the badge-holder slot (default 90 × 64 mm, adjustable), or plain,
- print a table sign with one big QR code,
- print the whole tree as a poster (A4 to A1),
- read a list of problems in the sheet (typos, missing people, wrong generation).

Badges link to each person's ID (FAM-014). Once badges are printed, don't re-number or sort the sheet.

## Files
- `index.html`, `css/app.css`: the page.
- `js/data.js`: reads the sheet and links people by name. It handles nicknames, typos and z"l.
- `js/relations.js`: works out how two people are related, in plain English.
- `js/layout.js`: places the cards on the tree. Two views: **Chart** (the default everywhere — one row per generation; the family named in `centerFamily` in `js/config.js` is built in the middle and the tree opens on it) and **List** (each generation one step to the right, read top to bottom). Families can be opened and closed (+N / −); the poster always prints everyone.
- `js/app.js`: the screens, zoom, live updates and printing.
- `tests/`: run with `node --test tests/family.test.js`.

## Publishing
Live at https://michoelct.github.io/ima-family-tree/ (GitHub Pages, from the `main` branch).
After changing any file in `js/` or `css/`, raise the `?v=` number on the links in `index.html`,
or phones keep the old copy for up to 10 minutes. Sheet changes need no publishing.
