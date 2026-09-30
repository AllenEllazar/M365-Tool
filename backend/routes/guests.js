const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

// Creates an external guest user with no invitation email sent. Optional
// group assignment happens as separate follow-up calls, same pattern as
// Create User's license/group/site assignment.
router.post("/create", async (req, res) => {
  try {
    const { firstName, lastName, externalEmail, department } = req.body;

    if (!firstName || !lastName || !externalEmail) {
      return res.status(400).json({
        error: "First name, last name, and external email are required.",
      });
    }

    const result = await graph.inviteGuest(token(req), {
      displayName: `${firstName} ${lastName}`,
      email: externalEmail,
    });

    // department isn't part of the invitation payload - Graph sets it via
    // a follow-up patch on the created guest user object, same as a
    // regular user's department field.
    if (department && result.invitedUser && result.invitedUser.id) {
      try {
        await graph.graphRequest(token(req), "PATCH", `/users/${result.invitedUser.id}`, {
          department,
        });
      } catch (err) {
        // Non-fatal - the guest account itself was created successfully.
      }
    }

    res.json({
      success: true,
      invitedUser: result.invitedUser,
      inviteRedeemUrl: result.inviteRedeemUrl,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
