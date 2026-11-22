/* Settings for this family tree. Change these, nothing else, to reuse the app. */
window.FT_CONFIG = {
  title: "Ima's Family Tree",
  subtitle: "Shulamit Feder · 5 generations",
  eventName: "Ima's birthday",

  // The Google Sheet (shared as "Anyone with the link can view")
  sheetId: '1DeBbOGA-jSEWTtL0OyHcoONSw_z4i_q-KHFWfdpuVfU',
  familyGid: 1,   // the Family_Tree tab
  friendsGid: 2,  // the Ima_Friends tab

  rootName: 'Shulamit Feder',   // the person the tree grows from
  rootTitle: 'Ima',             // what everyone calls her
  centerFamily: 'Malca',        // this child's family sits in the middle of the chart, and the tree opens on it

  // How often an open page checks the sheet for new rows (seconds)
  refreshSeconds: 45,

  // The public address of the app — put inside every QR code.
  // Leave empty to use the address the page is opened from.
  appUrl: 'https://michoelct.github.io/ima-family-tree/',

  // The newspaper-style name badges (they match the newspaper birthday cake).
  // Leave date empty to leave it off the badge.
  newspaper: {
    masthead: 'The Feder Family Journal',
    volume: 'Vol. I',
    edition: 'Special Birthday Edition',
    date: 'Sunday, December 6, 2026',
    occasion: 'Second day of Chanukah',
    ribbon: 'Happy Birthday, Ima!'
  },

  // People who are not in the sheet (yet). A row in the sheet with the same
  // name replaces the entry here automatically.
  extras: [
    { name: 'Simcha Feder z"l', badge: 'Aba', spouse: 'Shulamit Feder', gen: 1 },
    { name: 'Chana Malca Fass', badge: 'Malca', parent1: 'Shulamit Feder', parent2: 'Simcha Feder z"l', spouse: 'Menachem Tzvi Fass', gen: 2 }
  ]
};
