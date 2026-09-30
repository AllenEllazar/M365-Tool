const express = require("express");
const crypto = require("crypto");
const { requireAuth } = require("../auth");
const graph = require("../graph");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

function generateTempPassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%";
  let pw = "";
  for (let i = 0; i < 14; i++) {
    pw += chars[crypto.randomInt(0, chars.length)];
  }
  return pw;
}

const LICENSE_REMOVAL_DELAY_DAYS = 30;

// Runs the immediate offboarding steps for one user:
//  - remove from every group/DL they currently belong to (also covers
//    group-backed SharePoint sites, since access there flows from
//    group membership)
//  - remove any SharePoint site permissions granted to them directly
//    (sites added via the non-group-backed fallback - group removal
//    above wouldn't touch these on its own)
//  - revoke all active sign-in sessions
//  - reset their password to a random value (never shown/sent to them -
//    this is a lockout, not a credential handoff)
//  - write a durable marker on their Entra user record so the license
//    removal due date survives even if this app restarts/redeploys
//
// It deliberately does NOT touch licenses immediately or disable the
// account - those are separate, more consequential steps left to the
// admin's judgment (disable is already available on the Account tab).
router.post("/run", async (req, res) => {
  try {
    const { upn } = req.body;
    if (!upn) return res.status(400).json({ error: "upn is required." });

    const t = token(req);
    const user = await graph.findUser(t, upn);

    const memberOf = await graph.getMemberOf(t, user.id);
    const groupResults = [];
    for (const g of memberOf.value || []) {
      try {
        await graph.removeUserFromGroup(t, g.id, user.id);
        groupResults.push({ name: g.displayName, success: true });
      } catch (err) {
        groupResults.push({ name: g.displayName, success: false, error: err.message });
      }
    }

    // Group removal above covers group-backed SharePoint sites (most
    // of them). This covers the other path: sites the person was
    // added to directly (the fallback addUserToSite uses for sites
    // that aren't group-backed) - group removal alone wouldn't touch
    // those, leaving access behind otherwise.
    //
    // Wrapped defensively at this level too, on top of the
    // best-effort handling already inside the function itself - this
    // bonus cleanup step must never be able to prevent session revoke
    // and password reset (the actual lockout) from running, regardless
    // of what goes wrong here.
    let siteResults = [];
    try {
      siteResults = await graph.removeUserDirectSitePermissions(t, user.id);
    } catch (err) {
      siteResults = [{ siteName: "(site cleanup)", success: false, error: err.message }];
    }

    await graph.revokeSessions(t, user.id);

    const lockoutPassword = generateTempPassword();
    await graph.resetPassword(t, user.id, lockoutPassword, true);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + LICENSE_REMOVAL_DELAY_DAYS);
    const dueDateIso = dueDate.toISOString().slice(0, 10);
    await graph.setOffboardMarker(t, user.id, dueDateIso);

    res.json({
      success: true,
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      groupsRemoved: groupResults,
      directSitesRemoved: siteResults,
      sessionsRevoked: true,
      passwordReset: true,
      licenseRemovalDueDate: dueDateIso,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Everyone currently carrying a pending license-removal marker, with
// whether their due date has passed.
router.get("/pending", async (req, res) => {
  try {
    const entries = await graph.listUsersWithOffboardMarker(token(req));
    const today = new Date().toISOString().slice(0, 10);
    const withStatus = entries.map((e) => ({
      ...e,
      isDue: e.dueDate <= today,
    }));
    res.json(withStatus);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Removes every license currently assigned to one user and clears their
// offboarding marker. Called explicitly by an admin - see the README
// for why this can't fire on its own after 30 days with nobody signed in.
router.post("/process-license/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const t = token(req);

    const licenseDetails = await graph.getLicenseDetails(t, userId);
    const results = [];
    for (const l of licenseDetails.value || []) {
      try {
        await graph.removeLicense(t, userId, l.skuId);
        results.push({ skuId: l.skuId, success: true });
      } catch (err) {
        results.push({ skuId: l.skuId, success: false, error: err.message });
      }
    }

    await graph.clearOffboardMarker(t, userId);
    res.json({ success: true, licensesRemoved: results });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
