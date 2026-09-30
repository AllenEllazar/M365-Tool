let currentOverview = null;
let adminDomain = null;
let signedInUpn = null;

// ================= PWA: install to home screen =================
// Chrome/Edge/Android fire this instead of installing immediately, so the
// prompt can be shown from our own button rather than a browser-owned one.
// Safari (iOS) never fires it — there, "Add to Home Screen" is a manual
// step from the browser's share sheet, which the settings panel explains.
let deferredInstallPrompt = null;

function installButtons() {
  const btns = Array.from(document.querySelectorAll("[data-install-btn]"));
  const sidebar = document.getElementById("installAppBtn");
  if (sidebar) btns.push(sidebar);
  return btns;
}

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  installButtons().forEach((b) => (b.hidden = false));
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  installButtons().forEach((b) => (b.hidden = true));
});

async function installApp() {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButtons().forEach((b) => (b.hidden = true));
}

// Lets the Install tab put a "this looks like your device" badge on the
// right card. Purely cosmetic — all three cards' instructions stay visible
// and correct regardless, this just saves someone hunting for their own.
function markLikelyDevice() {
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /Android/.test(ua);
  const id = isIOS ? "installBadgeIos" : isAndroid ? "installBadgeAndroid" : "installBadgeDesktop";
  const badge = document.getElementById(id);
  if (badge) badge.hidden = false;
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* Offline support is a nice-to-have; a failed registration (e.g. an
         unsupported browser) shouldn't block the app from working online. */
    });
  });
}

// ================= Mobile menu (phone-width sidebar drawer) =================

function openMobileMenu() {
  document.getElementById("appSidebar")?.classList.add("open");
  document.getElementById("sidebarBackdrop")?.classList.add("show");
  document.getElementById("mobileMenuBtn")?.setAttribute("aria-expanded", "true");
  document.body.classList.add("menu-open");
}

function closeMobileMenu() {
  document.getElementById("appSidebar")?.classList.remove("open");
  document.getElementById("sidebarBackdrop")?.classList.remove("show");
  document.getElementById("mobileMenuBtn")?.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
}

function toggleMobileMenu() {
  const isOpen = document.getElementById("appSidebar")?.classList.contains("open");
  if (isOpen) closeMobileMenu();
  else openMobileMenu();
}

// The four sections with a dedicated bottom-tab icon; anything opened from
// the "Menu" drawer (Distro List, Guest User, Audit, Mail, Settings) just
// leaves the bottom bar showing Menu as active, since it has no tab of its own.
const MOBILE_TAB_IDS = ["dashboard", "manage", "create", "offboarding"];
const MOBILE_TAB_TITLES = {
  dashboard: "Dashboard", manage: "Manage User", distro: "Distro List", create: "Onboarding",
  offboarding: "Offboarding", guest: "Guest User", audit: "Audit Trail", mail: "Mail",
  install: "Install App", settings: "Settings",
};

markLikelyDevice();

function syncMobileNav(name) {
  const titleEl = document.getElementById("mobileTitle");
  if (titleEl) titleEl.textContent = MOBILE_TAB_TITLES[name] || "";

  document.querySelectorAll(".mobile-tab[data-tab]").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  const menuBtn = document.getElementById("mobileMenuBtn");
  if (menuBtn) menuBtn.classList.toggle("active", !MOBILE_TAB_IDS.includes(name));

  closeMobileMenu();
}

async function init() {
  applyThemeIcon();
  initSettingsUI();

  const res = await fetch("/auth/me");
  const data = await res.json();

  document.getElementById("loadingScreen").hidden = true;

  if (data.signedIn) {
    document.getElementById("signedOutView").hidden = true;
    document.getElementById("appView").hidden = false;
    const name = data.name || data.username;
    document.getElementById("whoami").textContent = name;
    document.getElementById("sidebarInitials").textContent = initials(name);
    document.getElementById("tab-dashboard").classList.add("tab-anim-play");

    // Derive the onboarding domain from whichever admin is signed in
    // right now (e.g. allen.ellazar@philtower.net -> philtower.net) so
    // Create User only needs a username, not a full email typed by hand.
    // Also keep the full UPN itself, to detect when an admin action in
    // Manage User targets their own account (Graph blocks some of
    // these, and others would just be a bad idea via this tool).
    if (data.username && data.username.includes("@")) {
      adminDomain = data.username.split("@")[1];
      signedInUpn = data.username.toLowerCase();
      const domainEl = document.getElementById("newUpnDomain");
      if (domainEl) domainEl.textContent = "@" + adminDomain;
    }

    loadDashboard();
  } else {
    document.getElementById("signedOutView").hidden = false;
    document.getElementById("appView").hidden = true;
  }
}

/* ================= Theme toggle ================= */

function toggleTheme() {
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (isDark) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("theme", "light");
  } else {
    document.documentElement.setAttribute("data-theme", "dark");
    localStorage.setItem("theme", "dark");
  }
  applyThemeIcon();
}

function applyThemeIcon() {
  const btn = document.getElementById("themeToggle");
  const icon = document.getElementById("themeIcon");
  const label = document.getElementById("themeLabel");
  if (!btn) return;
  const isDark = document.documentElement.getAttribute("data-theme") === "dark";
  if (icon) icon.textContent = isDark ? "☀️" : "🌙";
  if (label) label.textContent = isDark ? "Light mode" : "Dark mode";
}

/* ================= Tabs ================= */

function switchTab(name) {
  document.querySelectorAll(".side-nav-item[data-tab]").forEach((b) => {
    const isActive = b.dataset.tab === name;
    b.classList.toggle("active", isActive);
    if (isActive) {
      b.setAttribute("aria-current", "page");
    } else {
      b.removeAttribute("aria-current");
    }
  });

  ["dashboard", "manage", "distro", "create", "offboarding", "guest", "audit", "mail", "install", "settings"].forEach((tabName) => {
    const el = document.getElementById(`tab-${tabName}`);
    if (tabName === name) {
      el.hidden = false;
      // Restart the CSS animation every click, even if this tab was
      // already shown before - remove the class, force a reflow, then
      // re-add it so the browser treats it as a fresh animation.
      el.classList.remove("tab-anim-play");
      void el.offsetWidth;
      el.classList.add("tab-anim-play");
    } else {
      el.hidden = true;
    }
  });

  if (name === "dashboard") loadDashboard();
  if (name === "offboarding") loadPendingOffboarding();
  if (name === "audit") loadAuditLog();

  syncMobileNav(name);
}

window.addEventListener("resize", () => {
  if (window.innerWidth > 820) closeMobileMenu();
});

/* ================= Dashboard tab ================= */

let dashboardLoaded = false;
let lastDashboardData = null;
let currentListModalItems = [];
let currentListModalRenderFn = null;

// Which company's license figure the dashboard card shows: Philtower ->
// Business Standard, MIDC -> E3. Remembered per browser so it doesn't
// reset every time someone reopens the dashboard.
let licenseContext = localStorage.getItem("licenseContext") || "philtower";

