/**
 * Builds the FIRST DRAFT of the printable agent guide.
 *
 * ⚠ THE SHIPPED GUIDE IS NO LONGER GENERATED FROM THIS FILE.
 * docs/RE-MAX-Platinum-Agent-Guide.docx has since been hand-edited by the owner
 * (wording throughout, plus a texting phone number), and later additions were
 * applied to that .docx directly. This script writes to a *.generated.docx name
 * so running it can never clobber the shipped document. Treat it as the record
 * of the original structure, not as a regenerator: to change the live guide,
 * edit the .docx.
 *
 *   npm i --no-save docx && node scripts/build-agent-guide.js
 *
 * `docx` is deliberately NOT a project dependency — this is a one-off document
 * build, not part of the app, and it has no business in the deploy or CI graph.
 * Install it transiently (or globally) when you need to regenerate.
 *
 * Every number here mirrors the live engine. If you change routing, scoring,
 * the lifecycle or the SMS vocabulary, update this file too:
 *   slots/queue ....... lib/routing.ts (slotCountForScore, reconcileRotation)
 *   points ............ lib/scoring.ts (SCORE_DELTAS, fastEngagementDelta)
 *   stages/Lost ....... lib/leadLifecycle.ts (ALLOWED_TRANSITIONS, LOST_*)
 *   update clock ...... lib/statusUpdates.ts + app/api/cron/followup-check
 *   offer window/3h ... lib/offerWindow.ts + lib/autoOffer.ts
 *   text commands ..... lib/smsCommands.ts (STATUS_PHRASES)
 *   referral terms .... broker policy — not in code
 */
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  PageBreak, LevelFormat, TableOfContents, Footer, PageNumber,
} = require('docx');

// ---------------------------------------------------------------------------
// Palette + layout
// ---------------------------------------------------------------------------
const BLUE = '1E3A5F';
const RED = 'DC1C2E';
const CHARCOAL = '232323';
const MUTE = '5A6472';
const RULE = 'D8DEE6';
const BAND = 'F1F4F8';
const CREAM = 'FBF7EF';

const CONTENT_W = 9360; // 12240 letter - 2x1440 margins

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const H1 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 160 },
    children: [new TextRun({ text, bold: true, size: 32, color: BLUE })],
  });

const H2 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 120 },
    children: [new TextRun({ text, bold: true, size: 25, color: CHARCOAL })],
  });

const H3 = (text) =>
  new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, bold: true, size: 22, color: BLUE })],
  });

/** Body paragraph. `runs` is a string or an array of {text, bold?, italics?, color?}. */
const P = (runs, opts = {}) =>
  new Paragraph({
    spacing: { after: opts.after ?? 140, line: 288 },
    alignment: opts.align,
    children: (typeof runs === 'string' ? [{ text: runs }] : runs).map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italics,
          size: opts.size ?? 21,
          color: r.color ?? opts.color ?? CHARCOAL,
          font: r.mono ? 'Consolas' : undefined,
        }),
    ),
  });

const BULLET = (runs) =>
  new Paragraph({
    numbering: { reference: 'bullets', level: 0 },
    spacing: { after: 90, line: 288 },
    children: (typeof runs === 'string' ? [{ text: runs }] : runs).map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italics,
          size: 21,
          color: r.color ?? CHARCOAL,
          font: r.mono ? 'Consolas' : undefined,
        }),
    ),
  });

