# M365 Onboarding / Offboarding Tool

A small internal web dashboard for managing Microsoft 365 users: reset
password, enable/disable accounts, manage group & distribution list
membership, add users to SharePoint sites, and assign/remove Business
Standard licenses.

## Authentication

This app signs in using a **real Azure app registration** that your
org owns, via standard OAuth 2.0 authorization code flow with PKCE.

- **No client secret** — the app registration has "Allow public client
  flows" enabled, so PKCE replaces the need for one. Nothing sensitive
  is ever stored.
- **No hardcoded tenant ID** — the authority stays `common`, so
  whichever tenant the signed-in admin belongs to is used. The app
  registration being single-tenant is what actually restricts sign-in
  to your org, not anything in the code.
- **One required value**: `AZURE_CLIENT_ID` — the Application (client)
  ID from your app registration's Overview page. This is **not a
  secret** and is safe to store as a plain environment variable.

### Why this instead of a "zero setup" approach

An earlier version of this app used Microsoft's own shared "Graph
PowerShell" client ID with device code flow, specifically to avoid
needing any app registration at all. That worked initially but proved
unreliable in practice — repeated `invalid_grant`/empty-response
failures traced back to the device code endpoint itself, not this
app's code, confirmed via verbose MSAL logging showing the actual
response values coming back empty on every attempt. Device code flow
also depends on a shared, high-traffic client ID Microsoft doesn't
manage for you, and some tenants block device code flow entirely via
Conditional Access (a real issue hit earlier in this app's history).

A real app registration with a standard redirect flow is the
well-trodden, standard way essentially every production app signs
into Microsoft. It doesn't share the failure modes above, and setup
is about 5 minutes.

### Setting up the app registration (one-time, ~5 minutes)

1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **Identity
   → Applications → App registrations → + New registration**.
2. Name it (e.g. "M365 Onboarding Tool"). Under **Supported account
   types**, choose **Accounts in this organizational directory only
   (Single tenant)**.
3. Under **Redirect URI**, set the platform to **Mobile and desktop
   applications** (not "Web" — registering it under Web causes Microsoft
   to require a client secret at token exchange, which this app
   deliberately doesn't use) and enter `https://<your-app-url>/auth/callback`
   (must match your actual deployed URL exactly, including `https://`,
   no trailing slash). Click **Register**.
4. On the Overview page, copy the **Application (client) ID** — this
   is your `AZURE_CLIENT_ID`.
5. Go to **Authentication** → scroll to **Advanced settings** → set
   **Allow public client flows** to **Yes** → **Save**. This is what
   lets sign-in work with no client secret.
6. Go to **API permissions** → **+ Add a permission** → **Microsoft
   Graph** → **Delegated permissions** → add all eight: `User.ReadWrite.All`,
   `Group.ReadWrite.All`, `Directory.ReadWrite.All`,
   `Sites.ReadWrite.All`, `Mail.Send`, `User.Invite.All`,
   `AuditLog.Read.All`, `Reports.Read.All`. When searching, type the
   full name for each - searching just "Invitation" surfaces an
   unrelated Identity Governance permission
   (`TenantGovernance-Invitation.ReadWrite.All`) that looks similar but
   isn't what this app uses.
7. Still on API permissions, click **Grant admin consent for
   \<your org\>** and confirm — this pre-approves everything so nobody
   hits a consent prompt later.

## What's required

- An M365 **Global Administrator** or **User Administrator +
  SharePoint Administrator + License Administrator** account to sign
  in with (the app only ever asks for *delegated* permissions — it
  acts as whoever is signed in, never on its own).
- The app registration above, with its Client ID.
- Node.js 18+ if running locally.

## Local setup

```
cd backend
cp .env.example .env
# edit .env: set AZURE_CLIENT_ID to your app registration's Client ID,
# set SESSION_SECRET to a long random string,
# set PUBLIC_URL to http://localhost:3000, set COOKIE_SECURE=false
npm install
npm start
```

Open `http://localhost:3000`, click **Sign in with Microsoft**, log in
with an admin account. If you set up admin consent already (step 7
above), you'll go straight into the app.

## Deploying on Render

**Option A — Blueprint (recommended).** This repo includes a `render.yaml`
at its root. In Render: **New → Blueprint**, connect the repo, and Render
reads the file automatically — root directory, build command, start
command, and `NODE_ENV`/`COOKIE_SECURE` are already set. After it applies,
open the new service's **Environment** tab and fill in `AZURE_CLIENT_ID`
(from your app registration's Overview page) and, optionally, `PUBLIC_URL`
and `SITE_PASSWORD`. `SESSION_SECRET` is generated for you.

**Option B — by hand.**

1. Push this whole `m365-onboarding-app` folder (containing `backend/`
   and this README) to a GitHub repo.
2. In Render: **New → Web Service**, connect the repo.
3. Settings:
   | Field | Value |
   |---|---|
   | Root Directory | `backend` |
   | Runtime | Node |
   | Build Command | `npm install` |
   | Start Command | `npm start` |
4. Environment variables:
   | Key | Value |
   |---|---|
   | `AZURE_CLIENT_ID` | your app registration's Client ID |
   | `SESSION_SECRET` | a long random string |
   | `PUBLIC_URL` | `https://<your-render-app-name>.onrender.com` |
   | `COOKIE_SECURE` | `true` |
   | `SITE_PASSWORD` | optional shared access code, leave blank to disable |
5. Create the service, wait for the "M365 onboarding app is running"
   log line, then open the URL.

**`PUBLIC_URL` must exactly match the redirect URI you registered** in
the Entra admin center (including `https://`, no trailing slash). If
you rename the Render service or move to a custom domain, update both
the app registration's redirect URI and this env var together.

## A new permission was added (welcome email)

This added the `Mail.Send` scope so Create User can send the
account-creation notification automatically. If you're re-consenting
after the switch to a real app registration, this is already covered
by the "Grant admin consent" step above — nothing extra to do.

## Another new permission was added (Guest User)

This added `User.Invite.All` so the Guest User tab can create
external guest accounts. Same as above — covered by admin consent,
nothing extra needed if you followed the setup steps.

## Two more new permissions were added (Audit Trail, Mail activity)

This added `AuditLog.Read.All` (for the Audit Trail tab) and
`Reports.Read.All` (for the Mail tab's email activity report). Same
pattern as every permission before it — add them in API permissions
if setting this up fresh, or re-grant admin consent if updating an
existing deployment.

## Feature notes

- **Self-action warnings on the Account tab** — if you search for and
  select your own account in Manage User, three buttons now behave
  differently:
  - **Reset password** is blocked client-side with a clear message
    pointing to myaccount.microsoft.com / passwordreset.microsoftonline.com
    instead. This isn't just a UX nicety - Microsoft Graph actually
    refuses this one at the API level, even for Global Admins, as a
    deliberate security boundary (the admin password-reset API is for
    resetting *other* people's passwords, not your own). Previously
    this just surfaced as a confusing raw "Insufficient privileges"
    error; now it's explained upfront instead of being attempted.
  - **Disable account** and **Revoke active sessions** still work
    (Graph doesn't block these the same way), but show a specific
    warning first - disabling yourself locks you out and signs you
    out of the app immediately; revoking sessions does the same, since
    your current login counts as one of the active sessions.

- **Fixed a real bug in the SharePoint offboard cleanup step** —
  the direct-site-permission removal added last round had two bugs
  stacked together: (1) it called `.value` on an already-unwrapped
  array, meaning the cleanup silently never actually ran, and more
  seriously (2) that step wasn't wrapped in error handling the way
  group removal already was, so if it *did* throw for any reason, it
  would kill the entire offboard request - including session revoke
  and password reset, the actual lockout - even after group removal
  had already succeeded. Both are fixed: the array bug is corrected,
  and the whole step is now wrapped defensively at two levels so it
  can never block the security-critical steps, matching how group
  removal was already handled. **If you hit "Insufficient privileges"
  on an offboard attempt before this fix, re-run offboarding for that
  user to be safe** - they may have been left partially offboarded
  (groups removed, but sessions/password untouched).
- **Loading spinners added to search inputs** — Offboarding's user
  search now live-searches as you type with an animated spinner,
  matching the pattern Manage User's search already had. Onboarding's
  "Load licenses" / "Load groups" / site search buttons now show an
  animated spinner instead of static "Loading..." text while
  fetching.

- **Offboarding now closes a real gap: direct SharePoint access** —
  previously, offboarding only removed group memberships. That covers
  most SharePoint sites (they're group-backed), but sites someone was
  added to via the *direct-permission fallback* (used when a site
  isn't group-backed) kept that access even after being removed from
  every group. Offboard now also checks every SharePoint site in the
  tenant for a direct grant to that person and removes it, for both
  the single-user and bulk offboard flows (bulk just calls the same
  endpoint). This runs alongside group removal, not instead of it -
  it's checking a different, previously-unhandled path to access.

- **Help icons on every tab** — a small "?" next to each page title
  opens a modal explaining exactly what that tab does, section by
  section, matching what's actually built (not generic filler text).
- **Bulk onboard now assigns a license and can email each new hire
  directly** — added two things that were missing before:
  - Every bulk-onboarded account automatically gets a **Microsoft 365
    Business Standard** license, looked up by its real SKU ID in your
    tenant (never hardcoded — license IDs are tenant-specific). If
    your tenant doesn't have that SKU, accounts still get created,
    just without a license, and it's logged once rather than failing
    silently per row.
  - New optional CSV column, **PreferredEmail** — the new hire's own
    personal/external address. If provided, their credentials get
    emailed straight to them (reusing the same welcome-email endpoint
    the single-user flow uses). Everyone else's temp password still
    comes back in the downloadable results CSV at the end, same as
    before.
- **Bulk offboard now downloads a results CSV too** — Email + Status
  for every row, once the run finishes, matching the same
  paper-trail pattern bulk onboard already had. Useful for HR/audit
  records since this is a destructive bulk action.

- **Distro List tab** — group-centric management, the inverse of
  Manage User's approach. Search for a group, see its type, members,
  and owners, add/remove either, and rename the group (display name,
  optionally the mail nickname/email alias too — kept as a separate
  opt-in field since changing the email address is more disruptive
  than a display name change alone).
- **Bulk CSV operations** — added to all four relevant tabs, each one
  reusing the same single-item endpoint the manual version uses
  (looped per row) rather than needing separate bulk-specific backend
  logic:
  - **Bulk onboard** (Onboarding tab) — creates every account in a
    CSV (FirstName, LastName, Username, Department, UsageLocation).
    No per-account email preview like the single-user flow has (that
    wouldn't scale to reviewing dozens one at a time), so temp
    passwords are collected and handed back as one downloadable CSV
    at the end instead - that file has plaintext passwords, so it
    should be stored securely and deleted once distributed. Licenses,
    groups, and welcome emails aren't part of the bulk run - assign
    those afterward once accounts exist.
  - **Bulk offboard** (Offboarding tab) — runs the full single-user
    offboard flow (remove all groups, revoke sessions, silent
    password reset, mark for 30-day license removal) for every email
    in a CSV.
  - **Bulk manage users** (Manage User tab) — pick one action (reset
    password / enable / disable), then apply it to every email in a
    CSV. Reset password emails each user their new temp password
    automatically, same as the single-user action.
  - **Bulk manage groups** (Distro List tab) — add or remove many
    people across many different groups in one file (GroupName,
    Email, Action columns), since membership changes often span more
    than one group at a time.
  - Every bulk section has a **"Download sample CSV"** button showing
    the exact expected columns and format, a preview after upload
    (row count + first few rows) before anything runs, a confirmation
    step, and a live per-row success/failure log so partial failures
    are visible individually rather than silently swallowed.

- **Accessibility fixes** — closed the loop on an earlier WCAG 2.1 AA
  audit that had identified real issues but never got fixed:
  - Darkened `--blue`/`--green`/`--amber` for light mode - the
    originals measured 3.2-4.3:1 contrast against white/light
    backgrounds (below the 4.5:1 minimum for normal text); now ~5.2-6.1:1.
    Dark mode keeps the more vivid originals since those already passed.
  - The Create User username field had its focus outline explicitly
    removed with no replacement - keyboard users literally couldn't
    see where they were. Fixed, plus added a global visible focus
    ring (`:focus-visible`) on every interactive element site-wide.
  - All three modals (confirm, drill-down list, email preview) can
    now be closed with Escape, move focus into themselves on open,
    and return focus to whatever triggered them on close - previously
    none of that existed.
  - Added `role="dialog"`, `aria-modal`, and `aria-labelledby` to all
    three modals; `aria-label` on all four sidebar `<nav>` landmarks
    (previously indistinguishable to screen-reader landmark
    navigation); `aria-current="page"` on the active sidebar tab;
    `aria-live="polite"` on six result boxes so screen readers
    announce action outcomes automatically.
  - Touch targets (small buttons, modal close buttons, chip remove
    buttons) now hit the 44×44px WCAG minimum on touch devices
    specifically, without changing the denser desktop/mouse sizing.
  - Every decorative emoji throughout the app (nav icons, menu icons,
    export card icons, modal close ✕) is now wrapped in
    `aria-hidden="true"` so screen readers skip announcing their
    Unicode names redundantly next to the actual text label.

- **New "Groups & DLs" trend chart** on the dashboard, alongside the
  existing "New users" chart — accounts created per day, last 14 days,
  using each group's real `createdDateTime` from Graph (same kind of
  genuine data as the users chart, no Premium license needed for this
  one either). Styled in purple/magenta to visually pair with the
  "Groups by type" donut above it. The chart renderer itself was
  generalized to support any number of these trend charts (each with
  its own colors and hover tooltips) rather than being hardcoded to
  just the users chart.

- **Modernization pass (no framework change)** — the app stays plain
  HTML/CSS/JS with zero build step, but picked up several "modern
  SaaS" polish details:
  - **Toast notifications** replace every native browser `alert()` -
    those jarring system popups are gone, swapped for slide-in
    notifications in the top-right corner that auto-dismiss.
  - **Skeleton loading states** on Audit Trail, Mail activity, and
    Pending License Removals - shimmering placeholder rows instead of
    a bare spinner while data loads.
  - **Inter typeface** loaded from Google Fonts, replacing the generic
    system font stack, with system fonts still as fallback if the
    Google Fonts request is blocked/slow.
  - **Glassmorphic modal backdrop** - the dark overlay behind
    confirmation/preview modals now blurs the content behind it
    instead of just dimming it.

- **Dashboard KPI cards redesigned** — the four top stat cards (Total
  users, Groups & DLs, SharePoint sites, Licenses available) are now
  bold full-color gradient blocks with white text, styled after a
  denser "pro admin dashboard" aesthetic. Total Users keeps its real
  sparkline, now drawn as a mini bar chart instead of a line, using
  each day's actual new-account count (not cumulative, not
  fabricated). The other three don't get a sparkline since there's no
  real historical data behind them - same "don't decorate with fake
  data" rule as everywhere else in this app.
- **Sidebar tightened** — smaller logo/text, tighter padding between
  nav items and section groups, denser overall rhythm instead of the
  more spaced-out original layout.
- **List panels redesigned** — Recently Added, Audit Trail, and
  Pending License Removals now use thin divider lines between rows
  instead of individual rounded/bordered cards per row, matching a
  denser "admin dashboard" list style. All three, plus the chart and
  donut cards, got a consistent bottom-border under their header so
  the title/controls area is visually separated from the content below.

- **Audit Trail** — pulls Entra ID's directory audit log (user, group,
  app, and device changes made through the admin portal or Graph API).
  Unlike sign-in logs, this one is **not** gated behind an Entra ID
  Premium license, so it should work on Business Standard. Retention
  is typically ~30 days without an Audit Premium add-on — older
  activity just won't show up, not an error.
- **Mail tab** — two honest pieces, not one fake one:
  - *Email activity report*: real, Graph-backed, aggregate per-user
    send/receive/read counts over 7/30/90 days.
  - *Message trace & mail flow rules*: **not buildable in this app**.
    Microsoft Graph has no API for per-message trace (looking up an
    individual email's sender/recipient/subject/delivery status), nor
    for Exchange transport rules or anti-spam/blocked-sender policies.
    These are Exchange-specific admin center features with no Graph
    equivalent at all — not a permissions gap, a genuine API gap. The
    tab links directly to the real tools instead of faking a feature
    that would silently do nothing.
- **Settings** — text size (90–130%, applied via CSS zoom on the main
  content area, not the sidebar), 6 background presets (light + dark
  variants of each), and a language toggle (English/Filipino) that
  translates the sidebar nav and page titles. Search results, error
  messages, exported files, and other generated content stay in
  English — translating dynamically-generated content is a much
  larger effort than static UI labels and wasn't in scope for this pass.


- **Browser tab icon** — added a proper favicon (the sunburst/triangle
  mark only, not the full "MIDC PHILTOWER" wordmark - icon marks read
  far better than a wide logo at the tiny 16-32px size browser tabs
  actually render).
- **Guest User tab** — adds an external person (contractor, vendor,
  partner) as a real guest in your directory via Microsoft's B2B
  invitation API, with the invitation email explicitly suppressed
  (`sendInvitationMessage: false`). They exist in the directory in
  "PendingAcceptance" state and can optionally be added to groups, but
  nothing is sent to them or tells them this happened - that's on you
  to do separately if/when you want them to actually get access.
- **Auto-domain onboarding** — Create User's UPN field is now just a
  "Username" box with your own domain auto-filled next to it (derived
  from whichever admin is currently signed in - e.g. signing in as
  `allen.ellazar@philtower.net` means new accounts default to
  `...@philtower.net`). Typing a first/last name auto-suggests
  `firstname.lastname` as the username, but typing your own overrides
  the suggestion and stops it from changing further. This only applies
  to Create User - Guest User still asks for a real external email
  since guests use their own existing identity, not one this app creates.
- **Chart annotation sizing** — the "New users" chart's peak-day badge
  now sizes itself off the full label text (count + date) instead of
  just the number, so longer dates don't get visually clipped.

- **Password reset now emails the user** — when you reset someone's
  password from Manage User → Account, they get an email at their own
  address with the new temporary password, separate from the
  standing-recipient "new account created" email. If they have no
  mail address, or the send fails, the reset itself still succeeds -
  the result box tells you whether the notification actually went out.
- **Offboarding tab** — select a user and one click:
  1. Removes them from every group/DL they belong to
  2. Revokes all their active sessions
  3. Resets their password to a random value that is *not* sent to
     them (a lockout, not a handoff)
  4. Schedules their license(s) for removal in 30 days

  **Important limitation, read before relying on this**: step 4 does
  *not* fire on its own 30 days later. This app only has a valid
  Microsoft login while an admin is actively signed in - there's no
  background process with credentials to act unattended. Building
  true unattended automation would require app-only/client-credentials
  auth, which means a real Azure app registration *with a client
  secret* - the exact thing this whole app has been built to avoid.

  Instead, the 30-day due date is written directly onto the user's
  Entra ID record (`onPremisesExtensionAttributes.extensionAttribute1`)
  so it survives this app restarting or being redeployed - it's not
  stored anywhere fragile on this app's own server. The Offboarding
  tab's "Pending license removals" list shows everyone due, and
  someone has to actually click "Remove license now" (or "Process all
  due now") to carry it out. **Make checking this tab periodically
  part of your offboarding routine** - nothing here reminds you on its
  own; there's no notification when something becomes due.


- **Dashboard visual refresh** — modeled after a modern SaaS dashboard
  layout: the Total Users card now shows a real trend sparkline
  (cumulative new-user growth) and a "+N last 30 days" delta, and
  there's a new donut chart breaking down Groups & DLs by type
  (Microsoft 365 Group / Security / Mail-enabled Security /
  Distribution). Both use real data already being fetched - no
  fabricated trend lines on cards where historical data doesn't
  actually exist (Groups, Sites, and Licenses totals are current
  snapshots only, so they intentionally don't get a fake sparkline).
  The "New users" chart also now calls out its peak day with a
  permanent annotation bubble, not just on hover.
- **Tab-switch animation** — clicking any sidebar tab (Dashboard,
  Manage User, Create User, Export) now reliably replays a fade+slide
  transition every time, even switching back to a tab you were just
  on - previously the animation could silently not re-fire depending
  on the browser. Nav buttons also get a small press animation on click.


- **Search/filter bars** — the License, Groups, and SharePoint sites
  lists in Create User, and the group picker in Export's "one specific
  group" card, all have a filter box now. It's a client-side filter
  over whatever's already loaded (instant, no extra requests) - load
  or search first, then narrow with the filter.
- **Welcome email — reviewed before sending, not automatic** — after
  Create User finishes creating the account and applying the selected
  license/group/site assignments, it shows a preview modal (To, CC,
  Subject, and the full body with the real address/temp password
  filled in) with **Send email** / **Don't send** buttons. Nothing
  goes out until you click Send.
  - **Recipients are editable, Outlook-style** — the To/CC fields
    start pre-filled with the standing list below, but you can remove
    anyone (✕ on their chip) or add more: type a name to search your
    tenant's directory and click a match, or type a full email address
    and press Enter/comma to add someone outside the directory
    (matters here, since the default CC address is on a different
    domain than your own tenant and won't show up in directory
    search). At least one To recipient is required to send.
  - **Who it's sent as**: Microsoft Graph's mail-send API always
    sends as whichever admin is signed into this app right now - there's
    no way to send as a generic "IT Department" address from here
    unless that's set up separately as a shared mailbox with its own
    permissions (not implemented). The email will show your name as
    the sender even though the signature says "IT Department."
  - **Who it's sent to by default**: hardcoded in `backend/routes/users.js` at
    the top (`WELCOME_EMAIL_TO` / `WELCOME_EMAIL_CC`) - currently
    `monica.fortu@philtower.net` and `pbgono@midc.ph` on To, with
    `ict.department@philtower.midc.ph` on CC. Edit that file directly
    to change the list; it's not an env var since it's specific
    content, not per-deployment config. The preview always reflects
    whatever's currently in those two constants.
  - **If it fails, or you click Don't send**: either way, the account
    creation and any license/group/site assignments already succeeded
    and stay in place - Create User's result log just notes whether
    the email went out, was skipped, or failed, separately from
    everything else that already succeeded.


- **About MFA (Microsoft Authenticator, OTP, etc.)** — this isn't
  something the app builds or controls. Whatever MFA method your
  tenant has configured for an account gets prompted automatically by
  Microsoft's own sign-in page as part of the redirect flow - there's
  no separate "MFA feature" here, it's just part of the normal
  Microsoft sign-in this app hands off to.

- **Export a single group or site** — separate from the "export
  everything" buttons, you can pick one specific group/DL or one
  specific SharePoint site and export just that one:
  - **One group/DL** → every member and owner, each tagged Owner or
    Member, instead of the whole tenant's group list.
  - **One SharePoint site** → the site's access/permissions list
    (who has access and their role). SharePoint doesn't have a
    uniform "owner/member" concept the way groups do, so this reports
    whatever Graph's permissions API returns for that site rather
    than forcing it into a group-shaped answer that wouldn't always
    be accurate.

- **Dashboard cards are clickable** — Total Users, Groups & DLs,
  SharePoint Sites, and Licenses Available each open a filterable
  drill-down list (all data comes from the same dashboard fetch, so
  opening one is instant — no extra loading). Licenses shows the full
  per-SKU breakdown (assigned / available / total), not just the
  headline number.
- **SharePoint sites count was fixed** — it previously used a Graph
  action (`/sites/getAllSites`) that some tenants deny even to Global
  Admins for reasons outside this app's control. Switched to the same
  search-based site listing (`/sites?search=*`) already used
  elsewhere in the app and proven to work. If you still see an
  "Access denied" banner for a *different* section after this update,
  it'll now name that specific section so it's easy to tell what
  actually failed instead of the whole dashboard going blank.
- **Interactive chart** — hover any point on the "New users" chart for
  an exact date + count tooltip.

- **Dashboard** (default landing tab) — total users, groups & distro
  lists, SharePoint sites, and available license seats at a glance,
  plus a "new users per day" chart for the last 14 days and a
  "Recently added" list of the newest accounts. The chart uses each
  user's `createdDateTime` — the only genuine historical trend Graph
  exposes without a Premium license, so nothing here is simulated.
  Dashboard data is cached per session; switch tabs and back to reload
  without waiting again, or refresh the page to force a re-pull.
- **Live search** — Manage User's search box queries as you type
  (debounced ~250ms) so results usually show before you finish typing;
  the explicit Search button / Enter key still work the same as before.
- **Loading indicators** — spinners now show during dashboard load,
  profile lookup, and CSV export generation, since exports in
  particular can take a few seconds on larger tenants.
- **Sidebar** — the active section now has a solid highlight with a
  left accent bar, and the sidebar itself has a visible border/shadow
  separating it from the content area.

- **Sidebar navigation** — Manage User / Create User / Export live in
  a left sidebar (dark, fixed) rather than top tabs, with your
  signed-in name, role, a dark/light mode toggle, and sign out grouped
  there too.
- **Find a user** — search by name or email; if more than one person
  matches, you'll get a picker list to choose from.
- **Manage User** is organized as a left-hand menu (Account, Licenses,
  Groups & DLs, SharePoint Sites, Contact Info) under the selected
  person's profile strip. This covers the features built into this
  tool — not the full breadth of Microsoft 365 admin center, which is
  enormous. More sections can be added the same way if needed.
- **Contact Info** — same fields as the Microsoft 365 admin center's
  "Manage contact information" panel: first/last/display name, job
  title, department, office, office phone, mobile phone, and full
  address. Loads pre-filled with the person's current values. One
  honest gap: there's no "fax number" field, because Microsoft Graph's
  user resource doesn't actually have one — the admin center's fax
  field doesn't map to a real Graph property, so it's left out rather
  than wired to something that would silently fail to save. Their
  sign-in email/UPN is unchanged here — renaming the UPN itself is a
  bigger operation with more side effects and isn't included.
- **Export** — lives under the Settings tab now (below Text size,
  Background, and Language), not its own sidebar item. Same downloads
  as before:
  - *All users* — name, email, department, account status, and
    assigned license(s) for everyone in the tenant.
  - *All groups & distribution lists* — every group Graph can see,
    labeled by type. Classic Exchange distribution lists (not
    mail-enabled security groups) still can't be read via Graph, same
    limitation as the rest of this app.
  - *All SharePoint sites* — name and URL for every site in the tenant.
  
  Exports run one Graph call per item for some fields (e.g. per-user
  license lookups), so a very large tenant will take longer — fine for
  a small team's scale, not built for tens of thousands of users.
- **Revoke active sessions** — a standalone action separate from
  disabling the account, for cases like a lost device where the
  account should stay enabled but get signed out everywhere right now.
- **Reset password** — generates a secure temporary password (or
  accepts one you type) and forces a change at next sign-in.
- **Enable / disable account** — disabling also revokes active sign-in
  sessions, so it's a real offboarding kill switch, not just cosmetic.
- **Groups** — covers Microsoft 365 Groups, security groups, and
  mail-enabled security groups.
- **SharePoint sites** — now shows the user's *current* site
  membership (not just a way to add new ones), clickable links to
  each site. Resolved by cross-referencing their Microsoft 365 Group
  memberships against `/groups/{id}/sites/root`, since group-backed
  team sites are what most SharePoint sites actually are - a group
  without a provisioned site yet just won't contribute one, silently
  (not an error). Removing site access happens by removing the
  underlying group membership on the Groups & DLs tab, since that's
  what actually controls access for group-backed sites - there's no
  separate "remove from site" action to keep in sync with that.
  Adding to a *new* site still works the same as before: search by
  name/keyword, adds via the site's underlying Microsoft 365 Group
  (most team sites) or a direct Read permission as a fallback.
- **Licenses** — reads your tenant's actual subscribed SKUs and shows
  friendly names for Business Standard/Premium/Basic. Assigning a
  license requires the user to have a `usageLocation` set (e.g. `US`)
  — the form includes that field if it hasn't been set yet.
- **Create User** — collects first/last name, UPN, department, and
  optional license/group/SharePoint site assignments in one form.
- Destructive or modifying actions (reset password, disable account,
  revoke sessions, remove from group, remove license) require a
  confirmation dialog before they run — adding things (license, group,
  site) stays single-click since it's low-risk.

## If sign-in fails or shows an AADSTS error

**"The reply URL specified in the request does not match..." /
AADSTS50011**: your `PUBLIC_URL` env var doesn't exactly match the
redirect URI registered on the app registration. Both need to be
identical, including `https://` and no trailing slash. Check
**App registrations → your app → Authentication → Redirect URIs**.

**Blocked or "does not meet the criteria to access this resource"**:
this is Microsoft's own Conditional Access policy blocking the
sign-in, not this app - it means an admin's account or the sign-in
context (device, location, etc.) doesn't satisfy a policy your org has
in place. Click **"More details"** on the error screen for the
specific policy name, or check with whoever manages Conditional Access.

**Consent prompt won't go away / permissions not granted**: re-run the
"Grant admin consent" step in **API permissions** on the app
registration - a Global Admin needs to do this once after any new
scope is added (see the permission-added notes below).

**Session expired**: sessions last about 2 hours (see "Session length"
below) - just sign in again.

For any other `AADSTS...` error code, that's Microsoft's own error
identifier - searching it directly usually gives the clearest answer,
or check the Render **Logs** tab for the full error detail logged
around the time of the failed sign-in.

## Known limitation: classic Exchange distribution lists

If your "distribution lists" are **classic Exchange DLs** (not
mail-enabled security groups), Microsoft Graph genuinely cannot manage
those — they're an Exchange-only object type with no Graph API.
Check which kind you have:

- **Mail-enabled security groups / Microsoft 365 Groups** → fully
  supported by this app's Groups card.
- **Classic distribution lists** → not reachable via Graph. Options:
  migrate them to mail-enabled security groups, or add an Exchange
  Online PowerShell bridge (not included here — ask if you want this
  added).

## Session length

Sign-in sessions last about 2 hours before you'll need to sign in
again. That's intentional for an admin tool — there's no silent
background token refresh.

## Installing it as a mobile app

The app is a **PWA** (progressive web app) — no app store, no developer
account, no review process, nothing to pay. Same code, same Render
deployment, same sign-in as the desktop site; the only difference is it
installs to the home screen and opens without browser bars.

**Android (Chrome):** open the site → a "📲 Install app" button appears
in the sidebar menu automatically (Chrome offers this itself, this app
just gives it a visible button instead of waiting for Chrome's own
banner) → tap it → tap Install. Alternatively: ⋮ menu → "Add to Home
screen" / "Install app".

**iPhone/iPad (Safari):** Apple doesn't let any app trigger this
programmatically — open the site in Safari specifically (not Chrome on
iOS, it can't do this) → tap the Share icon → "Add to Home Screen" → Add.

**Desktop (Chrome/Edge):** an install icon appears in the address bar
itself; click it, or the same sidebar button works there too.

Once installed, it behaves like a normal app: its own icon, opens full
screen, shows a branded offline page instead of a browser error when
there's no signal, and updates itself automatically the next time it's
opened after you deploy a change — nothing for anyone to manually
update or reinstall.
