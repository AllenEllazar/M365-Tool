const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

// Directory audit log - admin actions across the tenant (user/group/app
// changes, password resets, role assignments, etc). Not gated behind a
// Premium license the way sign-in logs are, but some tenants may still
// restrict it via Conditional Access or role assignment - handled the
// same resilient way as the dashboard's per-section error reporting.
router.get("/logs", async (req, res) => {
  try {
    const top = Math.min(parseInt(req.query.top, 10) || 50, 200);
    const data = await graph.getDirectoryAudits(token(req), top);

    const entries = (data.value || []).map((e) => ({
      activityDateTime: e.activityDateTime,
      activityDisplayName: e.activityDisplayName,
      category: e.category,
      result: e.result,
      resultReason: e.resultReason,
      initiatedBy:
        (e.initiatedBy &&
          ((e.initiatedBy.user && e.initiatedBy.user.userPrincipalName) ||
            (e.initiatedBy.app && e.initiatedBy.app.displayName))) ||
        "Unknown",
      targetResources: (e.targetResources || []).map((t) => ({
        displayName: t.displayName,
        type: t.type,
      })),
    }));

    res.json({ entries });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