/** Callout: a tinted, left-bordered block. */
const CALLOUT = (title, runs, tone = 'blue') => {
  const accent = tone === 'red' ? RED : tone === 'cream' ? '9A7B2F' : BLUE;
  const fill = tone === 'cream' ? CREAM : BAND;
  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: [CONTENT_W],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
      left: { style: BorderStyle.SINGLE, size: 18, color: accent },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: CONTENT_W, type: WidthType.DXA },
            shading: { type: ShadingType.CLEAR, fill },
            margins: { top: 160, bottom: 160, left: 220, right: 220 },
            children: [
              ...(title
                ? [new Paragraph({
                    spacing: { after: 70 },
                    children: [new TextRun({ text: title, bold: true, size: 21, color: accent })],
                  })]
                : []),
              new Paragraph({
                spacing: { line: 288 },
                children: (typeof runs === 'string' ? [{ text: runs }] : runs).map(
                  (r) => new TextRun({
                    text: r.text, bold: r.bold, italics: r.italics, size: 20,
                    color: r.color ?? CHARCOAL, font: r.mono ? 'Consolas' : undefined,
                  }),
                ),
              }),
            ],
          }),
        ],
      }),
    ],
  });
};

/**
 * Table with a header band. `rows` is an array of arrays; each cell is a string
 * or {text, bold?, color?, mono?}.
 */
const TABLE = (headers, rows, widths) => {
  const cols = widths ?? headers.map(() => Math.floor(CONTENT_W / headers.length));
  // Make the widths sum exactly to the content width.
  const drift = CONTENT_W - cols.reduce((a, b) => a + b, 0);
  cols[cols.length - 1] += drift;

  const cell = (c, i, opts = {}) => {
    const v = typeof c === 'string' ? { text: c } : c;
    return new TableCell({
      width: { size: cols[i], type: WidthType.DXA },
      shading: opts.fill ? { type: ShadingType.CLEAR, fill: opts.fill } : undefined,
      margins: { top: 90, bottom: 90, left: 140, right: 140 },
      children: [
        new Paragraph({
          spacing: { line: 264 },
          alignment: v.align,
          children: [
            new TextRun({
              text: v.text,
              bold: v.bold ?? opts.headerRow,
              size: 20,
              color: v.color ?? (opts.headerRow ? MUTE : CHARCOAL),
              font: v.mono ? 'Consolas' : undefined,
            }),
          ],
        }),
      ],
    });
  };

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: cols,
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => cell(h, i, { headerRow: true, fill: BAND })),
      }),
      ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i)) })),
    ],
  });
};

const SPACER = (h = 120) => new Paragraph({ spacing: { after: h }, children: [] });
const BREAK = () => new Paragraph({ children: [new PageBreak()] });

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------
const children = [];

// ---- Cover -----------------------------------------------------------------
children.push(
  new Paragraph({ spacing: { before: 2600, after: 0 }, children: [] }),
  new Paragraph({
    spacing: { after: 80 },
    children: [new TextRun({ text: 'RE/MAX PLATINUM', bold: true, size: 26, color: RED, characterSpacing: 60 })],
  }),
  new Paragraph({
    spacing: { after: 100 },
    children: [new TextRun({ text: 'Lead Program', bold: true, size: 64, color: BLUE })],
  }),
  new Paragraph({
    spacing: { after: 340 },
    children: [new TextRun({ text: 'Agent Guide', bold: true, size: 44, color: CHARCOAL })],
  }),
  new Paragraph({
    spacing: { after: 60 },
    border: { top: { style: BorderStyle.SINGLE, size: 8, color: RULE, space: 12 } },
    children: [],
  }),
  P([{ text: 'How seller leads are generated, how they reach you, how to work them, and how your standing in the rotation is earned.', color: MUTE }], { size: 22 }),
  SPACER(240),
  P([{ text: 'Everything in this guide reflects how the system actually behaves today. Keep it handy for your first few leads.', italics: true, color: MUTE }], { size: 19 }),
  BREAK(),
);

// ---- Contents --------------------------------------------------------------
children.push(
  H1('Contents'),
  new TableOfContents('Contents', { hyperlink: true, headingStyleRange: '1-2' }),
  BREAK(),
);

