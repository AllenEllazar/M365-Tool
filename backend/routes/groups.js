const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

router.get("/", async (req, res) => {
  try {
    const groups = await graph.listGroups(token(req));
    res.json(groups.value || []);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/add-member", async (req, res) => {
  try {
    const { upn, groupId } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.addUserToGroup(token(req), groupId, user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/remove-member", async (req, res) => {
  try {
    const { upn, groupId } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.removeUserFromGroup(token(req), groupId, user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Full picture of one group for the Distro List tab: basic info, type,
// members, and owners in a single call.
router.get("/:groupId/detail", async (req, res) => {
  try {
    const { groupId } = req.params;
    const t = token(req);

    const [group, members, owners] = await Promise.all([
      graph.graphRequest(
        t,
        "GET",
        `/groups/${groupId}?$select=id,displayName,mail,mailNickname,mailEnabled,securityEnabled,groupTypes`
      ),
      graph.getGroupMembers(t, groupId),
      graph.getGroupOwners(t, groupId),
    ]);

    const isM365Group = Array.isArray(group.groupTypes) && group.groupTypes.includes("Unified");
    const type = isM365Group
      ? "Microsoft 365 Group"
      : group.mailEnabled && group.securityEnabled
      ? "Mail-enabled security group"
      : group.securityEnabled
      ? "Security group"
      : group.mailEnabled
      ? "Distribution group"
      : "Other";

    res.json({
      id: group.id,
      displayName: group.displayName,
      mail: group.mail,
      mailNickname: group.mailNickname,
      type,
      members: (members.value || []).map((m) => ({
        displayName: m.displayName,
        userPrincipalName: m.userPrincipalName || m.mail,
      })),
      owners: (owners.value || []).map((o) => ({
        displayName: o.displayName,
        userPrincipalName: o.userPrincipalName || o.mail,
      })),
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/add-owner", async (req, res) => {
  try {
    const { upn, groupId } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.addGroupOwner(token(req), groupId, user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/remove-owner", async (req, res) => {
  try {
    const { upn, groupId } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.removeGroupOwner(token(req), groupId, user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/rename", async (req, res) => {
  try {
    const { groupId, displayName, mailNickname } = req.body;
    if (!displayName || !displayName.trim()) {
      return res.status(400).json({ error: "A group name is required." });
    }
    await graph.renameGroup(token(req), groupId, displayName.trim(), mailNickname ? mailNickname.trim() : undefined);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
