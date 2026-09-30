const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");
const { friendlyName } = require("../sku-names");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

async function safeFetch(label, fn) {
  try {
    const value = await fn();
    return { label, ok: true, value };
  } catch (err) {
    console.error(`Dashboard fetch failed [${label}]:`, err.status, err.message);
    return { label, ok: false, error: err.message, status: err.status };
  }
}

function classifyGroup(g) {
  const isM365 = Array.isArray(g.groupTypes) && g.groupTypes.includes("Unified");
  if (isM365) return "Microsoft 365 Group";
  if (g.mailEnabled && g.securityEnabled) return "Mail-enabled security group";
  if (g.securityEnabled) return "Security group";
  if (g.mailEnabled) return "Distribution group";
  return "Other";
}

router.get("/summary", async (req, res) => {
  const t = token(req);

  const [usersResult, groupsResult, sitesResult, skusResult] = await Promise.all([
    safeFetch("users", () =>
      graph.graphRequestAllPages(
        t,
        `/users?$select=id,displayName,userPrincipalName,createdDateTime&$top=999`
      )
    ),
    safeFetch("groups", () => graph.listAllGroups(t)),
    safeFetch("sites", () => graph.listAllSites(t)),
    safeFetch("licenses", () => graph.listSkus(t)),
  ]);

  const errors = [usersResult, groupsResult, sitesResult, skusResult]
    .filter((r) => !r.ok)
    .map((r) => ({ section: r.label, error: r.error, status: r.status }));

  const usersBasic = usersResult.ok ? usersResult.value : [];

  let skuList = [];
  let licensesAvailable = null;
  let licensesTotal = null;
  if (skusResult.ok) {
    skuList = (skusResult.value.value || []).map((s) => ({
      skuPartNumber: s.skuPartNumber,
      friendlyName: friendlyName(s.skuPartNumber),
      total: s.prepaidUnits ? s.prepaidUnits.enabled : 0,
      consumed: s.consumedUnits || 0,
      available: Math.max(0, (s.prepaidUnits ? s.prepaidUnits.enabled : 0) - (s.consumedUnits || 0)),
    }));
    licensesAvailable = skuList.reduce((sum, s) => sum + s.available, 0);
    licensesTotal = skuList.reduce((sum, s) => sum + s.total, 0);
  }

  // Two specific SKUs the dashboard card can toggle between (Philtower ->
  // Business Standard, MIDC -> E3) rather than the misleading sum across
  // every SKU in the tenant, which includes trial/add-on SKUs with huge
  // nominal quotas. Full breakdown is still in skuList for "View all".
  const businessStandard = skuList.find((s) => s.skuPartNumber === 'O365_BUSINESS_PREMIUM');
  const e3 = skuList.find((s) => s.skuPartNumber === 'SPE_E3');
  const businessStandardAvailable = businessStandard ? businessStandard.available : null;
  const e3Available = e3 ? e3.available : null;

  // New users per day for the last 14 days - the only genuinely available
  // historical trend from Graph without a Premium license.
  const days = [];
  const now = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  function buildDailyCounts(items) {
    const countsByDay = Object.fromEntries(days.map((d) => [d, 0]));
    items.forEach((item) => {
      if (!item.createdDateTime) return;
      const day = item.createdDateTime.slice(0, 10);
      if (Object.prototype.hasOwnProperty.call(countsByDay, day)) {
        countsByDay[day]++;
      }
    });
    return days.map((d) => ({ date: d, count: countsByDay[d] }));
  }

  function countLast30(items) {
    const thirtyDaysAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000;
    return items.filter(
      (item) => item.createdDateTime && new Date(item.createdDateTime).getTime() >= thirtyDaysAgo
    ).length;
  }

  const newUsersByDay = buildDailyCounts(usersBasic);
  const newUsersLast30 = countLast30(usersBasic);

  const groupsBasic = groupsResult.ok ? groupsResult.value : [];
  const newGroupsByDay = buildDailyCounts(groupsBasic);
  const newGroupsLast30 = countLast30(groupsBasic);

  const recentUsers = usersBasic
    .filter((u) => u.createdDateTime)
    .sort((a, b) => new Date(b.createdDateTime) - new Date(a.createdDateTime))
    .slice(0, 8)
    .map((u) => ({
      displayName: u.displayName,
      userPrincipalName: u.userPrincipalName,
      createdDateTime: u.createdDateTime,
    }));

  res.json({
    totalUsers: usersResult.ok ? usersBasic.length : null,
    totalGroups: groupsResult.ok ? groupsBasic.length : null,
    totalSites: sitesResult.ok ? sitesResult.value.length : null,
    licensesAvailable,
    licensesTotal,
    businessStandardAvailable,
    e3Available,
    skuList,
    newUsersByDay,
    newUsersLast30,
    newGroupsByDay,
    newGroupsLast30,
    recentUsers,
    errors,

    // Lightweight full lists for the drill-down modals - kept small
    // (name/email/type only) since this is built for a small team's
    // tenant, not a large enterprise directory.
    allUsers: usersResult.ok
      ? usersBasic.map((u) => ({ displayName: u.displayName, userPrincipalName: u.userPrincipalName }))
      : null,
    allGroups: groupsResult.ok
      ? groupsBasic.map((g) => ({ displayName: g.displayName, type: classifyGroup(g) }))
      : null,
    allSites: sitesResult.ok
      ? sitesResult.value.map((s) => ({ displayName: s.displayName || s.name, webUrl: s.webUrl }))
      : null,
  });
});

module.exports = router;