// ---- 1. What this is -------------------------------------------------------
children.push(
  H1('1. What this is'),
  P('RE/MAX Platinum runs a set of websites that offer homeowners a free, instant estimate of what their home is worth. When someone asks for that estimate, they become a seller lead — and the system routes that lead to one of our agents automatically.'),
  P('This guide explains the whole path: how a lead is created, how the system decides who gets it, what you need to do once it is yours, and how your activity feeds back into how often leads reach you.'),
  H2('The short version'),
  TABLE(
    ['Step', 'What happens'],
    [
      [{ text: '1', bold: true }, 'A homeowner requests a valuation on one of our sites.'],
      [{ text: '2', bold: true }, 'The system finds every agent whose coverage area includes that home.'],
      [{ text: '3', bold: true }, 'It offers the lead to whoever is next in the rotation.'],
      [{ text: '4', bold: true }, 'You get an email and a text. You have 3 hours to accept.'],
      [{ text: '5', bold: true }, 'Accept, and the seller’s full contact details are yours immediately.'],
      [{ text: '6', bold: true }, 'You work the lead and log your progress as it moves.'],
      [{ text: '7', bold: true }, 'Responding fast and moving leads forward earns points, which earn you more turns in the rotation.'],
    ],
    [900, 8460],
  ),
  SPACER(180),
  CALLOUT(
    'Two things to do before anything else',
    [
      { text: '1. Set your password ', bold: true },
      { text: 'from the invitation email the office sent you. ' },
      { text: '2. Turn on your availability ', bold: true },
      { text: 'in Settings. Until you do the second one, you are not in the rotation and no leads will be offered to you — and the order agents switch on is the order of the line.' },
    ],
    'red',
  ),
  BREAK(),
);

// ---- 2. Getting set up -----------------------------------------------------
children.push(
  H1('2. Getting set up'),
  H2('Your first sign-in'),
  P('The office emails you a setup link that is personal to you. It works once and expires after 7 days. Open it and choose a password of at least 8 characters.'),
  P('There is no shared code and no way to set up an account without that link. If yours has expired or already been used, ask the office to send a new one — they can re-issue it any time, and the new link replaces the old.'),
  H2('Signing in after that'),
  BULLET([{ text: 'Email and password ', bold: true }, { text: 'at the agent sign-in page.' }]),
  BULLET([{ text: 'Forgot it? ', bold: true }, { text: 'Enter your email on the sign-in page and we send a reset link, good for 2 hours. It goes to your address on file, so only you can use it.' }]),
  BULLET([{ text: 'From a lead email or text. ', bold: true }, { text: 'Tapping Accept, or a lead link in a text, signs you in automatically and opens the lead.' }]),
  P('Once signed in you stay signed in on that device for 7 days.'),
  SPACER(60),
  CALLOUT(
    'Treat lead links like your password',
    'A link in a lead email or text signs in as you and shows every seller’s contact details. Do not forward them. Each new message replaces the link in the last one, so always use your most recent email or text — an older link will have stopped working, and that is normal, not a fault.',
  ),
  H2('Your coverage area'),
  P('In Settings you choose two things that decide which leads can reach you:'),
  BULLET([{ text: 'Where your distance is measured from ', bold: true }, { text: '— your office, or a city you pick.' }]),
  BULLET([{ text: 'How far you will travel ', bold: true }, { text: '— your radius in miles. Leave it blank to use the brokerage default of 20 miles. The maximum is 250.' }]),
  P('A lead is only offered to you if the home sits inside that circle. Set it to the area you genuinely want to drive to — you do not need a wide radius to avoid missing distant leads (see section 4).'),
  BREAK(),
);

