# Realcomp approved logo — REQUIRED before public IDX launch

IDX Rules §18.3.4 / §18.3.5 require the **Realcomp-approved logo/icon** adjacent
to every IDX listing (summary and detail). The app references it at:

    public/assets/realcomp-logo.png

**Action for the owner:** request the official logo files from Realcomp when you
notify them of your intention to display IDX data, then drop the PNG here as
`realcomp-logo.png` (a roughly square icon works best — it renders at ~16–20px).

Until the file is added, the listing cards show a broken-image icon where the
logo belongs. Do **not** substitute a home-made logo — only the Realcomp-approved
artwork is compliant. The path/filename is set in `lib/idxDisclosures.ts`
(`REALCOMP_LOGO_SRC`); change it there if you store the file under a different name.
