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
- `js/layout.js` + `js/views.js`: place the cards. The **View** menu on the tree offers four views, remembered separately for a phone and a bigger screen (a link can open one: `?view=family|chart|sun|list`):
  **Family** (one person in the middle — parents above, children and grandchildren below; tap anyone to move to them; the default on a phone),
  **Generations** (one row per generation, the `centerFamily` from `js/config.js` built in the middle; the default on a big screen),
  **Sun** (the whole family in one circle, each branch a coloured slice) and **List** (top to bottom like a page).
  Options in the same menu: colour each branch (also printed on the badges and the table sign) and a newspaper look. The poster prints as a Sun or as Generations.
- `js/app.js`: the screens, zoom, live updates and printing.
- `tests/`: run with `node --test tests/family.test.js`.

## Publishing
Live at https://michoelct.github.io/ima-family-tree/ (GitHub Pages, from the `main` branch).
After changing any file in `js/` or `css/`, raise the `?v=` number on the links in `index.html`,
or phones keep the old copy for up to 10 minutes. Sheet changes need no publishing.