// ---- 3. Referral terms -----------------------------------------------------
children.push(
  H1('3. Referral terms'),
  CALLOUT(
    'The agreement',
    [
      { text: 'Each lead generated by the system is a ' },
      { text: '30% referral back to RE/MAX Platinum', bold: true },
      { text: '. By turning on your availability you are agreeing to this referral.' },
    ],
    'cream',
  ),
  SPACER(180),
  TABLE(
    ['', 'Terms'],
    [
      [{ text: 'How much', bold: true }, '30% of the gross commission on the deal.'],
      [{ text: 'When it is owed', bold: true }, 'At closing. A lead that never closes owes nothing.'],
      [{ text: 'How many deals', bold: true }, 'Up to two per client. The first deal always carries the referral. A second one does too — a listing then a purchase, or a purchase then a listing — only if it closes within one year of the first. Past two deals, or a second deal more than a year after the first, no referral is due.'],
      [{ text: 'Desk fees', bold: true }, 'No desk fee is taken out of a deal that pays a referral. The referral amount does not count toward your desk fee cap.'],
    ],
    [2100, 7260],
  ),
  SPACER(180),
  H3('An example'),
  P('You list Sarah’s home and it closes in March — that deal pays the referral. She buys through you in September: that is within the year, so it pays the referral too. Had she instead bought two years later, only the March listing would have paid.'),
  SPACER(60),
  P([{ text: 'The system records the date you first turn your availability on. Pausing later does not withdraw the agreement — it applies to the leads the system sends you. Questions about how a specific deal is treated go to your broker.', color: MUTE }], { size: 19 }),
  BREAK(),
);

// ---- 4. How leads reach you ------------------------------------------------
children.push(
  H1('4. How leads reach you'),
  H2('The rotation'),
  P('Every agent who has switched their availability on holds one or more slots in a single shared line. The system works from the front: when a lead comes in, it walks the line and offers it to the first agent whose coverage area includes that home. Whoever is served moves to the back.'),
  P('More slots means more turns per lap, so leads reach you more often. Slots are earned through your Queue Score (section 8).'),
  H2('Joining the line'),
  P('You join the rotation the first time you turn your availability on — not when your account is created. The order agents switch on is the order of the line, and nothing else moves you up it. If you intend to take leads, do this early.'),
  SPACER(60),
  CALLOUT(
    'New-agent head start',
    'The first time you switch yourself Available you receive a one-time +50 Queue Score. That is worth 3 slots instead of 1, so you get three turns per lap from the start. Your first turn comes once everyone already in the rotation has had one, and your three slots are spread through the line rather than bunched together. The credit affects only your queue slots — never the leaderboards or your tier — and fades away over the following year.',
  ),
  SPACER(140),
  H2('When you are skipped'),
  BULLET([{ text: 'Out of your area. ', bold: true }, { text: 'You keep your place — a lead that was never yours to take does not cost you a turn.' }]),
  BULLET([{ text: 'You are paused. ', bold: true }, { text: 'You forfeit that turn and it passes to the next agent, but you keep your slots and your standing. Pause for a day and, if your turn never comes up, it costs you nothing.' }]),
  H2('Leads nobody covers'),
  P('If a home falls outside every agent’s radius, it is never handed to whoever happens to be least far away. It goes to the admin, who will look for an agent willing to cover that area. The same applies to anything outside Michigan. This is why you do not need a wide radius to catch distant leads.'),
  H2('Timing'),
  BULLET([{ text: 'Sending hours are 7am–8pm ET. ', bold: true }, { text: 'A lead that arrives overnight waits and goes out first thing at 7am, so nobody is woken up and nobody loses their turn.' }]),
  BULLET([{ text: 'You have 3 hours to respond. ', bold: true }, { text: 'The clock starts when the offer is sent, not when the lead came in. Miss it and the lead moves to the next agent.' }]),
  BULLET([{ text: 'There is no lead cap. ', bold: true }, { text: 'You can hold as many active leads as you can work. Staying responsive is what keeps offers coming.' }]),
  BREAK(),
);