function setLicenseContext(context) {
  licenseContext = context;
  localStorage.setItem("licenseContext", context);

  document.querySelectorAll(".license-tab").forEach((tab) => {
    const active = tab.dataset.context === context;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  const numberEl = document.getElementById("statLicensesAvailable");
  const labelEl = document.getElementById("statLicensesLabel");
  if (!numberEl || !labelEl) return;

  if (!lastDashboardData) {
    numberEl.textContent = "—";
    return;
  }

  if (context === "midc") {
    numberEl.textContent = lastDashboardData.e3Available ?? "—";
    labelEl.textContent = "E3 available";
  } else {
    numberEl.textContent = lastDashboardData.businessStandardAvailable ?? "—";
    labelEl.textContent = "Business Standard available";
  }
}

async function loadDashboard() {
  if (dashboardLoaded) return; // cached for the session; data doesn't change fast
  dashboardLoaded = true;

  const chartBox = document.getElementById("newUsersChart");
  const groupsChartBox = document.getElementById("newGroupsChart");
  const warnBox = document.getElementById("dashboardWarning");
  chartBox.innerHTML = '<div class="loading-row"><span class="spinner"></span> Loading dashboard...</div>';
  groupsChartBox.innerHTML = '<div class="loading-row"><span class="spinner"></span> Loading...</div>';
  warnBox.hidden = true;

  try {
    const data = await api("/api/dashboard/summary");
    lastDashboardData = data;

    setStat("statTotalUsers", data.totalUsers);
    setStat("statTotalGroups", data.totalGroups);
    setStat("statTotalSites", data.totalSites);
    setLicenseContext(licenseContext);
    setStat("statNewUsers30", data.newUsersLast30);
    setStat("statNewGroups30", data.newGroupsLast30);

    if (data.errors && data.errors.length > 0) {
      const parts = data.errors.map((e) => `${sectionLabel(e.section)}: ${e.error}`);
      warnBox.innerHTML = `⚠️ Some dashboard data couldn't load — ${escapeHtml(parts.join(" · "))}`;
      warnBox.hidden = false;
    }

    const usersFailed = data.errors && data.errors.some((e) => e.section === "users");
    if (usersFailed) {
      chartBox.innerHTML = '<p class="muted">User data unavailable — see the notice above.</p>';
      document.getElementById("recentUsersList").innerHTML =
        '<p class="muted">User data unavailable — see the notice above.</p>';
      document.getElementById("statUsersSparkline").innerHTML = "";
      document.getElementById("statUsersDelta").textContent = "";
    } else {
      renderTrendChart("newUsersChart", data.newUsersByDay, {
        primaryColor: "var(--blue)",
        secondaryColor: "#7c3aed",
        unitLabel: "new user",
      });
      renderRecentUsers(data.recentUsers);
      renderUsersSparkline(data.newUsersByDay);
      const delta = document.getElementById("statUsersDelta");
      delta.innerHTML = `<span class="delta-up">↗ +${data.newUsersLast30}</span> last 30 days`;
    }

    const groupsFailed = data.errors && data.errors.some((e) => e.section === "groups");
    renderGroupTypeDonut(groupsFailed ? null : data.allGroups);

    if (groupsFailed) {
      groupsChartBox.innerHTML = '<p class="muted">Group data unavailable — see the notice above.</p>';
    } else {
      renderTrendChart("newGroupsChart", data.newGroupsByDay, {
        primaryColor: "#9333ea",
        secondaryColor: "#db2777",
        unitLabel: "new group",
      });
    }
  } catch (err) {
    dashboardLoaded = false;
    chartBox.innerHTML = `<p class="muted">Error loading dashboard: ${escapeHtml(err.message)}</p>`;
    groupsChartBox.innerHTML = "";
  }
}

function renderUsersSparkline(days) {
  const box = document.getElementById("statUsersSparkline");
  if (!days || days.length === 0) {
    box.innerHTML = "";
    return;
  }

  // Bars use each day's own count (not cumulative) - real daily data,
  // no fabrication - styled as a mini bar sparkline against the color
  // block, similar to the reference theme's KPI card sparklines.
  const w = 90, h = 32, gap = 1.5;
  const barW = (w - gap * (days.length - 1)) / days.length;
  const maxVal = Math.max(1, ...days.map((d) => d.count));

  const bars = days
    .map((d, i) => {
      const x = i * (barW + gap);
      const barH = Math.max(2, (d.count / maxVal) * h);
      const y = h - barH;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${barH.toFixed(1)}" rx="1" class="sparkline-bar" />`;
    })
    .join("");

  box.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" class="sparkline-svg" preserveAspectRatio="none">
      ${bars}
    </svg>
  `;
}

function renderGroupTypeDonut(allGroups) {
  const box = document.getElementById("groupTypeDonut");
  if (!allGroups) {
    box.innerHTML = '<p class="muted">Group data unavailable — see the notice above.</p>';
    return;
  }
  if (allGroups.length === 0) {
    box.innerHTML = '<p class="muted">No groups found.</p>';
    return;
  }

  const counts = {};
  allGroups.forEach((g) => {
    counts[g.type] = (counts[g.type] || 0) + 1;
  });

  const colorMap = {
    "Microsoft 365 Group": "#4f6df5",
    "Security group": "#7c3aed",
    "Mail-enabled security group": "#0ea5a4",
    "Distribution group": "#f59e0b",
    Other: "#9aa2b4",
  };

  const total = allGroups.length;
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);

  const radius = 40, cx = 50, cy = 50, circumference = 2 * Math.PI * radius;
  let offset = 0;
  const segments = entries
    .map(([type, count]) => {
      const fraction = count / total;
      const dash = fraction * circumference;
      const seg = `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none"
          stroke="${colorMap[type] || colorMap.Other}" stroke-width="14"
          stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
          stroke-dashoffset="${(-offset).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})" />`;
      offset += dash;
      return seg;
    })
    .join("");

  const legend = entries
    .map(
      ([type, count]) => `
      <div class="donut-legend-row">
        <span class="donut-legend-dot" style="background:${colorMap[type] || colorMap.Other}"></span>
        <span class="donut-legend-label">${escapeHtml(type)}</span>
        <span class="donut-legend-count">${count}</span>
      </div>`
    )
    .join("");

  box.innerHTML = `
    <div class="donut-chart-row">
      <svg viewBox="0 0 100 100" class="donut-svg">${segments}
        <text x="50" y="46" text-anchor="middle" class="donut-total-number">${total}</text>
        <text x="50" y="60" text-anchor="middle" class="donut-total-label">groups</text>
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

function setStat(id, value) {
  document.getElementById(id).textContent = value === null || value === undefined ? "—" : value;
}

function sectionLabel(section) {
  const labels = {
    users: "Users",
    groups: "Groups & DLs",
    sites: "SharePoint sites",
    licenses: "Licenses",
  };
  return labels[section] || section;
}

/* ---- Dashboard drill-down modals ---- */

function openStatModal(kind) {
  if (!lastDashboardData) return;
  const d = lastDashboardData;

  let title, items, renderFn;

  if (kind === "users") {
    title = `All users${d.allUsers ? " (" + d.allUsers.length + ")" : ""}`;
    items = d.allUsers;
    renderFn = (u) => `
      <div class="list-modal-row">
        <div class="avatar avatar-small">${escapeHtml(initials(u.displayName))}</div>
        <div class="list-modal-text">
          <div class="list-modal-primary">${escapeHtml(u.displayName)}</div>
          <div class="muted">${escapeHtml(u.userPrincipalName)}</div>
        </div>
      </div>`;
  } else if (kind === "groups") {
    title = `All groups & distribution lists${d.allGroups ? " (" + d.allGroups.length + ")" : ""}`;
    items = d.allGroups;
    renderFn = (g) => `
      <div class="list-modal-row">
        <div class="list-modal-text">
          <div class="list-modal-primary">${escapeHtml(g.displayName)}</div>
          <div class="muted">${escapeHtml(g.type)}</div>
        </div>
      </div>`;
  } else if (kind === "sites") {
    title = `All SharePoint sites${d.allSites ? " (" + d.allSites.length + ")" : ""}`;
    items = d.allSites;
    renderFn = (s) => `
      <div class="list-modal-row">
        <div class="list-modal-text">
          <div class="list-modal-primary">${escapeHtml(s.displayName)}</div>
          ${s.webUrl ? `<a class="muted list-modal-link" href="${escapeHtml(s.webUrl)}" target="_blank" rel="noopener">${escapeHtml(s.webUrl)}</a>` : ""}
        </div>
      </div>`;
  } else if (kind === "licenses") {
    title = "License breakdown";
    items = d.skuList;
    renderFn = (s) => `
      <div class="list-modal-row">
        <div class="list-modal-text">
          <div class="list-modal-primary">${escapeHtml(s.friendlyName)}</div>
          <div class="muted">${s.consumed} assigned · ${s.available} available · ${s.total} total</div>
        </div>
      </div>`;
  } else {
    return;
  }

  currentListModalItems = items || [];
  currentListModalRenderFn = renderFn;

  document.getElementById("listModalTitle").textContent = title;
  document.getElementById("listModalFilter").value = "";
  document.getElementById("listModalFilter").hidden = !items || items.length === 0;

  if (!items) {
    const err = (d.errors || []).find((e) => e.section === kind);
    document.getElementById("listModalBody").innerHTML =
      `<p class="muted">${escapeHtml(err ? err.error : "Data unavailable.")}</p>`;
  } else {
    renderListModalRows(items);
  }

  document.getElementById("listModal").hidden = false;
  lastFocusedBeforeModal = document.activeElement;
  document.getElementById("listModalFilter").hidden
    ? document.getElementById("listModal").querySelector(".modal-close-btn").focus()
    : document.getElementById("listModalFilter").focus();
}

function renderListModalRows(items) {
  const body = document.getElementById("listModalBody");
  if (!items || items.length === 0) {
    body.innerHTML = '<p class="muted">No results.</p>';
    return;
  }
  body.innerHTML = items.map(currentListModalRenderFn).join("");
}

function filterListModal() {
  const q = document.getElementById("listModalFilter").value.toLowerCase();
  if (!q) {
    renderListModalRows(currentListModalItems);
    return;
  }
  const filtered = currentListModalItems.filter((it) =>
    JSON.stringify(it).toLowerCase().includes(q)
  );
  renderListModalRows(filtered);
}

function closeListModal() {
  document.getElementById("listModal").hidden = true;
  if (lastFocusedBeforeModal) {
    lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }
}

function refreshDashboard() {
  dashboardLoaded = false;
  loadDashboard();
}

// Builds a smooth SVG path through every point using Catmull-Rom-style
// cubic bezier segments - the curve still passes through each true data
// value, it just doesn't kink at straight-line joints between them.
function buildSmoothPath(points) {
  if (points.length < 3) {
    return points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  }
  let path = `M${points[0][0].toFixed(1)},${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
    path += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return path;
}

function renderTrendChart(containerId, days, options) {
  const box = document.getElementById(containerId);
  if (!days || days.length === 0) {
    box.innerHTML = '<p class="muted">No data.</p>';
    return;
  }

  const primary = options.primaryColor;
  const secondary = options.secondaryColor;
  const unitLabel = options.unitLabel || "";
  const areaGradId = `areaGradient-${containerId}`;
  const lineGradId = `lineGradient-${containerId}`;

  const width = 640;
  const height = 210;
  // Extra top padding reserved specifically for the peak badge, so it
  // never overlaps the topmost grid line/axis label regardless of
  // where the peak falls.
  const padding = { top: 36, right: 12, bottom: 24, left: 28 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const maxVal = Math.max(1, ...days.map((d) => d.count));
  const stepX = chartW / (days.length - 1 || 1);

  const points = days.map((d, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + chartH - (d.count / maxVal) * chartH;
    return [x, y];
  });

  // Smooth curve through every point (Catmull-Rom-style cubic bezier)
  // instead of straight segments - a real visual remodel, not just a
  // color change, and still passes through the true data values.
  const linePath = buildSmoothPath(points);
  const areaPath =
    linePath +
    ` L${points[points.length - 1][0].toFixed(1)},${(padding.top + chartH).toFixed(1)}` +
    ` L${points[0][0].toFixed(1)},${(padding.top + chartH).toFixed(1)} Z`;

  // Grid lines (4 horizontal bands)
  let gridLines = "";
  let gridLabels = "";
  const gridCount = 4;
  for (let i = 0; i <= gridCount; i++) {
    const y = padding.top + (chartH / gridCount) * i;
    const val = Math.round(maxVal - (maxVal / gridCount) * i);
    gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" class="chart-grid-line" />`;
    gridLabels += `<text x="${padding.left - 6}" y="${y + 3}" class="chart-axis-label" text-anchor="end">${val}</text>`;
  }

  // X-axis labels: show every ~3rd day to avoid crowding
  let xLabels = "";
  days.forEach((d, i) => {
    if (i % 3 !== 0 && i !== days.length - 1) return;
    const x = padding.left + i * stepX;
    const label = new Date(d.date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    xLabels += `<text x="${x}" y="${height - 4}" class="chart-axis-label" text-anchor="middle">${label}</text>`;
  });

  // Highlight the actual peak day, if there is one - real data only,
  // never shown on an all-zero period.
  let peakBadge = "";
  const peakCount = Math.max(...days.map((d) => d.count));
  if (peakCount > 0) {
    const peakIdx = days.findIndex((d) => d.count === peakCount);
    const peakPoint = points[peakIdx];
    const peakLabel = new Date(days[peakIdx].date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
    const badgeText = `${peakCount} · ${peakLabel}`;
    // Rough but reliable width estimate for a 9px bold sans-serif label -
    // measuring the WHOLE string (count + separator + date), not just
    // the count digits, which was the original bug causing the date to
    // get clipped for longer labels.
    const badgeW = Math.max(50, badgeText.length * 7 + 18);
    const badgeX = Math.min(Math.max(peakPoint[0] - badgeW / 2, padding.left), width - padding.right - badgeW);
    const badgeY = Math.max(peakPoint[1] - 34, 4);
    peakBadge = `
      <g class="chart-peak-badge">
        <rect x="${badgeX.toFixed(1)}" y="${badgeY.toFixed(1)}" width="${badgeW.toFixed(1)}" height="22" rx="11" fill="${secondary}" />
        <text x="${(badgeX + badgeW / 2).toFixed(1)}" y="${(badgeY + 15).toFixed(1)}" text-anchor="middle" class="chart-peak-text">${badgeText}</text>
        <line x1="${peakPoint[0].toFixed(1)}" y1="${(badgeY + 22).toFixed(1)}" x2="${peakPoint[0].toFixed(1)}" y2="${peakPoint[1].toFixed(1)}" stroke="${secondary}" stroke-width="1.5" stroke-dasharray="2 2" opacity="0.6" />
      </g>
    `;
  }

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" class="trend-chart-svg" preserveAspectRatio="none">
      <defs>
        <linearGradient id="${areaGradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${secondary}" stop-opacity="0.30" />
          <stop offset="55%" stop-color="${primary}" stop-opacity="0.14" />
          <stop offset="100%" stop-color="${primary}" stop-opacity="0.01" />
        </linearGradient>
        <linearGradient id="${lineGradId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${primary}" />
          <stop offset="100%" stop-color="${secondary}" />
        </linearGradient>
      </defs>
      ${gridLines}
      <path d="${areaPath}" fill="url(#${areaGradId})" stroke="none" />
      <path d="${linePath}" fill="none" stroke="url(#${lineGradId})" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
      ${points
        .map((p, i) => {
          const label = new Date(days[i].date + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
          const count = days[i].count;
          const tipText = `${label}: ${count} ${unitLabel}${count === 1 ? "" : "s"}`;
          return `
            <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="9" class="chart-dot-hit"
              onmousemove="showChartTooltip(event, '${tipText}')"
              onmouseleave="hideChartTooltip()" />
            <circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${secondary}" class="chart-dot" />`;
        })
        .join("")}
      ${peakBadge}
      ${gridLabels}
      ${xLabels}
    </svg>
  `;

  box.innerHTML = svg;
}

function showChartTooltip(evt, text) {
  let tip = document.getElementById("chartTooltip");
  if (!tip) {
    tip = document.createElement("div");
    tip.id = "chartTooltip";
    tip.className = "chart-tooltip";
    document.body.appendChild(tip);
  }
  tip.textContent = text;
  tip.style.display = "block";
  let left = evt.clientX + 14;
  const top = evt.clientY - 32;
  if (left > window.innerWidth - 160) left = evt.clientX - 160;
  tip.style.left = left + "px";
  tip.style.top = top + "px";
}

function hideChartTooltip() {
  const tip = document.getElementById("chartTooltip");
  if (tip) tip.style.display = "none";
}

function renderRecentUsers(users) {
  const box = document.getElementById("recentUsersList");
  if (!users || users.length === 0) {
    box.innerHTML = '<p class="muted">No recent user creation data available.</p>';
    return;
  }

  box.innerHTML = "";
  users.forEach((u) => {
    const row = document.createElement("div");
    row.className = "recent-row";
    row.innerHTML = `
      <div class="avatar avatar-small">${escapeHtml(initials(u.displayName))}</div>
      <div class="recent-details">
        <div class="recent-name">${escapeHtml(u.displayName)}</div>
        <div class="muted recent-email">${escapeHtml(u.userPrincipalName)}</div>
      </div>
      <div class="recent-time">${relativeTime(u.createdDateTime)}</div>
    `;
    box.appendChild(row);
  });
}

function relativeTime(isoString) {
  const then = new Date(isoString).getTime();
  const now = Date.now();
  const diffMs = now - then;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < hour) return Math.max(1, Math.round(diffMs / minute)) + "m ago";
  if (diffMs < day) return Math.round(diffMs / hour) + "h ago";
  if (diffMs < 30 * day) return Math.round(diffMs / day) + "d ago";
  return new Date(isoString).toLocaleDateString();
}

/* ================= Export tab ================= */

async function downloadExport(kind, filename, btnId) {
  await downloadFromPath(`/api/export/${kind}`, filename, btnId);
}

async function downloadFromPath(path, filename, btnId) {
  const btn = document.getElementById(btnId);
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-on-btn"></span> Preparing...';

  try {
    const res = await fetch(path);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Export failed.");
    }
    // Prefer the filename the server actually used (it sanitizes/derives
    // it from the group or site name) over our best-guess fallback.
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="(.+?)"/);
    const finalName = match ? match[1] : filename;

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = finalName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast("Export failed: " + err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ---- Export: one specific group ---- */

let exportGroupOptionsCache = [];

async function loadExportGroupOptions() {
  const select = document.getElementById("exportGroupSelect");
  const filterInput = document.getElementById("exportGroupFilter");
  filterInput.value = "";
  select.innerHTML = "<option>Loading...</option>";
  try {
    const groups = await api("/api/groups");
    exportGroupOptionsCache = groups;
    renderExportGroupSelect(groups);
  } catch (err) {
    select.innerHTML = `<option>Error: ${escapeHtml(err.message)}</option>`;
  }
}

function renderExportGroupSelect(groups) {
  const select = document.getElementById("exportGroupSelect");
  select.innerHTML = "";
  if (groups.length === 0) {
    select.innerHTML = "<option>No matches</option>";
    return;
  }
  groups.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.displayName;
    select.appendChild(opt);
  });
}

function filterExportGroupSelect(query) {
  const q = query.toLowerCase();
  const filtered = exportGroupOptionsCache.filter((g) =>
    g.displayName.toLowerCase().includes(q)
  );
  renderExportGroupSelect(filtered);
}

async function downloadOneGroup() {
  const select = document.getElementById("exportGroupSelect");
  const groupId = select.value;
  if (!groupId) {
    showToast("Load and select a group first.", "error");
    return;
  }
  await downloadFromPath(`/api/export/group/${groupId}`, "group-members.csv", "exportOneGroupBtn");
}

/* ---- Export: one specific SharePoint site ---- */

async function searchExportSites() {
  const q = document.getElementById("exportSiteQuery").value.trim();
  const select = document.getElementById("exportSiteSelect");
  if (!q) return;
  select.innerHTML = "<option>Searching...</option>";
  try {
    const sites = await api(`/api/sites/search?q=${encodeURIComponent(q)}`);
    select.innerHTML = "";
    sites.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.displayName || s.name;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = `<option>Error: ${escapeHtml(err.message)}</option>`;
  }
}

async function downloadOneSite() {
  const select = document.getElementById("exportSiteSelect");
  const siteId = select.value;
  if (!siteId) {
    showToast("Search and select a site first.", "error");
    return;
  }
  await downloadFromPath(
    `/api/export/site/${encodeURIComponent(siteId)}`,
    "site-access.csv",
    "exportOneSiteBtn"
  );
}

/* ================= Confirmation modal ================= */

let lastFocusedBeforeModal = null;

function confirmAction(message, onConfirm) {
  const modal = document.getElementById("confirmModal");
  const msgEl = document.getElementById("confirmMessage");
  const yesBtn = document.getElementById("confirmYesBtn");

  lastFocusedBeforeModal = document.activeElement;
  msgEl.textContent = message;
  modal.hidden = false;

  // Replace the button to clear any previously bound handler.
  const freshBtn = yesBtn.cloneNode(true);
  yesBtn.parentNode.replaceChild(freshBtn, yesBtn);
  freshBtn.id = "confirmYesBtn";
  freshBtn.addEventListener("click", () => {
    closeConfirm();
    onConfirm();
  });

  // Cancel is the safer default to land keyboard focus on for a
  // destructive-action confirmation - Enter should not immediately
  // confirm something like "disable this account."
  const cancelBtn = modal.querySelector(".modal-actions .btn:not(.btn-danger)");
  if (cancelBtn) cancelBtn.focus();
}

function closeConfirm() {
  document.getElementById("confirmModal").hidden = true;
  if (lastFocusedBeforeModal) {
    lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }
}

/* ================= Shared helpers ================= */

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

function getUpn() {
  const val = document.getElementById("targetUpn").value.trim();
  if (!val) showToast("Enter a target user's UPN/email first.", "error");
  return val;
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

/* ================= Manage User tab ================= */

let searchDebounceTimer = null;

// Fires on every keystroke - debounced so it doesn't hammer the API,
// but fast enough to feel live. Explicit Search / Enter still works via
// searchUser() below for people who prefer that.
function onSearchInput() {
  clearTimeout(searchDebounceTimer);
  const spinner = document.getElementById("searchSpinner");
  const q = document.getElementById("targetUpn").value.trim();
  const resultsList = document.getElementById("searchResults");
  const errBox = document.getElementById("overviewError");

  if (!q) {
    resultsList.innerHTML = "";
    errBox.hidden = true;
    spinner.hidden = true;
    return;
  }

  spinner.hidden = false;
  searchDebounceTimer = setTimeout(() => liveSearch(q), 250);
}

async function liveSearch(q) {
  const resultsList = document.getElementById("searchResults");
  const errBox = document.getElementById("overviewError");
  const spinner = document.getElementById("searchSpinner");

  try {
    const matches = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    spinner.hidden = true;
    resultsList.innerHTML = "";

    if (matches.length === 0) {
      errBox.classList.add("error-box");
      errBox.textContent = "No matching users found.";
      errBox.hidden = false;
      return;
    }

    errBox.hidden = true;
    matches.forEach((u) => {
      const li = document.createElement("li");
      li.className = "chip result-chip";
      li.textContent = `${u.displayName} — ${u.userPrincipalName}`;
      li.onclick = () => loadOverviewByUpn(u.userPrincipalName);
      resultsList.appendChild(li);
    });
  } catch (err) {
    spinner.hidden = true;
    // Quiet failure during live typing - the explicit Search button will
    // surface the error properly if they hit it.
  }
}

async function searchUser() {
  const q = document.getElementById("targetUpn").value.trim();
  const resultsList = document.getElementById("searchResults");
  const errBox = document.getElementById("overviewError");
  const panel = document.getElementById("overviewPanel");

  resultsList.innerHTML = "";
  errBox.hidden = true;
  panel.hidden = true;

  if (!q) {
    showToast("Enter a name or email to search.", "error");
    return;
  }

  try {
    const matches = await api(`/api/users/search?q=${encodeURIComponent(q)}`);

    if (matches.length === 0) {
      errBox.classList.add("error-box");
      errBox.textContent = "No matching users found.";
      errBox.hidden = false;
      return;
    }

    if (matches.length === 1) {
      loadOverviewByUpn(matches[0].userPrincipalName);
      return;
    }

    matches.forEach((u) => {
      const li = document.createElement("li");
      li.className = "chip result-chip";
      li.textContent = `${u.displayName} — ${u.userPrincipalName}`;
      li.onclick = () => loadOverviewByUpn(u.userPrincipalName);
      resultsList.appendChild(li);
    });
  } catch (err) {
    errBox.classList.add("error-box");
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
  }
}

async function loadOverviewByUpn(upn) {
  document.getElementById("targetUpn").value = upn;
  document.getElementById("searchResults").innerHTML = "";
  await loadOverview();
}

function switchSection(name) {
  document.querySelectorAll(".menu-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.section === name);
  });
  document.querySelectorAll(".manage-section").forEach((s) => {
    s.hidden = s.id !== `section-${name}`;
  });
}

async function loadOverview() {
  const upn = getUpn();
  if (!upn) return;

  const errBox = document.getElementById("overviewError");
  const panel = document.getElementById("overviewPanel");
  errBox.hidden = true;
  panel.hidden = true;
  errBox.classList.remove("error-box");
  errBox.innerHTML = '<span class="spinner"></span> Loading profile...';
  errBox.hidden = false;

  try {
    const data = await api(`/api/users/overview?upn=${encodeURIComponent(upn)}`);
    currentOverview = data;
    renderOverview(data);
    panel.hidden = false;
    errBox.hidden = true;
  } catch (err) {
    errBox.classList.add("error-box");
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
  }
}

function renderOverview(data) {
  const { user, licenses, groups, sites } = data;

  document.getElementById("avatarInitials").textContent = initials(user.displayName);
  document.getElementById("profileName").textContent = user.displayName;
  document.getElementById("profileUpn").textContent = user.userPrincipalName;
  document.getElementById("contactFirstName").value = user.givenName || "";
  document.getElementById("contactLastName").value = user.surname || "";
  document.getElementById("contactJobTitle").value = user.jobTitle || "";
  document.getElementById("contactDepartment").value = user.department || "";
  document.getElementById("contactOffice").value = user.officeLocation || "";
  document.getElementById("contactOfficePhone").value =
    (user.businessPhones && user.businessPhones[0]) || "";
  document.getElementById("contactMobilePhone").value = user.mobilePhone || "";
  document.getElementById("contactStreetAddress").value = user.streetAddress || "";
  document.getElementById("contactCity").value = user.city || "";
  document.getElementById("contactState").value = user.state || "";
  document.getElementById("contactPostalCode").value = user.postalCode || "";
  document.getElementById("contactCountry").value = user.country || "";

  const statusPill = document.getElementById("profileStatus");
  statusPill.textContent = user.accountEnabled ? "Enabled" : "Disabled";
  statusPill.className = "status-pill " + (user.accountEnabled ? "enabled" : "disabled");
  document.getElementById("enableBtn").disabled = user.accountEnabled;

  const licenseList = document.getElementById("currentLicenses");
  licenseList.innerHTML = "";
  licenses.forEach((l) => {
    const li = document.createElement("li");
    li.className = "chip";
    li.innerHTML = `${escapeHtml(l.friendlyName)} <span class="remove-x" title="Remove license">✕</span>`;
    li.querySelector(".remove-x").onclick = () =>
      confirmAction(`Remove "${l.friendlyName}" from this user?`, () =>
        licenseAction("remove", l.skuId, l.friendlyName)
      );
    licenseList.appendChild(li);
  });

  const groupList = document.getElementById("currentGroups");
  groupList.innerHTML = "";
  groups.forEach((g) => {
    const li = document.createElement("li");
    li.className = "chip";
    const tag = g.isM365Group ? " (M365 / SharePoint)" : "";
    li.innerHTML = `${escapeHtml(g.displayName)}${tag} <span class="remove-x" title="Remove from group">✕</span>`;
    li.querySelector(".remove-x").onclick = () =>
      confirmAction(`Remove this user from "${g.displayName}"?`, () =>
        groupAction("remove", g.id, g.displayName)
      );
    groupList.appendChild(li);
  });

  const siteList = document.getElementById("currentSharePointSites");
  siteList.innerHTML = "";
  (sites || []).forEach((s) => {
    const li = document.createElement("li");
    li.className = "chip";
    if (s.webUrl) {
      li.innerHTML = `<a href="${escapeHtml(s.webUrl)}" target="_blank" rel="noopener" class="chip-link">${escapeHtml(s.displayName)}</a>`;
    } else {
      li.textContent = s.displayName;
    }
    siteList.appendChild(li);
  });

  document.getElementById("actionResult").textContent = "";
  document.getElementById("licenseResult").textContent = "";
  document.getElementById("groupResult").textContent = "";
  document.getElementById("siteResult").textContent = "";
  document.getElementById("contactResult").textContent = "";
}

/* ================= Toast notifications ================= */

let toastContainer = null;

function showToast(message, type = "info") {
  if (!toastContainer) {
    toastContainer = document.createElement("div");
    toastContainer.id = "toastContainer";
    toastContainer.className = "toast-container";
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  const icon = type === "error" ? "✕" : type === "success" ? "✓" : "ℹ";
  toast.innerHTML = `<span class="toast-icon">${icon}</span><span class="toast-message"></span>`;
  toast.querySelector(".toast-message").textContent = message;
  toastContainer.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("toast-in"));

  setTimeout(() => {
    toast.classList.remove("toast-in");
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

function skeletonRows(count = 4) {
  return Array.from({ length: count })
    .map(
      () => `
      <div class="skeleton-row">
        <div class="skeleton-avatar skeleton-bar"></div>
        <div class="skeleton-lines">
          <div class="skeleton-bar skeleton-bar-wide"></div>
          <div class="skeleton-bar skeleton-bar-narrow"></div>
        </div>
      </div>`
    )
    .join("");
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : str;
  return div.innerHTML;
}

// Client-side filter for the License / Groups / SharePoint sites
// checkbox lists in Create User - hides non-matching rows without
// re-fetching, so it stays instant even on longer lists.
function filterCheckboxContainer(query, containerId) {
  const q = query.toLowerCase();
  document.querySelectorAll(`#${containerId} .checkbox-item`).forEach((item) => {
    const matches = item.textContent.toLowerCase().includes(q);
    item.style.display = matches ? "" : "none";
  });
}

function isTargetSelf() {
  return !!(
    currentOverview &&
    currentOverview.user &&
    signedInUpn &&
    currentOverview.user.userPrincipalName.toLowerCase() === signedInUpn
  );
}

function triggerResetPassword() {
  if (isTargetSelf()) {
    // Not just a warning - Microsoft Graph outright blocks this one,
    // even for Global Admins, as a deliberate security boundary (the
    // admin password-set API is for resetting other people's
    // passwords, not your own - otherwise an admin session could
    // silently take over its own login without proving the current
    // password). No point letting the click through to a confusing
    // 403 from Graph.
    showToast(
      "Microsoft Graph blocks resetting your own password this way, even as Global Admin. Use myaccount.microsoft.com or passwordreset.microsoftonline.com instead.",
      "error"
    );
    return;
  }
  confirmAction(
    "Reset this user's password? Their current password will stop working immediately, and they'll be emailed the new one.",
    resetPassword
  );
}

function triggerDisableAccount() {
  if (isTargetSelf()) {
    confirmAction(
      "This is YOUR OWN account. Disabling it locks you out immediately and signs you out of this app right now - you'd need another Global Admin to re-enable it afterward. Are you sure you want to continue?",
      () => setEnabled(false)
    );
    return;
  }
  confirmAction("Disable this account and revoke all active sessions?", () => setEnabled(false));
}

function triggerRevokeSessions() {
  if (isTargetSelf()) {
    confirmAction(
      "This is YOUR OWN account, and this session (the one you're using right now) counts as active - revoking will sign you out of this app immediately, and you'll need to sign back in. Continue?",
      revokeSessions
    );
    return;
  }
  confirmAction(
    "Revoke all active sign-in sessions for this user? They will be signed out everywhere immediately.",
    revokeSessions
  );
}

async function resetPassword() {
  const upn = getUpn();
  if (!upn) return;
  const newPassword = document.getElementById("newPassword").value.trim();
  const box = document.getElementById("actionResult");
  box.innerHTML = '<span class="spinner"></span> Resetting password...';
  try {
    const data = await api("/api/users/reset-password", {
      method: "POST",
      body: JSON.stringify({ upn, newPassword: newPassword || undefined }),
    });
    let msg = `Password reset. Temporary password:\n${data.temporaryPassword}\n`;
    msg += data.emailSent
      ? "Notification email sent to the user."
      : `Notification email NOT sent${data.emailError ? " (" + data.emailError + ")" : " (user has no mail address)"}.`;
    box.textContent = msg;
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function setEnabled(enabled) {
  const upn = getUpn();
  if (!upn) return;
  const box = document.getElementById("actionResult");
  box.textContent = enabled ? "Enabling..." : "Disabling...";
  try {
    await api("/api/users/set-enabled", {
      method: "POST",
      body: JSON.stringify({ upn, enabled }),
    });
    box.textContent = enabled
      ? "Account enabled."
      : "Account disabled and active sessions revoked.";
    loadOverview();
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function revokeSessions() {
  const upn = getUpn();
  if (!upn) return;
  const box = document.getElementById("actionResult");
  box.textContent = "Revoking active sessions...";
  try {
    await api("/api/users/revoke-sessions", {
      method: "POST",
      body: JSON.stringify({ upn }),
    });
    box.textContent = "All active sessions revoked. User will need to sign in again everywhere.";
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function saveContactInfo() {
  const upn = getUpn();
  if (!upn) return;

  const firstName = document.getElementById("contactFirstName").value.trim();
  const lastName = document.getElementById("contactLastName").value.trim();
  const box = document.getElementById("contactResult");

  if (!firstName || !lastName) {
    box.classList.add("error-box");
    box.textContent = "First name and last name are required.";
    return;
  }

  const payload = {
    upn,
    firstName,
    lastName,
    jobTitle: document.getElementById("contactJobTitle").value.trim(),
    department: document.getElementById("contactDepartment").value.trim(),
    officeLocation: document.getElementById("contactOffice").value.trim(),
    officePhone: document.getElementById("contactOfficePhone").value.trim(),
    mobilePhone: document.getElementById("contactMobilePhone").value.trim(),
    streetAddress: document.getElementById("contactStreetAddress").value.trim(),
    city: document.getElementById("contactCity").value.trim(),
    state: document.getElementById("contactState").value.trim(),
    postalCode: document.getElementById("contactPostalCode").value.trim(),
    country: document.getElementById("contactCountry").value.trim(),
  };

  box.classList.remove("error-box");
  box.innerHTML = '<span class="spinner"></span> Saving...';
  try {
    const data = await api("/api/users/update-profile", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    box.textContent = `Saved. Display name: "${data.displayName}".`;
    loadOverview();
  } catch (err) {
    box.classList.add("error-box");
    box.textContent = "Error: " + err.message;
  }
}

let groupSelectCache = [];

async function loadGroupOptions() {
  const select = document.getElementById("groupSelect");
  const filterInput = document.getElementById("groupSelectFilter");
  if (filterInput) filterInput.value = "";
  select.innerHTML = "<option>Loading...</option>";
  try {
    const groups = await api("/api/groups");
    groupSelectCache = groups;
    renderGroupSelect(groups);
  } catch (err) {
    select.innerHTML = `<option>Error: ${err.message}</option>`;
  }
}

function renderGroupSelect(groups) {
  const select = document.getElementById("groupSelect");
  select.innerHTML = "";
  if (groups.length === 0) {
    select.innerHTML = "<option>No matches</option>";
    return;
  }
  groups.forEach((g) => {
    const opt = document.createElement("option");
    opt.value = g.id;
    opt.textContent = g.displayName;
    select.appendChild(opt);
  });
}

function filterGroupSelect(query) {
  const q = query.toLowerCase();
  const filtered = groupSelectCache.filter((g) => g.displayName.toLowerCase().includes(q));
  renderGroupSelect(filtered);
}

async function groupAction(action, groupId, groupName) {
  const upn = getUpn();
  if (!upn) return;
  const box = document.getElementById("groupResult");

  if (action === "add") {
    const select = document.getElementById("groupSelect");
    groupId = select.value;
    if (!groupId) {
      box.textContent = "Select a group first.";
      return;
    }
  }

  box.textContent = "Working...";
  try {
    const endpoint =
      action === "add" ? "/api/groups/add-member" : "/api/groups/remove-member";
    await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ upn, groupId }),
    });
    box.textContent = `Done: ${action === "add" ? "added to" : "removed from"} ${groupName || "group"}.`;
    loadOverview();
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function loadLicenseOptions() {
  const select = document.getElementById("licenseSelect");
  select.innerHTML = "<option>Loading...</option>";
  try {
    const licenses = await api("/api/licenses");
    select.innerHTML = "";
    licenses.forEach((l) => {
      const opt = document.createElement("option");
      opt.value = l.skuId;
      opt.textContent = `${l.friendlyName} (${l.available} available)`;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = `<option>Error: ${err.message}</option>`;
  }
}

async function licenseAction(action, skuId, friendlyName) {
  const upn = getUpn();
  if (!upn) return;
  const box = document.getElementById("licenseResult");

  if (action === "assign") {
    const select = document.getElementById("licenseSelect");
    skuId = select.value;
    if (!skuId) {
      box.textContent = "Select a license first.";
      return;
    }
  }

  const countryCode = document.getElementById("usageLocation").value.trim();
  box.textContent = "Working...";
  try {
    const endpoint =
      action === "assign" ? "/api/licenses/assign" : "/api/licenses/remove";
    await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ upn, skuId, countryCode: countryCode || undefined }),
    });
    box.textContent = `Done: license ${action === "assign" ? "assigned" : "removed"}${friendlyName ? " (" + friendlyName + ")" : ""}.`;
    loadOverview();
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function searchSites() {
  const q = document.getElementById("siteQuery").value.trim();
  const select = document.getElementById("siteSelect");
  if (!q) return;
  select.innerHTML = "<option>Searching...</option>";
  try {
    const sites = await api(`/api/sites/search?q=${encodeURIComponent(q)}`);
    select.innerHTML = "";
    sites.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = s.displayName || s.name;
      select.appendChild(opt);
    });
  } catch (err) {
    select.innerHTML = `<option>Error: ${err.message}</option>`;
  }
}

async function addToSite() {
  const upn = getUpn();
  if (!upn) return;
  const select = document.getElementById("siteSelect");
  const siteId = select.value;
  const box = document.getElementById("siteResult");
  if (!siteId) {
    box.textContent = "Select a site first.";
    return;
  }
  box.textContent = "Working...";
  try {
    await api("/api/sites/add-member", {
      method: "POST",
      body: JSON.stringify({ upn, siteId }),
    });
    box.textContent = "User added to site.";
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

/* ================= Create User tab ================= */

async function loadCreateLicenseOptions() {
  const box = document.getElementById("createLicenseList");
  box.innerHTML = '<span class="spinner"></span> Loading...';
  try {
    const licenses = await api("/api/licenses");
    box.innerHTML = "";
    licenses.forEach((l) => {
      const row = document.createElement("label");
      row.className = "checkbox-item";
      row.innerHTML = `<input type="checkbox" value="${l.skuId}" data-name="${escapeHtml(l.friendlyName)}" /> ${escapeHtml(l.friendlyName)} (${l.available} available)`;
      box.appendChild(row);
    });
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function loadCreateGroupOptions() {
  const box = document.getElementById("createGroupList");
  box.innerHTML = '<span class="spinner"></span> Loading...';
  try {
    const groups = await api("/api/groups");
    box.innerHTML = "";
    groups.forEach((g) => {
      const row = document.createElement("label");
      row.className = "checkbox-item";
      row.innerHTML = `<input type="checkbox" value="${g.id}" data-name="${escapeHtml(g.displayName)}" /> ${escapeHtml(g.displayName)}`;
      box.appendChild(row);
    });
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function searchCreateSites() {
  const q = document.getElementById("createSiteQuery").value.trim();
  const box = document.getElementById("createSiteList");
  if (!q) return;
  box.innerHTML = '<span class="spinner"></span> Searching...';
  try {
    const sites = await api(`/api/sites/search?q=${encodeURIComponent(q)}`);
    box.innerHTML = "";
    sites.forEach((s) => {
      const row = document.createElement("label");
      row.className = "checkbox-item";
      const name = s.displayName || s.name;
      row.innerHTML = `<input type="checkbox" value="${s.id}" data-name="${escapeHtml(name)}" /> ${escapeHtml(name)}`;
      box.appendChild(row);
    });
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

function getCheckedValues(containerId) {
  return Array.from(
    document.querySelectorAll(`#${containerId} input[type="checkbox"]:checked`)
  ).map((el) => ({ value: el.value, name: el.dataset.name }));
}

function markUsernameEdited() {
  document.getElementById("newUsername").dataset.userEdited = "true";
}

function suggestUsername() {
  const usernameField = document.getElementById("newUsername");
  // Don't overwrite something the admin already typed/edited manually.
  if (usernameField.dataset.userEdited === "true") return;

  const first = document.getElementById("newFirstName").value.trim().toLowerCase();
  const last = document.getElementById("newLastName").value.trim().toLowerCase();
  const clean = (s) => s.replace(/[^a-z0-9]/g, "");
  const suggestion = [clean(first), clean(last)].filter(Boolean).join(".");
  usernameField.value = suggestion;
  updateUpnPreview();
}

function updateUpnPreview() {
  const username = document.getElementById("newUsername").value.trim();
  const preview = document.getElementById("newUpnPreview");
  preview.textContent = username && adminDomain ? `Will be created as: ${username}@${adminDomain}` : "";
}

async function createUser() {
  const firstName = document.getElementById("newFirstName").value.trim();
  const lastName = document.getElementById("newLastName").value.trim();
  const username = document.getElementById("newUsername").value.trim();
  const department = document.getElementById("newDepartment").value.trim();
  const position = document.getElementById("newPosition").value.trim();
  const usageLocation = document.getElementById("newUsageLocation").value.trim();
  const box = document.getElementById("createResult");

  if (!firstName || !lastName || !username) {
    box.textContent = "First name, last name, and username are required.";
    return;
  }
  if (!adminDomain) {
    box.textContent = "Couldn't determine your domain — try refreshing the page.";
    return;
  }

  const upn = `${username}@${adminDomain}`;

  const btn = document.getElementById("createUserBtn");
  const originalBtnText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-on-btn"></span> Creating user...';
  box.classList.remove("error-box");
  box.innerHTML = '<span class="spinner"></span> Creating user account...';

  try {
    const result = await api("/api/users/create", {
      method: "POST",
      body: JSON.stringify({
        firstName,
        lastName,
        upn,
        department: department || undefined,
        jobTitle: position || undefined,
        usageLocation: usageLocation || undefined,
      }),
    });

    let log = `User created: ${result.user.userPrincipalName}\nTemporary password: ${result.temporaryPassword}\n`;
    box.textContent = log;

    const licenses = getCheckedValues("createLicenseList");
    for (const l of licenses) {
      btn.innerHTML = `<span class="spinner spinner-on-btn"></span> Assigning license: ${l.name}...`;
      box.textContent = log;
      try {
        await api("/api/licenses/assign", {
          method: "POST",
          body: JSON.stringify({ upn, skuId: l.value, countryCode: usageLocation || undefined }),
        });
        log += `License assigned: ${l.name}\n`;
      } catch (err) {
        log += `License failed (${l.name}): ${err.message}\n`;
      }
      box.textContent = log;
    }

    const groups = getCheckedValues("createGroupList");
    for (const g of groups) {
      btn.innerHTML = `<span class="spinner spinner-on-btn"></span> Adding to group: ${g.name}...`;
      box.textContent = log;
      try {
        await api("/api/groups/add-member", {
          method: "POST",
          body: JSON.stringify({ upn, groupId: g.value }),
        });
        log += `Added to group: ${g.name}\n`;
      } catch (err) {
        log += `Group failed (${g.name}): ${err.message}\n`;
      }
      box.textContent = log;
    }

    const sites = getCheckedValues("createSiteList");
    for (const s of sites) {
      btn.innerHTML = `<span class="spinner spinner-on-btn"></span> Adding to site: ${s.name}...`;
      box.textContent = log;
      try {
        await api("/api/sites/add-member", {
          method: "POST",
          body: JSON.stringify({ upn, siteId: s.value }),
        });
        log += `Added to site: ${s.name}\n`;
      } catch (err) {
        log += `Site failed (${s.name}): ${err.message}\n`;
      }
      box.textContent = log;
    }

    btn.innerHTML = '<span class="spinner spinner-on-btn"></span> Preparing email preview...';
    box.textContent = log;

    const emailDecision = await previewAndSendWelcomeEmail({
      displayName: result.user.displayName,
      upn: result.user.userPrincipalName,
      tempPassword: result.temporaryPassword,
    });

    if (emailDecision.sent) {
      log += `Welcome email sent.\n`;
    } else if (emailDecision.skipped) {
      log += `Welcome email not sent (skipped by admin).\n`;
    } else {
      log += `Welcome email failed: ${emailDecision.error}\n`;
    }

    box.textContent = log;
  } catch (err) {
    box.classList.add("error-box");
    box.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = originalBtnText;
  }
}

/* ================= Offboarding tab ================= */

let offboardTargetUpn = null;

let offboardSearchDebounce = null;

function onOffboardSearchInput() {
  clearTimeout(offboardSearchDebounce);
  const spinner = document.getElementById("offboardSearchSpinner");
  const q = document.getElementById("offboardUpn").value.trim();
  const resultsList = document.getElementById("offboardSearchResults");
  const errBox = document.getElementById("offboardError");

  if (!q) {
    resultsList.innerHTML = "";
    errBox.hidden = true;
    spinner.hidden = true;
    return;
  }

  spinner.hidden = false;
  offboardSearchDebounce = setTimeout(() => searchOffboardUser(), 250);
}

async function searchOffboardUser() {
  const q = document.getElementById("offboardUpn").value.trim();
  const resultsList = document.getElementById("offboardSearchResults");
  const errBox = document.getElementById("offboardError");
  const targetBox = document.getElementById("offboardTarget");
  const spinner = document.getElementById("offboardSearchSpinner");

  resultsList.innerHTML = "";
  errBox.hidden = true;
  targetBox.hidden = true;

  if (!q) {
    spinner.hidden = true;
    showToast("Enter a name or email to search.", "error");
    return;
  }

  try {
    const matches = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    spinner.hidden = true;

    if (matches.length === 0) {
      errBox.classList.add("error-box");
      errBox.textContent = "No matching users found.";
      errBox.hidden = false;
      return;
    }

    if (matches.length === 1) {
      selectOffboardTarget(matches[0]);
      return;
    }

    matches.forEach((u) => {
      const li = document.createElement("li");
      li.className = "chip result-chip";
      li.textContent = `${u.displayName} — ${u.userPrincipalName}`;
      li.onclick = () => selectOffboardTarget(u);
      resultsList.appendChild(li);
    });
  } catch (err) {
    spinner.hidden = true;
    errBox.classList.add("error-box");
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
  }
}

function selectOffboardTarget(user) {
  offboardTargetUpn = user.userPrincipalName;
  document.getElementById("offboardSearchResults").innerHTML = "";
  document.getElementById("offboardAvatar").textContent = initials(user.displayName);
  document.getElementById("offboardName").textContent = user.displayName;
  document.getElementById("offboardTargetUpn").textContent = user.userPrincipalName;
  document.getElementById("offboardResult").textContent = "";
  document.getElementById("offboardTarget").hidden = false;
}

async function runOffboarding() {
  if (!offboardTargetUpn) return;
  const box = document.getElementById("offboardResult");
  box.classList.remove("error-box");
  box.innerHTML = '<span class="spinner"></span> Offboarding in progress...';

  try {
    const data = await api("/api/offboarding/run", {
      method: "POST",
      body: JSON.stringify({ upn: offboardTargetUpn }),
    });

    const groupLines = data.groupsRemoved
      .map((g) => (g.success ? `Removed from: ${g.name}` : `Failed to remove from ${g.name}: ${g.error}`))
      .join("\n");

    const siteLines = (data.directSitesRemoved || [])
      .map((s) => (s.success ? `Removed direct access to: ${s.siteName}` : `Failed to remove access to ${s.siteName}: ${s.error}`))
      .join("\n");

    box.textContent =
      `Offboarded: ${data.displayName} (${data.userPrincipalName})\n` +
      (groupLines ? groupLines + "\n" : "No group memberships found.\n") +
      (siteLines ? siteLines + "\n" : "No direct SharePoint site permissions found (group-backed sites are already covered above).\n") +
      `Sessions revoked.\n` +
      `Password reset (not sent to user).\n` +
      `License removal scheduled for ${data.licenseRemovalDueDate}.`;

    loadPendingOffboarding();
  } catch (err) {
    box.classList.add("error-box");
    box.textContent = "Error: " + err.message;
  }
}

async function loadPendingOffboarding() {
  const box = document.getElementById("pendingOffboardList");
  box.innerHTML = skeletonRows(3);
  try {
    const entries = await api("/api/offboarding/pending");
    if (entries.length === 0) {
      box.innerHTML = '<p class="muted">Nothing pending.</p>';
      return;
    }
    box.innerHTML = "";
    entries
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
      .forEach((e) => {
        const row = document.createElement("div");
        row.className = "pending-row";
        row.innerHTML = `
          <div class="pending-text">
            <div class="list-modal-primary">${escapeHtml(e.displayName)}</div>
            <div class="muted">${escapeHtml(e.userPrincipalName)}</div>
          </div>
          <span class="due-badge ${e.isDue ? "due-badge-overdue" : "due-badge-upcoming"}">
            ${e.isDue ? "Due" : "Due " + escapeHtml(e.dueDate)}
          </span>
          <button class="btn btn-small btn-danger" onclick="processOneDue('${e.id}', '${escapeHtml(e.displayName).replace(/'/g, "\\'")}')">Remove license now</button>
        `;
        box.appendChild(row);
      });
  } catch (err) {
    box.innerHTML = `<p class="muted">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function processOneDue(userId, displayName) {
  confirmAction(`Remove all licenses from ${displayName}?`, async () => {
    try {
      await api(`/api/offboarding/process-license/${userId}`, { method: "POST" });
      loadPendingOffboarding();
    } catch (err) {
      showToast("Failed: " + err.message, "error");
    }
  });
}

async function processAllDue() {
  const btn = document.getElementById("processAllDueBtn");
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-on-btn"></span> Processing...';
  try {
    const entries = await api("/api/offboarding/pending");
    const due = entries.filter((e) => e.isDue);
    for (const e of due) {
      try {
        await api(`/api/offboarding/process-license/${e.id}`, { method: "POST" });
      } catch (err) {
        // continue processing the rest even if one fails
      }
    }
    loadPendingOffboarding();
  } finally {
    btn.disabled = false;
    btn.textContent = "Process all due now";
  }
}

/* ================= Guest User tab ================= */

async function loadGuestGroupOptions() {
  const box = document.getElementById("guestGroupList");
  box.innerHTML = "Loading...";
  try {
    const groups = await api("/api/groups");
    box.innerHTML = "";
    groups.forEach((g) => {
      const row = document.createElement("label");
      row.className = "checkbox-item";
      row.innerHTML = `<input type="checkbox" value="${g.id}" data-name="${escapeHtml(g.displayName)}" /> ${escapeHtml(g.displayName)}`;
      box.appendChild(row);
    });
  } catch (err) {
    box.textContent = "Error: " + err.message;
  }
}

async function createGuestUser() {
  const firstName = document.getElementById("guestFirstName").value.trim();
  const lastName = document.getElementById("guestLastName").value.trim();
  const externalEmail = document.getElementById("guestEmail").value.trim();
  const department = document.getElementById("guestDepartment").value.trim();
  const box = document.getElementById("guestResult");

  if (!firstName || !lastName || !externalEmail) {
    box.textContent = "First name, last name, and external email are required.";
    return;
  }

  const btn = document.getElementById("createGuestBtn");
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner spinner-on-btn"></span> Adding guest...';
  box.classList.remove("error-box");
  box.textContent = "";

  try {
    const result = await api("/api/guests/create", {
      method: "POST",
      body: JSON.stringify({
        firstName,
        lastName,
        externalEmail,
        department: department || undefined,
      }),
    });

    let log = `Guest added: ${result.invitedUser.displayName} (${externalEmail})\nNo email or invitation was sent.\n`;

    const groups = getCheckedValues("guestGroupList");
    for (const g of groups) {
      try {
        await api("/api/groups/add-member", {
          method: "POST",
          body: JSON.stringify({ upn: result.invitedUser.id, groupId: g.value }),
        });
        log += `Added to group: ${g.name}\n`;
      } catch (err) {
        log += `Group failed (${g.name}): ${err.message}\n`;
      }
    }

    box.textContent = log;
  } catch (err) {
    box.classList.add("error-box");
    box.textContent = "Error: " + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

/* ================= Audit Trail tab ================= */

let auditEntriesCache = [];

async function loadAuditLog() {
  const errBox = document.getElementById("auditError");
  const list = document.getElementById("auditList");
  errBox.hidden = true;
  list.innerHTML = skeletonRows(5);

  try {
    const data = await api("/api/audit/logs?top=100");
    auditEntriesCache = data.entries || [];
    renderAuditLog(auditEntriesCache);
  } catch (err) {
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
    list.innerHTML = "";
  }
}

function renderAuditLog(entries) {
  const list = document.getElementById("auditList");
  if (!entries || entries.length === 0) {
    list.innerHTML = '<p class="muted">No audit entries found in the available retention window.</p>';
    return;
  }
  list.innerHTML = "";
  entries.forEach((e) => {
    const row = document.createElement("div");
    row.className = "audit-row " + (e.result === "success" ? "audit-success" : "audit-failure");
    const when = new Date(e.activityDateTime).toLocaleString();
    const targets = (e.targetResources || []).map((t) => t.displayName).filter(Boolean).join(", ");
    row.innerHTML = `
      <div class="audit-status-dot"></div>
      <div class="audit-details">
        <div class="audit-top-line">
          <strong>${escapeHtml(e.activityDisplayName || "Unknown action")}</strong>
          <span class="audit-time">${when}</span>
        </div>
        <div class="muted audit-meta">By ${escapeHtml(e.initiatedBy)}${targets ? " · " + escapeHtml(targets) : ""}</div>
        ${e.result !== "success" ? `<div class="audit-fail-reason">${escapeHtml(e.resultReason || "Failed")}</div>` : ""}
      </div>
    `;
    list.appendChild(row);
  });
}

function filterAuditLog(query) {
  const q = query.toLowerCase();
  if (!q) {
    renderAuditLog(auditEntriesCache);
    return;
  }
  const filtered = auditEntriesCache.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  renderAuditLog(filtered);
}

/* ================= Mail tab ================= */

let mailActivityCache = [];

async function loadMailActivity(period) {
  const errBox = document.getElementById("mailActivityError");
  const wrap = document.getElementById("mailActivityTableWrap");
  errBox.hidden = true;
  wrap.innerHTML = skeletonRows(4);

  try {
    const data = await api(`/api/mail/activity?period=${period}`);
    mailActivityCache = data.entries || [];
    renderMailActivity(mailActivityCache);
  } catch (err) {
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
    wrap.innerHTML = "";
  }
}

function renderMailActivity(entries) {
  const wrap = document.getElementById("mailActivityTableWrap");
  if (!entries || entries.length === 0) {
    wrap.innerHTML = '<p class="muted">No data — click a time range above to load.</p>';
    return;
  }
  const rows = entries
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(e.displayName || "")}</td>
        <td class="muted">${escapeHtml(e.userPrincipalName || "")}</td>
        <td>${escapeHtml(e.sendCount || "0")}</td>
        <td>${escapeHtml(e.receiveCount || "0")}</td>
        <td>${escapeHtml(e.readCount || "0")}</td>
      </tr>`
    )
    .join("");
  wrap.innerHTML = `
    <table class="mail-table">
      <thead><tr><th>Name</th><th>Email</th><th>Sent</th><th>Received</th><th>Read</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function filterMailActivity(query) {
  const q = query.toLowerCase();
  if (!q) {
    renderMailActivity(mailActivityCache);
    return;
  }
  const filtered = mailActivityCache.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  renderMailActivity(filtered);
}

/* ================= Settings tab ================= */

function applyTextSize(size) {
  document.documentElement.style.setProperty("--user-text-scale", size / 100);
  document.querySelectorAll("#textSizeOptions .settings-option").forEach((b) => {
    b.classList.toggle("active", b.dataset.size === String(size));
  });
  localStorage.setItem("textSize", size);
}

function applyBackground(bg) {
  document.documentElement.setAttribute("data-bg", bg);
  document.querySelectorAll("#bgOptions .bg-swatch").forEach((b) => {
    b.classList.toggle("active", b.dataset.bg === bg);
  });
  localStorage.setItem("background", bg);
}

const I18N = {
  en: {
    navDashboard: "Dashboard", navManage: "Manage User", navDistro: "Distro List", navCreate: "Onboarding",
    navExport: "Export", navOffboarding: "Offboarding", navGuest: "Guest User",
    navAudit: "Audit Trail", navMail: "Mail", navInstall: "Install App", navSettings: "Settings",
    titleDashboard: "Dashboard", titleManage: "Manage User", titleDistro: "Distro List", titleCreate: "Onboarding",
    titleExport: "Export", titleOffboarding: "Offboarding", titleGuest: "Guest User",
    auditTitle: "Audit Trail", titleMail: "Mail", titleInstall: "Install App", titleSettings: "Settings",
    tabDashboard: "Dashboard", tabManage: "Users", tabCreate: "Onboard", tabOffboarding: "Offboard", tabMenu: "Menu",
  },
  fil: {
    navDashboard: "Dashboard", navManage: "Pamahalaan ang User", navDistro: "Distro List", navCreate: "Onboarding",
    navExport: "I-export", navOffboarding: "Offboarding", navGuest: "Guest User",
    navAudit: "Audit Trail", navMail: "Mail", navInstall: "I-install ang App", navSettings: "Mga Setting",
    titleDashboard: "Dashboard", titleManage: "Pamahalaan ang User", titleDistro: "Distro List", titleCreate: "Onboarding",
    titleExport: "I-export", titleOffboarding: "Offboarding", titleGuest: "Guest User",
    auditTitle: "Audit Trail", titleMail: "Mail", titleInstall: "I-install ang App", titleSettings: "Mga Setting",
    tabDashboard: "Dashboard", tabManage: "Mga User", tabCreate: "Onboard", tabOffboarding: "Offboard", tabMenu: "Menu",
  },
};

function applyLanguage(lang) {
  const dict = I18N[lang] || I18N.en;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.dataset.i18n;
    if (dict[key]) el.textContent = dict[key];
  });
  document.querySelectorAll("#langOptions .settings-option").forEach((b) => {
    b.classList.toggle("active", b.dataset.lang === lang);
  });
  localStorage.setItem("language", lang);
}

function initSettingsUI() {
  document.querySelectorAll("#textSizeOptions .settings-option").forEach((b) => {
    b.onclick = () => applyTextSize(b.dataset.size);
  });
  document.querySelectorAll("#bgOptions .bg-swatch").forEach((b) => {
    b.onclick = () => applyBackground(b.dataset.bg);
  });
  document.querySelectorAll("#langOptions .settings-option").forEach((b) => {
    b.onclick = () => applyLanguage(b.dataset.lang);
  });

  applyTextSize(localStorage.getItem("textSize") || "100");
  applyBackground(localStorage.getItem("background") || "default");
  applyLanguage(localStorage.getItem("language") || "en");
}

/* ================= Welcome email preview modal ================= */

let pendingEmailParams = null;
let pendingEmailResolve = null;

// Fetches the exact email content (same template the send endpoint
// uses), shows it to the admin, and waits for them to either send it
// or skip it. Resolves with {sent, skipped, error}.
let emailRecipients = { to: [], cc: [] };
let emailSearchDebounce = null;

function previewAndSendWelcomeEmail(params) {
  return new Promise(async (resolve) => {
    pendingEmailParams = params;
    pendingEmailResolve = resolve;

    const modal = document.getElementById("emailPreviewModal");
    const sendBtn = document.getElementById("emailPreviewSendBtn");
    sendBtn.disabled = true;
    sendBtn.textContent = "Loading preview...";
    lastFocusedBeforeModal = document.activeElement;
    modal.hidden = false;
    modal.querySelector(".modal-close-btn").focus();

    document.getElementById("emailToInput").value = "";
    document.getElementById("emailCcInput").value = "";
    document.getElementById("emailToResults").innerHTML = "";
    document.getElementById("emailCcResults").innerHTML = "";

    try {
      const preview = await api("/api/users/welcome-email-preview", {
        method: "POST",
        body: JSON.stringify(params),
      });
      emailRecipients = { to: [...(preview.to || [])], cc: [...(preview.cc || [])] };
      renderEmailChips("to");
      renderEmailChips("cc");
      document.getElementById("emailPreviewSubject").textContent = preview.subject;
      document.getElementById("emailPreviewBody").innerHTML = preview.htmlBody;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send email";
    } catch (err) {
      document.getElementById("emailPreviewBody").innerHTML =
        `<p class="muted">Couldn't load preview: ${escapeHtml(err.message)}</p>`;
      sendBtn.disabled = false;
      sendBtn.textContent = "Send email";
    }
  });
}

function renderEmailChips(field) {
  const list = document.getElementById(field === "to" ? "emailToChips" : "emailCcChips");
  list.innerHTML = "";
  emailRecipients[field].forEach((address) => {
    const li = document.createElement("li");
    li.className = "chip";
    li.innerHTML = `${escapeHtml(address)} <span class="remove-x" title="Remove">✕</span>`;
    li.querySelector(".remove-x").onclick = () => removeEmailRecipient(field, address);
    list.appendChild(li);
  });
}

function addEmailRecipient(field, address) {
  const clean = address.trim().toLowerCase();
  if (!clean || emailRecipients[field].includes(clean)) return;
  emailRecipients[field].push(clean);
  renderEmailChips(field);
}

function removeEmailRecipient(field, address) {
  emailRecipients[field] = emailRecipients[field].filter((a) => a !== address);
  renderEmailChips(field);
}

function onEmailRecipientInput(field, query) {
  clearTimeout(emailSearchDebounce);
  const resultsList = document.getElementById(field === "to" ? "emailToResults" : "emailCcResults");
  if (!query.trim()) {
    resultsList.innerHTML = "";
    return;
  }
  emailSearchDebounce = setTimeout(() => searchEmailDirectory(field, query.trim()), 250);
}

async function searchEmailDirectory(field, query) {
  const resultsList = document.getElementById(field === "to" ? "emailToResults" : "emailCcResults");
  try {
    const matches = await api(`/api/users/search?q=${encodeURIComponent(query)}`);
    resultsList.innerHTML = "";
    matches.slice(0, 6).forEach((u) => {
      const email = u.userPrincipalName;
      const li = document.createElement("li");
      li.className = "chip result-chip";
      li.textContent = `${u.displayName} — ${email}`;
      li.onclick = () => {
        addEmailRecipient(field, email);
        document.getElementById(field === "to" ? "emailToInput" : "emailCcInput").value = "";
        resultsList.innerHTML = "";
      };
      resultsList.appendChild(li);
    });
  } catch (err) {
    resultsList.innerHTML = "";
  }
}

function onEmailRecipientKeydown(event, field) {
  if (event.key !== "Enter" && event.key !== ",") return;
  const input = document.getElementById(field === "to" ? "emailToInput" : "emailCcInput");
  const value = input.value.trim().replace(/,$/, "");
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (value && emailPattern.test(value)) {
    event.preventDefault();
    addEmailRecipient(field, value);
    input.value = "";
    document.getElementById(field === "to" ? "emailToResults" : "emailCcResults").innerHTML = "";
  }
}

function cancelWelcomeEmail() {
  document.getElementById("emailPreviewModal").hidden = true;
  if (lastFocusedBeforeModal) {
    lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }
  if (pendingEmailResolve) {
    pendingEmailResolve({ sent: false, skipped: true });
    pendingEmailResolve = null;
  }
}

async function confirmSendWelcomeEmail() {
  if (emailRecipients.to.length === 0) {
    showToast("Add at least one To recipient before sending.", "error");
    return;
  }

  const sendBtn = document.getElementById("emailPreviewSendBtn");
  sendBtn.disabled = true;
  sendBtn.innerHTML = '<span class="spinner spinner-on-btn"></span> Sending...';

  try {
    await api("/api/users/send-welcome-email", {
      method: "POST",
      body: JSON.stringify({
        ...pendingEmailParams,
        to: emailRecipients.to,
        cc: emailRecipients.cc,
      }),
    });
    document.getElementById("emailPreviewModal").hidden = true;
    if (lastFocusedBeforeModal) {
      lastFocusedBeforeModal.focus();
      lastFocusedBeforeModal = null;
    }
    if (pendingEmailResolve) {
      pendingEmailResolve({ sent: true });
      pendingEmailResolve = null;
    }
  } catch (err) {
    sendBtn.disabled = false;
    sendBtn.textContent = "Send email";
    document.getElementById("emailPreviewModal").hidden = true;
    if (lastFocusedBeforeModal) {
      lastFocusedBeforeModal.focus();
      lastFocusedBeforeModal = null;
    }
    if (pendingEmailResolve) {
      pendingEmailResolve({ sent: false, error: err.message });
      pendingEmailResolve = null;
    }
  }
}

// Escape closes whichever modal is currently open - none of the three
// modals could previously be dismissed from the keyboard at all.
document.addEventListener("keydown", (evt) => {
  if (evt.key !== "Escape") return;
  const confirmModal = document.getElementById("confirmModal");
  const listModal = document.getElementById("listModal");
  const emailModal = document.getElementById("emailPreviewModal");
  const helpModal = document.getElementById("helpModal");
  if (confirmModal && !confirmModal.hidden) {
    closeConfirm();
  } else if (listModal && !listModal.hidden) {
    closeListModal();
  } else if (emailModal && !emailModal.hidden) {
    cancelWelcomeEmail();
  } else if (helpModal && !helpModal.hidden) {
    closeHelpModal();
  }
});

/* ================= Distro List tab ================= */

let allGroupsCache = [];
let distroSearchDebounce = null;
let currentDistroGroup = null;

async function onDistroSearchInput() {
  const q = document.getElementById("distroSearch").value.trim();
  const resultsList = document.getElementById("distroSearchResults");
  const errBox = document.getElementById("distroError");
  const spinner = document.getElementById("distroSearchSpinner");
  document.getElementById("distroPanel").hidden = true;

  clearTimeout(distroSearchDebounce);
  if (!q) {
    resultsList.innerHTML = "";
    errBox.hidden = true;
    spinner.hidden = true;
    return;
  }
  spinner.hidden = false;
  distroSearchDebounce = setTimeout(() => searchDistroGroups(q), 250);
}

async function searchDistroGroups(q) {
  const resultsList = document.getElementById("distroSearchResults");
  const errBox = document.getElementById("distroError");
  const spinner = document.getElementById("distroSearchSpinner");

  try {
    if (allGroupsCache.length === 0) {
      allGroupsCache = await api("/api/groups");
    }
    const matches = allGroupsCache.filter((g) =>
      g.displayName.toLowerCase().includes(q.toLowerCase())
    );
    spinner.hidden = true;
    resultsList.innerHTML = "";

    if (matches.length === 0) {
      errBox.classList.add("error-box");
      errBox.textContent = "No matching groups found.";
      errBox.hidden = false;
      return;
    }
    errBox.hidden = true;
    matches.slice(0, 15).forEach((g) => {
      const li = document.createElement("li");
      li.className = "chip result-chip";
      li.textContent = g.displayName;
      li.onclick = () => selectDistroGroup(g.id);
      resultsList.appendChild(li);
    });
  } catch (err) {
    spinner.hidden = true;
    errBox.classList.add("error-box");
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
  }
}

async function selectDistroGroup(groupId) {
  document.getElementById("distroSearchResults").innerHTML = "";
  const errBox = document.getElementById("distroError");
  errBox.classList.remove("error-box");
  errBox.innerHTML = '<span class="spinner"></span> Loading group...';
  errBox.hidden = false;

  try {
    const detail = await api(`/api/groups/${groupId}/detail`);
    currentDistroGroup = detail;
    errBox.hidden = true;
    renderDistroGroup(detail);
    document.getElementById("distroPanel").hidden = false;
  } catch (err) {
    errBox.classList.add("error-box");
    errBox.textContent = "Error: " + err.message;
    errBox.hidden = false;
  }
}

function renderDistroGroup(g) {
  document.getElementById("distroName").textContent = g.displayName;
  document.getElementById("distroMail").textContent = g.mail || "(no email address)";
  document.getElementById("distroType").textContent = g.type;
  document.getElementById("distroNewName").value = g.displayName;
  document.getElementById("distroNewNickname").value = "";

  const memberList = document.getElementById("distroMembersList");
  memberList.innerHTML = "";
  g.members.forEach((m) => {
    const li = document.createElement("li");
    li.className = "chip";
    li.innerHTML = `${escapeHtml(m.displayName)} <span class="remove-x" title="Remove member">✕</span>`;
    li.querySelector(".remove-x").onclick = () =>
      confirmAction(`Remove ${m.displayName} from this group?`, () =>
        distroPersonAction("member", "remove", m.userPrincipalName, m.displayName)
      );
    memberList.appendChild(li);
  });

  const ownerList = document.getElementById("distroOwnersList");
  ownerList.innerHTML = "";
  g.owners.forEach((o) => {
    const li = document.createElement("li");
    li.className = "chip";
    li.innerHTML = `${escapeHtml(o.displayName)} <span class="remove-x" title="Remove owner">✕</span>`;
    li.querySelector(".remove-x").onclick = () =>
      confirmAction(`Remove ${o.displayName} as an owner of this group?`, () =>
        distroPersonAction("owner", "remove", o.userPrincipalName, o.displayName)
      );
    ownerList.appendChild(li);
  });

  document.getElementById("distroMemberResult").textContent = "";
  document.getElementById("distroOwnerResult").textContent = "";
  document.getElementById("distroRenameResult").textContent = "";
}

function switchDistroSection(name) {
  document.querySelectorAll("#distroPanel .menu-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.section === name);
  });
  ["members", "owners", "rename"].forEach((s) => {
    document.getElementById(`distro-section-${s}`).hidden = s !== name;
  });
}

let distroPersonDebounce = null;

function onDistroPersonInput(kind, query) {
  clearTimeout(distroPersonDebounce);
  const resultsList = document.getElementById(kind === "member" ? "distroMemberResults" : "distroOwnerResults");
  if (!query.trim()) {
    resultsList.innerHTML = "";
    return;
  }
  distroPersonDebounce = setTimeout(() => searchDistroPerson(kind, query.trim()), 250);
}

async function searchDistroPerson(kind, q) {
  const resultsList = document.getElementById(kind === "member" ? "distroMemberResults" : "distroOwnerResults");
  try {
    const matches = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
    resultsList.innerHTML = "";
    matches.slice(0, 6).forEach((u) => {
      const li = document.createElement("li");
      li.className = "chip result-chip";
      li.textContent = `${u.displayName} — ${u.userPrincipalName}`;
      li.onclick = () => {
        distroPersonAction(kind, "add", u.userPrincipalName, u.displayName);
        resultsList.innerHTML = "";
        document.getElementById(kind === "member" ? "distroMemberSearch" : "distroOwnerSearch").value = "";
      };
      resultsList.appendChild(li);
    });
  } catch (err) {
    resultsList.innerHTML = "";
  }
}

async function distroPersonAction(kind, action, upn, displayName) {
  if (!currentDistroGroup) return;
  const resultBox = document.getElementById(kind === "member" ? "distroMemberResult" : "distroOwnerResult");
  resultBox.innerHTML = '<span class="spinner"></span> Working...';
  try {
    const endpoint = kind === "member"
      ? (action === "add" ? "/api/groups/add-member" : "/api/groups/remove-member")
      : (action === "add" ? "/api/groups/add-owner" : "/api/groups/remove-owner");
    await api(endpoint, {
      method: "POST",
      body: JSON.stringify({ upn, groupId: currentDistroGroup.id }),
    });
    resultBox.textContent = `Done: ${action === "add" ? "added" : "removed"} ${displayName}.`;
    showToast(`${displayName} ${action === "add" ? "added to" : "removed from"} ${kind === "member" ? "group" : "owners"}.`, "success");
    selectDistroGroup(currentDistroGroup.id);
  } catch (err) {
    resultBox.textContent = "Error: " + err.message;
    showToast("Error: " + err.message, "error");
  }
}

async function renameDistroGroup() {
  if (!currentDistroGroup) return;
  const displayName = document.getElementById("distroNewName").value.trim();
  const mailNickname = document.getElementById("distroNewNickname").value.trim();
  const resultBox = document.getElementById("distroRenameResult");

  if (!displayName) {
    resultBox.classList.add("error-box");
    resultBox.textContent = "A group name is required.";
    return;
  }

  resultBox.classList.remove("error-box");
  resultBox.innerHTML = '<span class="spinner"></span> Saving...';
  try {
    await api("/api/groups/rename", {
      method: "POST",
      body: JSON.stringify({
        groupId: currentDistroGroup.id,
        displayName,
        mailNickname: mailNickname || undefined,
      }),
    });
    resultBox.textContent = `Renamed to "${displayName}".`;
    showToast("Group renamed.", "success");
    allGroupsCache = []; // stale now, refetch next search
    selectDistroGroup(currentDistroGroup.id);
  } catch (err) {
    resultBox.classList.add("error-box");
    resultBox.textContent = "Error: " + err.message;
    showToast("Error: " + err.message, "error");
  }
}

/* ================= Shared CSV / bulk-upload infrastructure ================= */

// Minimal CSV line splitter - handles quoted fields containing commas
// (e.g. "Doe, Jane") without needing a full CSV library for what's a
// small, simple format.
function splitCsvLine(line) {
  const result = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { result.push(cur); cur = ""; }
      else cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = (values[i] || "").trim()));
    return row;
  });
}

function downloadSampleCsv(filename, headers, sampleRows) {
  const escapeCell = (v) => (String(v).includes(",") ? `"${v}"` : v);
  const lines = [headers.map(escapeCell).join(",")];
  sampleRows.forEach((row) => lines.push(row.map(escapeCell).join(",")));
  const blob = new Blob([lines.join("\r\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Shared bulk-upload cache, keyed by the file input's id, so each of
// the four bulk sections can hold its own parsed rows independently.
const bulkFileCache = {};

function handleBulkFile(fileInputId, previewId, requiredColumns) {
  const input = document.getElementById(fileInputId);
  const preview = document.getElementById(previewId);
  const runBtnId = fileInputId.replace("File", "RunBtn");
  const runBtn = document.getElementById(runBtnId);
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCsv(reader.result);
    const missing = requiredColumns.filter((c) => rows.length === 0 || !(c in rows[0]));
    if (rows.length === 0) {
      preview.innerHTML = '<p class="error-box result-box">No data rows found in that file.</p>';
      if (runBtn) runBtn.hidden = true;
      return;
    }
    if (missing.length > 0) {
      preview.innerHTML = `<p class="error-box result-box">Missing required column(s): ${missing.join(", ")}. Expected: ${requiredColumns.join(", ")}.</p>`;
      if (runBtn) runBtn.hidden = true;
      return;
    }
    bulkFileCache[fileInputId] = rows;
    preview.innerHTML = `<p class="note">${rows.length} row${rows.length === 1 ? "" : "s"} ready — first few: ${escapeHtml(
      rows.slice(0, 3).map((r) => Object.values(r).join(" / ")).join("; ")
    )}${rows.length > 3 ? "…" : ""}</p>`;
    if (runBtn) runBtn.hidden = false;
  };
  reader.readAsText(file);
}

function bulkLog(logId, line, cssClass) {
  const box = document.getElementById(logId);
  const row = document.createElement("div");
  if (cssClass) row.className = cssClass;
  row.textContent = line;
  box.appendChild(row);
  box.scrollTop = box.scrollHeight;
}

/* ---- Bulk manage groups (Distro List tab) ---- */

async function runBulkDistro() {
  const rows = bulkFileCache["bulkDistroFile"];
  if (!rows || rows.length === 0) return;
  const logBox = document.getElementById("bulkDistroLog");
  const runBtn = document.getElementById("bulkDistroRunBtn");
  logBox.innerHTML = "";
  runBtn.disabled = true;

  if (allGroupsCache.length === 0) {
    allGroupsCache = await api("/api/groups");
  }

  let ok = 0, fail = 0;
  for (const row of rows) {
    const group = allGroupsCache.find(
      (g) => g.displayName.toLowerCase() === (row.GroupName || "").toLowerCase()
    );
    const action = (row.Action || "").toLowerCase();
    if (!group) {
      bulkLog("bulkDistroLog", `✕ ${row.GroupName}: group not found`, "bulk-log-fail");
      fail++;
      continue;
    }
    if (action !== "add" && action !== "remove") {
      bulkLog("bulkDistroLog", `✕ ${row.Email}: Action must be "Add" or "Remove", got "${row.Action}"`, "bulk-log-fail");
      fail++;
      continue;
    }
    try {
      await api(action === "add" ? "/api/groups/add-member" : "/api/groups/remove-member", {
        method: "POST",
        body: JSON.stringify({ upn: row.Email, groupId: group.id }),
      });
      bulkLog("bulkDistroLog", `✓ ${row.Email} — ${action === "add" ? "added to" : "removed from"} ${row.GroupName}`, "bulk-log-ok");
      ok++;
    } catch (err) {
      bulkLog("bulkDistroLog", `✕ ${row.Email} (${row.GroupName}): ${err.message}`, "bulk-log-fail");
      fail++;
    }
  }
  bulkLog("bulkDistroLog", `Done — ${ok} succeeded, ${fail} failed.`);
  runBtn.disabled = false;
  showToast(`Bulk group update finished: ${ok} succeeded, ${fail} failed.`, fail > 0 ? "error" : "success");
}

/* ---- Bulk offboard (Offboarding tab) ---- */

async function runBulkOffboard() {
  const rows = bulkFileCache["bulkOffboardFile"];
  if (!rows || rows.length === 0) return;
  const logBox = document.getElementById("bulkOffboardLog");
  const runBtn = document.getElementById("bulkOffboardRunBtn");
  logBox.innerHTML = "";
  runBtn.disabled = true;

  // Downloadable paper trail of exactly who was offboarded and when,
  // same pattern as bulk onboard's results CSV - useful for HR/audit
  // records since this is a destructive bulk action.
  const results = [];
  let ok = 0, fail = 0;
  for (const row of rows) {
    if (!row.Email) {
      bulkLog("bulkOffboardLog", `✕ (blank row): missing Email`, "bulk-log-fail");
      fail++;
      continue;
    }
    try {
      await api("/api/offboarding/run", {
        method: "POST",
        body: JSON.stringify({ upn: row.Email }),
      });
      bulkLog("bulkOffboardLog", `✓ ${row.Email} — offboarded`, "bulk-log-ok");
      results.push({ email: row.Email, status: "Offboarded" });
      ok++;
    } catch (err) {
      bulkLog("bulkOffboardLog", `✕ ${row.Email}: ${err.message}`, "bulk-log-fail");
      results.push({ email: row.Email, status: `Failed: ${err.message}` });
      fail++;
    }
  }
  bulkLog("bulkOffboardLog", `Done — ${ok} succeeded, ${fail} failed.`);
  runBtn.disabled = false;
  showToast(`Bulk offboard finished: ${ok} succeeded, ${fail} failed.`, fail > 0 ? "error" : "success");
  loadPendingOffboarding();

  if (results.length > 0) {
    downloadSampleCsv(
      `bulk-offboard-results-${Date.now()}.csv`,
      ["Email", "Status"],
      results.map((r) => [r.email, r.status])
    );
    bulkLog("bulkOffboardLog", `Downloaded a CSV of ${results.length} offboard results for your records.`);
  }
}

/* ---- Bulk onboard (Onboarding tab) ---- */

async function runBulkOnboard() {
  const rows = bulkFileCache["bulkOnboardFile"];
  if (!rows || rows.length === 0) return;
  const logBox = document.getElementById("bulkOnboardLog");
  const runBtn = document.getElementById("bulkOnboardRunBtn");
  logBox.innerHTML = "";
  runBtn.disabled = true;

  // Look up the real SKU ID for "Microsoft 365 Business Standard" once,
  // from the tenant's actual license list - never hardcode a GUID,
  // SKU IDs are tenant-specific. If the tenant doesn't have this SKU
  // at all, license assignment is skipped for every row (logged once,
  // not once per row) rather than silently failing per-account.
  let businessStandardSkuId = null;
  try {
    const skus = await api("/api/licenses");
    const match = skus.find((s) => s.friendlyName === "Microsoft 365 Business Standard");
    if (match) businessStandardSkuId = match.skuId;
  } catch (err) {
    // handled below via the null check
  }
  if (!businessStandardSkuId) {
    bulkLog("bulkOnboardLog", `⚠ Couldn't find "Microsoft 365 Business Standard" in this tenant's licenses — accounts will still be created, just without a license assigned.`, "bulk-log-fail");
  }

  // No per-account email preview like the single-user flow has (that
  // wouldn't scale to reviewing dozens of emails one at a time) - so
  // temp passwords get collected here and handed back as one CSV at
  // the end instead, otherwise there'd be no way to know them at all
  // for anyone who didn't get a PreferredEmail.
  const createdAccounts = [];
  let ok = 0, fail = 0;

  for (const row of rows) {
    if (!row.FirstName || !row.LastName || !row.Username) {
      bulkLog("bulkOnboardLog", `✕ (row missing required fields): FirstName, LastName, and Username are all required`, "bulk-log-fail");
      fail++;
      continue;
    }
    const upn = `${row.Username}@${adminDomain}`;
    try {
      const data = await api("/api/users/create", {
        method: "POST",
        body: JSON.stringify({
          firstName: row.FirstName,
          lastName: row.LastName,
          upn,
          department: row.Department || undefined,
          jobTitle: row.JobTitle || undefined,
          usageLocation: row.UsageLocation || undefined,
        }),
      });
      bulkLog("bulkOnboardLog", `✓ ${upn} — created`, "bulk-log-ok");
      createdAccounts.push({ email: upn, password: data.temporaryPassword });
      ok++;

      if (businessStandardSkuId) {
        try {
          await api("/api/licenses/assign", {
            method: "POST",
            body: JSON.stringify({ upn, skuId: businessStandardSkuId, countryCode: row.UsageLocation || undefined }),
          });
          bulkLog("bulkOnboardLog", `  ✓ ${upn} — Business Standard license assigned`, "bulk-log-ok");
        } catch (err) {
          bulkLog("bulkOnboardLog", `  ⚠ ${upn}: account created, but license assignment failed — ${err.message}`, "bulk-log-fail");
        }
      }

      if (row.PreferredEmail && row.PreferredEmail.trim()) {
        try {
          await api("/api/users/send-welcome-email", {
            method: "POST",
            body: JSON.stringify({
              displayName: `${row.FirstName} ${row.LastName}`,
              upn,
              tempPassword: data.temporaryPassword,
              to: [row.PreferredEmail.trim()],
            }),
          });
          bulkLog("bulkOnboardLog", `  ✓ ${upn} — credentials emailed to ${row.PreferredEmail.trim()}`, "bulk-log-ok");
        } catch (err) {
          bulkLog("bulkOnboardLog", `  ⚠ ${upn}: account created, but credential email failed — ${err.message}`, "bulk-log-fail");
        }
      }
    } catch (err) {
      bulkLog("bulkOnboardLog", `✕ ${upn}: ${err.message}`, "bulk-log-fail");
      fail++;
    }
  }

  bulkLog("bulkOnboardLog", `Done — ${ok} succeeded, ${fail} failed.`);
  runBtn.disabled = false;
  showToast(`Bulk onboard finished: ${ok} succeeded, ${fail} failed.`, fail > 0 ? "error" : "success");

  if (createdAccounts.length > 0) {
    downloadSampleCsv(
      `bulk-onboard-results-${Date.now()}.csv`,
      ["Email", "TemporaryPassword"],
      createdAccounts.map((a) => [a.email, a.password])
    );
    bulkLog("bulkOnboardLog", `Downloaded a CSV of ${createdAccounts.length} new account credentials — these are plaintext passwords, so store that file securely and delete it once distributed.`);
  }
}

/* ---- Bulk manage users (Manage User tab) ---- */

let bulkManageAction = "reset-password";

function selectBulkManageAction(action) {
  bulkManageAction = action;
  document.querySelectorAll("#bulkManageActionOptions .settings-option").forEach((b) => {
    b.classList.toggle("active", b.dataset.action === action);
  });
}

function confirmBulkManageUsers() {
  const rows = bulkFileCache["bulkManageFile"];
  if (!rows || rows.length === 0) return;
  const messages = {
    "reset-password": `Reset the password for all ${rows.length} users in this file? Each of them will be emailed their new temporary password automatically.`,
    enable: `Enable all ${rows.length} accounts in this file?`,
    disable: `Disable all ${rows.length} accounts in this file? This also revokes their active sessions immediately, signing them out everywhere.`,
  };
  confirmAction(messages[bulkManageAction], runBulkManageUsers);
}

async function runBulkManageUsers() {
  const rows = bulkFileCache["bulkManageFile"];
  if (!rows || rows.length === 0) return;
  const logBox = document.getElementById("bulkManageLog");
  const runBtn = document.getElementById("bulkManageRunBtn");
  logBox.innerHTML = "";
  runBtn.disabled = true;

  let ok = 0, fail = 0;
  for (const row of rows) {
    if (!row.Email) {
      bulkLog("bulkManageLog", `✕ (blank row): missing Email`, "bulk-log-fail");
      fail++;
      continue;
    }
    try {
      if (bulkManageAction === "reset-password") {
        const data = await api("/api/users/reset-password", {
          method: "POST",
          body: JSON.stringify({ upn: row.Email }),
        });
        bulkLog(
          "bulkManageLog",
          `✓ ${row.Email} — password reset${data.emailSent ? ", emailed to them" : " (email failed to send, check manually)"}`,
          "bulk-log-ok"
        );
      } else {
        await api("/api/users/set-enabled", {
          method: "POST",
          body: JSON.stringify({ upn: row.Email, enabled: bulkManageAction === "enable" }),
        });
        bulkLog("bulkManageLog", `✓ ${row.Email} — ${bulkManageAction === "enable" ? "enabled" : "disabled"}`, "bulk-log-ok");
      }
      ok++;
    } catch (err) {
      bulkLog("bulkManageLog", `✕ ${row.Email}: ${err.message}`, "bulk-log-fail");
      fail++;
    }
  }
  bulkLog("bulkManageLog", `Done — ${ok} succeeded, ${fail} failed.`);
  runBtn.disabled = false;
  showToast(`Bulk action finished: ${ok} succeeded, ${fail} failed.`, fail > 0 ? "error" : "success");
}

/* ================= Help modal ================= */

const HELP_CONTENT = {
  dashboard: {
    title: "Dashboard",
    body: `
      <p>A live snapshot of your tenant, pulled fresh from Microsoft Graph every time you visit this tab.</p>
      <ul>
        <li><strong>Four KPI cards</strong> — Total users, Groups &amp; distro lists, SharePoint sites, Licenses available. Click any of them to open a full searchable list.</li>
        <li><strong>New users chart</strong> — accounts created per day, last 14 days, with a hover tooltip and the biggest day called out.</li>
        <li><strong>New groups &amp; distribution lists chart</strong> — same idea, for groups.</li>
        <li><strong>Groups by type</strong> — a donut breaking your groups down into Microsoft 365 Group / Security group / Distribution group.</li>
        <li><strong>Recently added</strong> — the newest accounts in your tenant, most recent first.</li>
      </ul>
      <p class="note">Everything here is real data from your tenant — nothing is simulated or estimated.</p>
    `,
  },
  manage: {
    title: "Manage User",
    body: `
      <p>Find one person and manage everything about their account.</p>
      <ul>
        <li><strong>Find a user</strong> — search by name or email as you type.</li>
        <li><strong>Account</strong> — enable/disable, reset password, revoke active sessions.</li>
        <li><strong>Licenses</strong> — see what's assigned, add or remove.</li>
        <li><strong>Groups &amp; DLs</strong> — see current membership, add to more groups (with a search filter), remove from any.</li>
        <li><strong>SharePoint Sites</strong> — shows their current site membership (derived from their Microsoft 365 Group memberships), plus a way to add them to a new site directly.</li>
        <li><strong>Contact Info</strong> — edit name, job title, department, office, phone numbers, and address.</li>
        <li><strong>Bulk manage users (CSV)</strong> — pick one action (reset password / enable / disable) and apply it to a whole list of people at once.</li>
      </ul>
    `,
  },
  distro: {
    title: "Distro List",
    body: `
      <p>The group-centric counterpart to Manage User — start from a group instead of a person.</p>
      <ul>
        <li><strong>Find a group</strong> — search by name.</li>
        <li><strong>Members</strong> — see who's in the group, add more (search by name), remove anyone.</li>
        <li><strong>Owners</strong> — same, for group ownership.</li>
        <li><strong>Rename</strong> — change the display name, and optionally the mail nickname (the part before @ in its email address) — kept as a separate, opt-in field since changing the email itself is a bigger, more disruptive change.</li>
        <li><strong>Bulk manage groups (CSV)</strong> — add or remove many people across many different groups in one file, rather than doing it group by group.</li>
      </ul>
    `,
  },
  onboarding: {
    title: "Onboarding",
    body: `
      <p>Create new user accounts, one at a time or in bulk.</p>
      <ul>
        <li><strong>Single form</strong> — first/last name, username (your sign-in domain is added automatically), department, usage location, then optionally assign licenses, groups, and SharePoint sites right away.</li>
        <li>After creating the account, you get a preview of the welcome email — recipients are editable (search your directory or type any email) before anything actually sends.</li>
        <li><strong>Bulk onboard (CSV)</strong> — create many accounts at once. Every account automatically gets a Microsoft 365 Business Standard license. If you include a PreferredEmail for someone, their credentials get emailed straight to them; everyone else's temporary password comes back in a downloadable CSV at the end.</li>
        <li>Group and SharePoint site assignment for bulk-created accounts still happens afterward, via Manage User or the Distro List bulk CSV.</li>
      </ul>
    `,
  },
  offboarding: {
    title: "Offboarding",
    body: `
      <p>Remove access for someone leaving, one at a time or in bulk.</p>
      <ul>
        <li><strong>Single offboard</strong> — removes every group membership and any directly-granted SharePoint site access (group-backed sites are covered by the group removal; sites added the other way need this separate step, which happens automatically), revokes active sessions, silently resets the password (not sent to the user), and marks the account for license removal in 30 days.</li>
        <li><strong>Pending license removals</strong> — shows who's currently due; process one or all at once. This step is manual by design — nothing removes a license automatically in the background.</li>
        <li><strong>Bulk offboard (CSV)</strong> — runs the exact same offboard steps for a whole list of people, and downloads a results CSV (who succeeded, who failed) when it's done.</li>
      </ul>
    `,
  },
  guest: {
    title: "Guest User",
    body: `
      <p>Add an external person (a contractor, a partner) as a guest in your tenant.</p>
      <ul>
        <li>Uses their existing email address — no new mailbox is created.</li>
        <li><strong>No invitation email is sent</strong> — this creates the guest record only; if you want to notify them yourself, that's a separate step outside this tool.</li>
        <li>Optionally assign them to groups right away.</li>
      </ul>
    `,
  },
  audit: {
    title: "Audit Trail",
    body: `
      <p>Entra ID's real directory audit log — who did what, across the tenant.</p>
      <ul>
        <li>Covers user, group, app, and device changes made through the admin portal or the Graph API — not just changes made through this tool.</li>
        <li>Filter by action, person, or target using the search box.</li>
        <li>Unlike sign-in logs, this isn't gated behind an Entra ID Premium license — it should work on Business Standard. Retention is typically around 30 days without an Audit Premium add-on.</li>
      </ul>
    `,
  },
  mail: {
    title: "Mail",
    body: `
      <p>Two genuinely different things live here — worth knowing which is which.</p>
      <ul>
        <li><strong>Email activity report</strong> — real, aggregate per-user send/receive/read counts over 7/30/90 days, from Microsoft Graph's actual reporting API.</li>
        <li><strong>Message trace &amp; mail flow rules</strong> — these are <em>not</em> built into this app, because Microsoft Graph has no API for per-message trace or transport/anti-spam rules at all. This section links directly to the real Exchange admin center tools instead of faking something that wouldn't work.</li>
      </ul>
    `,
  },
  settings: {
    title: "Settings",
    body: `
      <p>Personalization and data export.</p>
      <ul>
        <li><strong>Text size</strong> — four presets, applied instantly, saved on this device.</li>
        <li><strong>Background</strong> — six themes, light and dark variants of each.</li>
        <li><strong>Language</strong> — English or Filipino, translates the sidebar and page titles. Search results, error messages, and exported files stay in English for now.</li>
        <li><strong>Export data</strong> — CSV downloads for all users, all groups, a specific group's members, all SharePoint sites, or a specific site's access list.</li>
      </ul>
    `,
  },
};

function showHelpModal(key) {
  const content = HELP_CONTENT[key];
  if (!content) return;
  document.getElementById("helpModalTitle").textContent = content.title;
  document.getElementById("helpModalBody").innerHTML = content.body;
  lastFocusedBeforeModal = document.activeElement;
  const modal = document.getElementById("helpModal");
  modal.hidden = false;
  modal.querySelector(".modal-close-btn").focus();
}

function closeHelpModal() {
  document.getElementById("helpModal").hidden = true;
  if (lastFocusedBeforeModal) {
    lastFocusedBeforeModal.focus();
    lastFocusedBeforeModal = null;
  }
}

init();
