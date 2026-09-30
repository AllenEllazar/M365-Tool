const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

router.get("/search", async (req, res) => {
  try {
    const result = await graph.findSite(token(req), req.query.q);
    res.json(result.value || []);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/add-member", async (req, res) => {
  try {
    const { upn, siteId, groupId } = req.body;
    const user = await graph.findUser(token(req), upn);

    if (groupId) {
      await graph.addUserToGroup(token(req), groupId, user.id);
    } else {
      await graph.addUserToSite(
        token(req),
        { id: siteId },
        user.id,
        upn
      );
    }
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