// ---- 5. Accepting ----------------------------------------------------------
children.push(
  H1('5. Accepting a lead'),
  P('You are notified two ways: an email, and a text if you have a mobile number on file. Either one can claim the lead.'),
  TABLE(
    ['From', 'What to do', 'What happens'],
    [
      ['Email', 'Tap Accept', 'Claims the lead, signs you in, and opens the lead page with the seller’s details — no password needed.'],
      ['Text', { text: 'Reply YES', mono: true }, 'Claims the lead. We text you the seller’s full details straight back, with a link to the lead.'],
      ['Either', 'Do nothing', 'After 3 hours the offer expires and moves to the next agent.'],
    ],
    [1200, 2400, 5760],
  ),
  SPACER(180),
  P([
    { text: 'The offer text and email deliberately hold back the seller’s name and contact details — those arrive the moment you accept. What you get up front is the location, the estimated value and the deadline, which is what you need to decide.' },
  ]),
  H2('If you cannot take it'),
  P([
    { text: 'Reply ' }, { text: 'NO', mono: true, bold: true },
    { text: ' or tap Decline. The lead goes to the next agent immediately. Declining costs you 3 points; simply ignoring the offer costs 4, because it ties the lead up for three hours first. If you cannot work a lead, declining quickly is always better than letting it expire.' },
  ]),
  BREAK(),
);

// ---- 6. Working the lead ---------------------------------------------------
children.push(
  H1('6. Working the lead'),
  P('Every lead moves through a set of stages. The stage you set is what the system scores, so keeping it current is how you get credit for the work you are doing.'),
  H2('The stages'),
  TABLE(
    ['Stage', 'What it means', 'Points'],
    [
      ['New', 'Just accepted. Nobody has been contacted yet.', '—'],
      ['Attempted contact', 'You tried to reach them — called, left a voicemail, emailed.', '+1'],
      ['Connected', 'You actually spoke with them.', '+2'],
      ['Nurturing', 'A real prospect who is not ready yet. Leads can sit here for months.', '0'],
      ['Appointment set', 'A listing appointment is on the calendar.', '+4'],
      ['Signed', 'Listing agreement signed.', '+10'],
      ['Closed', 'The deal closed. This is the big one.', '+25'],
      ['Lost', 'It did not work out. Pick the reason that fits.', '0'],
    ],
    [2100, 5460, 1800],
  ),
  SPACER(180),
  P([{ text: 'Each of these pays once per lead. ', bold: true }, { text: 'Moving a lead backward and forward again will not re-pay it, so log honestly and focus on real progress.' }]),
  H2('The order stages move in'),
  P('You cannot skip ahead. From New you go to Attempted contact or Connected; from Connected the next step is Nurturing; appointments come from Nurturing. On the Pipeline board, stages a lead cannot move to are greyed out while you drag, so you will not have to guess.'),
  P('If an appointment or a signed listing falls through, you can move the lead back to Nurturing. That keeps it active and costs you nothing.'),
  SPACER(60),
  CALLOUT(
    'You do not have to change the stage to log an update',
    'The stage box already shows where the lead is now. If nothing has changed, add a note if you have one — or just hit Save. That counts as an update and resets your clock. A seller you nurture for six months only needs a periodic check-in, not a made-up stage change. By text, send the stage word on its own: NURTURE 1234.',
  ),
  SPACER(140),
  H2('Marking a lead Lost'),
  P('Lost is not a failure and carries no penalty — but it does need a reason, and the reasons offered depend on the stage the lead is in, so the record means something later.'),
  SPACER(40),
  CALLOUT(
    'You cannot go straight from New to Lost',
    'A brand-new lead has to be moved to Attempted contact first — then Lost becomes available, with Bad number, Wrong number and Email bounced as the reasons. That is two saves a few seconds apart, and it is deliberate: those reasons all describe something you found out by trying, so logging the attempt is just recording the call you made. You also earn the point for it.',
  ),
  SPACER(140),
  TABLE(
    ['From this stage', 'Reasons you can choose'],
    [
      ['Attempted contact', 'Bad number · Wrong number · Email bounced · No response after 6 attempts'],
      ['Connected', 'Already listed or recently sold · Just looking · Already have an agent'],
      ['Nurturing or Appointment set', 'Stopped responding · Selected another agent · Changed plans'],
      ['Signed', 'Listing withdrawn · Listing expired · Terminated for another agent'],
    ],
    [2900, 6460],
  ),
  SPACER(160),
  P([{ text: '“No response after 6 attempts” unlocks once you have logged six Attempted contact updates on this lead in your current run at it. If a seller comes back after being marked Lost, the count starts over — six fresh attempts. Because a reason is always required, Lost is the one thing you cannot set by text; open the lead to do it.', color: MUTE }], { size: 19 }),
  H2('If a lead comes back'),
  P('If a seller you marked Lost submits again, the lead reopens and returns to you as if it were new, with the clock restarted. You keep any points you already earned on it.'),
  BREAK(),
);

// ---- 7. Update clock -------------------------------------------------------
children.push(
  H1('7. The update clock'),
  P('One rule keeps leads from going cold: log an update before the clock runs out.'),
  TABLE(
    ['When', 'You have', 'Why'],
    [
      ['After you accept', '24 hours', 'Make first contact, or at least log an attempt, within a day.'],
      ['While you are working it', '7 days', 'Each update buys another week.'],
      ['Once it is Signed', '14 days', 'More breathing room once the listing is signed.'],
      ['At Closed or Lost', 'Clock stops', 'Finished leads need no updates.'],
    ],
    [2600, 1900, 4860],
  ),
  SPACER(180),
  BULLET([{ text: 'A reminder email goes out about 24 hours before a check-in is due, ', bold: true }, { text: 'so a missed update is avoidable.' }]),
  BULLET([{ text: 'Missing it costs 2 points, ', bold: true }, { text: 'and it repeats each cycle until you log something. Small, but it adds up.' }]),
  BULLET([{ text: 'An update with no stage change is always free ', bold: true }, { text: 'and always counts. Checking in on a lead that has not moved never costs you anything.' }]),
  BREAK(),
);

// ---- 8. Scores -------------------------------------------------------------
children.push(
  H1('8. Your scores'),
  P('You have four scores. They each do a different job and they count different windows of time, so do not expect them to match.'),
  TABLE(
    ['Score', 'Window', 'What it drives'],
    [
      [{ text: 'Queue Score', bold: true }, 'Last 365 days', 'How many slots you hold — how often leads reach you. This is the one that matters day to day.'],
      [{ text: 'Tier', bold: true }, 'Lifetime', 'Your standing badge, ranked against the other active agents.'],
      [{ text: 'This Month', bold: true }, 'Resets on the 1st', 'The monthly leaderboard.'],
      [{ text: 'Year to Date', bold: true }, 'Resets Jan 1', 'The year-to-date leaderboard.'],
    ],
    [2000, 2100, 5260],
  ),
  SPACER(180),
  P('Queue Score points age out after a year, so recent activity is what keeps you near the front. That includes your +50 head start, which drops off about a year after you activate.'),
  H2('Queue Score becomes slots'),
  TABLE(
    ['Queue Score', 'Slots (turns per lap)'],
    [
      ['0 – 9', '1'], ['10 – 39', '2'], ['40 – 89', '3'],
      ['90 – 159', '4'], ['160 – 249', '5'], ['250+', '6 or more'],
    ],
    [4680, 4680],
  ),
  SPACER(160),
  P('Your live Queue Score, your current slots, and how many points until the next one are all on your dashboard and Performance page.'),
  BREAK(),
  H2('How you earn and lose points'),
  H3('Responding to an offer'),
  TABLE(
    ['Action', 'Points'],
    [
      ['Accept in under 15 minutes', { text: '+4', bold: true }],
      ['Accept in 15–30 minutes', { text: '+3', bold: true }],
      ['Accept in 30–60 minutes', { text: '+2', bold: true }],
      ['Accept in 1–3 hours', { text: '+1', bold: true }],
      ['Decline', { text: '−3', bold: true, color: RED }],
      ['No response — the offer expires after 3 hours', { text: '−4', bold: true, color: RED }],
    ],
    [7060, 2300],
  ),
  SPACER(160),
  H3('Getting started fast — a one-time bonus per lead'),
  P('The timer starts the moment you accept. You earn this by logging your first update, moving the lead to Attempted contact or Connected.'),
  TABLE(
    ['First update logged', 'Points'],
    [
      ['Within 15 minutes of accepting', { text: '+4', bold: true }],
      ['Within 15–30 minutes', { text: '+3', bold: true }],
      ['Within 30–60 minutes', { text: '+2', bold: true }],
      ['Within 1–3 hours', { text: '+1', bold: true }],
      ['After 3 hours', { text: '0', bold: true }],
    ],
    [7060, 2300],
  ),
  SPACER(160),
  H3('Moving the lead forward'),
  P('Attempted contact +1 · Connected +2 · Nurturing 0 · Appointment set +4 · Signed +10 · Closed +25 · Lost 0. Each pays once per lead.'),
  H3('Keeping leads updated'),
  P('Missing an update check-in costs 2 points and repeats each cycle until you log something.'),
  SPACER(60),
  CALLOUT(
    'Where the points really are',
    'Speed early and moving leads forward. Accepting quickly and logging your first contact fast is worth up to 8 points before you have done anything else — and a closing is worth 25.',
  ),
  BREAK(),
  H2('Tiers'),
  P('Your tier is a ranking against the other active agents, from Top Performer down to At Risk:'),
  P([{ text: 'Top Performer · Strong · Good Standing · Average · Needs Improvement · At Risk', bold: true }]),
  P('Top Performer is the top 10% by lifetime score; At Risk is the bottom 10%. These are relative — they rank you against each other, not against a fixed target, so the bands always stay filled no matter how well everyone is doing. On a small team a single closing can move you several bands.'),
  SPACER(60),
  CALLOUT(
    'What your scores read on day one',
    'Your Queue Score is 50 the moment you go Available — that is the head start, worth 3 slots. This Month and Year to Date both start at 0; the head start deliberately does not touch them, so nobody starts a leaderboard ahead of anyone else. Every agent begins from the same lifetime baseline, so until points are earned the whole roster sits mid-pack at Good Standing. That is a starting position, not a grade.',
  ),
  SPACER(140),
  H2('Leaderboards'),
  P('The monthly and year-to-date leaderboards show the top 20 and your own rank. Your lifetime score and tier stay private — they are on your Performance page and nobody else’s.'),
  BREAK(),
);

// ---- 9. Texting ------------------------------------------------------------
children.push(
  H1('9. Working leads by text'),
  P('If you have a mobile number on file, new offers and update reminders also come by text — and you can do almost everything by replying. You never have to open the portal to claim a lead or log an update.'),
  TABLE(
    ['To do this', 'Reply with', 'Also accepted'],
    [
      ['Take the lead', { text: 'YES', mono: true, bold: true }, { text: 'Y, ACCEPT', mono: true }],
      ['Pass on it', { text: 'NO', mono: true, bold: true }, { text: 'N, PASS, DECLINE', mono: true }],
      ['Log an attempt', { text: 'LEFT VM 1234', mono: true, bold: true }, { text: 'CALLED, NO ANSWER, ATTEMPTED CONTACT, VOICEMAIL', mono: true }],
      ['You spoke with them', { text: 'CONNECTED 1234', mono: true, bold: true }, { text: 'SPOKE, REACHED, CONTACTED, MADE CONTACT', mono: true }],
      ['Still working it, no change', { text: 'NURTURE 1234', mono: true, bold: true }, { text: 'NURTURING', mono: true }],
      ['Appointment booked', { text: 'APPT SET 1234', mono: true, bold: true }, { text: 'APPOINTMENT SET', mono: true }],
      ['Listing signed', { text: 'SIGNED 1234', mono: true, bold: true }, { text: 'LISTING SIGNED', mono: true }],
      ['Closed and won', { text: 'CLOSED 1234', mono: true, bold: true }, { text: 'CLOSED WON, WON', mono: true }],
      ['Stop all texts', { text: 'STOP', mono: true, bold: true }, { text: 'START to resume', mono: true }],
      ['See the command list', { text: 'HELP', mono: true, bold: true }, ''],
    ],
    [2500, 3100, 3760],
  ),
  SPACER(180),
  H2('Three things worth knowing'),
  BULLET([{ text: 'Notes go after the lead number. ', bold: true }, { text: 'CONNECTED 1234 wants to list in spring', mono: true }, { text: ' — everything after the number is saved as your note.' }]),
  BULLET([{ text: 'The lead number. ', bold: true }, { text: 'YES and NO do not need one when you only have one open offer. Status updates need it as soon as you are working more than one lead. It is in every text we send you.' }]),
  BULLET([{ text: 'Lost cannot be done by text. ', bold: true }, { text: 'It needs a reason that fits the stage, so we will point you to the lead page to pick one.' }]),
  SPACER(60),
  CALLOUT(
    'STOP only stops texts',
    'Replying STOP opts you out of every text from us, including lead offers — but email keeps coming, and your leads and queue position are unaffected. Reply START any time to turn texts back on.',
    'red',
  ),
  BREAK(),
);

// ---- 10. Availability ------------------------------------------------------
children.push(
  H1('10. Available or paused'),
  TABLE(
    ['', 'What it means'],
    [
      [{ text: 'Available', bold: true }, 'You are in the rotation and receive new lead offers.'],
      [{ text: 'Paused', bold: true }, 'You keep every lead you already have but receive no new offers until you switch back on. Good for vacations, or a full plate.'],
    ],
    [1800, 7560],
  ),
  SPACER(180),
  P('Toggle it any time from your dashboard or Settings, where you also set your coverage area and radius.'),
  SPACER(60),
  CALLOUT(
    'Pausing does not cost you your place',
    'You keep your slots and your standing the whole time. If one of your turns comes up while you are paused you forfeit that turn — it passes to the next agent and yours rotates around as normal. Switching back on does not move you forward either, so there is no advantage to toggling.',
  ),
  SPACER(200),
  H1('11. Quick reference'),
  TABLE(
    ['', ''],
    [
      ['Time to accept an offer', '3 hours'],
      ['Offer sending hours', '7am – 8pm ET'],
      ['First update due', '24 hours after you accept'],
      ['Updates after that', 'Every 7 days · every 14 days once Signed'],
      ['Missed check-in', '−2 points, repeating'],
      ['Default coverage radius', '20 miles (yours is adjustable, max 250)'],
      ['New-agent head start', '+50 Queue Score — 3 slots'],
      ['Setup link', 'Single use, expires after 7 days'],
      ['Password reset link', 'Expires after 2 hours'],
      ['Stay signed in', '7 days per device'],
      ['Referral', '30% of gross commission, at closing'],
      ['Lead cap', 'None'],
    ],
    [3400, 5960],
  ),
  SPACER(220),
  CALLOUT(
    'Questions',
    'Anything this guide does not answer — including how the referral applies to a specific deal — goes to your broker or the Platinum admin team. There is also a Help page inside the portal with the same information, kept up to date as the system changes.',
  ),
);

// ---------------------------------------------------------------------------
const doc = new Document({
  creator: 'RE/MAX Platinum',
  title: 'RE/MAX Platinum Lead Program — Agent Guide',
  description: 'How seller leads are generated, routed, worked and scored.',
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          {
            level: 0,
            format: LevelFormat.BULLET,
            text: '•',
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 460, hanging: 260 } } },
          },
        ],
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 21, color: CHARCOAL } },
    },
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      footers: {
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({ text: 'RE/MAX Platinum Lead Program — Agent Guide', size: 16, color: MUTE }),
                new TextRun({ text: '    ·    ', size: 16, color: RULE }),
                new TextRun({ children: [PageNumber.CURRENT], size: 16, color: MUTE }),
              ],
            }),
          ],
        }),
      },
      children,
    },
  ],
});

const out = path.join(__dirname, '..', 'docs', 'RE-MAX-Platinum-Agent-Guide.generated.docx');
Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(out, buf);
  console.log('Wrote', out, `(${(buf.length / 1024).toFixed(0)} KB)`);
});
