const express = require("express");
const crypto = require("crypto");
const { requireAuth } = require("../auth");
const graph = require("../graph");
const { friendlyName } = require("../sku-names");

const router = express.Router();
router.use(requireAuth);

// Standing notification list for the "new account created" email sent
// after Create User finishes. Edit this list directly to change who
// gets notified - it's not read from an env var since it's specific
// app content, not a secret or per-deployment config.
const WELCOME_EMAIL_TO = ["monica.fortu@philtower.net", "pbgono@midc.ph"];
const WELCOME_EMAIL_CC = ["ict.department@philtower.midc.ph"];

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

router.get("/lookup", async (req, res) => {
  try {
    const user = await graph.findUser(token(req), req.query.upn);
    res.json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Search by name, UPN, or email prefix - used by the Manage User search
// box so admins don't need to know the exact UPN.
router.get("/search", async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json([]);
    const result = await graph.searchUsers(token(req), q);
    res.json(result.value || []);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Full profile used by the Manage User tab: base profile + licenses +
// group/DL memberships in one call so the UI can render everything at once.
router.get("/overview", async (req, res) => {
  try {
    const t = token(req);
    const user = await graph.findUser(t, req.query.upn);

    const [licenseDetails, memberOf] = await Promise.all([
      graph.getLicenseDetails(t, user.id),
      graph.getMemberOf(t, user.id),
    ]);

    const licenses = (licenseDetails.value || []).map((l) => ({
      skuId: l.skuId,
      skuPartNumber: l.skuPartNumber,
      friendlyName: friendlyName(l.skuPartNumber),
    }));

    const groups = (memberOf.value || [])
      .filter((g) => g["@odata.type"] !== "#microsoft.graph.directoryRole")
      .map((g) => ({
        id: g.id,
        displayName: g.displayName,
        isM365Group:
          Array.isArray(g.groupTypes) && g.groupTypes.includes("Unified"),
        mailEnabled: g.mailEnabled,
        securityEnabled: g.securityEnabled,
      }));

    // Current SharePoint site membership, derived from M365 Group
    // memberships (most team sites are group-backed - see README).
    // Resolved per group in parallel; a group without a provisioned
    // site yet just doesn't contribute a site, it's not an error for
    // the whole overview.
    const m365Groups = groups.filter((g) => g.isM365Group);
    const siteResults = await Promise.allSettled(
      m365Groups.map((g) => graph.getGroupSite(t, g.id))
    );
    const sites = siteResults
      .map((r, i) =>
        r.status === "fulfilled"
          ? {
              groupId: m365Groups[i].id,
              groupName: m365Groups[i].displayName,
              displayName: r.value.displayName,
              webUrl: r.value.webUrl,
            }
          : null
      )
      .filter(Boolean);

    res.json({ user, licenses, groups, sites });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/reset-password", async (req, res) => {
  try {
    const { upn, newPassword } = req.body;
    const user = await graph.findUser(token(req), upn);
    const password = newPassword || generateTempPassword();
    await graph.resetPassword(token(req), user.id, password, true);

    let emailSent = false;
    let emailError = null;
    const notifyAddress = user.mail || user.userPrincipalName;
    if (notifyAddress) {
      try {
        await graph.sendMail(token(req), {
          to: [notifyAddress],
          subject: "Your Microsoft 365 Password Has Been Reset",
          htmlBody: `
            <p>Hi ${user.displayName || ""},</p>
            <p>Your Microsoft 365 account password has been reset by IT. Please find your new temporary password below.</p>
            <p>
              Email Address: &nbsp; ${user.userPrincipalName}<br/>
              New Temporary Password: &nbsp; ${password}
            </p>
            <p>You will be required to change this password the next time you sign in.</p>
            <p>If you did not expect this change or have any concerns, please contact us right away at
              <a href="mailto:ict.department@philtower.midc.ph">ict.department@philtower.midc.ph</a>.</p>
            <p>Best regards,<br/>IT Department</p>
          `,
        });
        emailSent = true;
      } catch (err) {
        emailError = err.message;
      }
    }

    res.json({ success: true, temporaryPassword: password, emailSent, emailError });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/set-enabled", async (req, res) => {
  try {
    const { upn, enabled } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.setAccountEnabled(token(req), user.id, !!enabled);
    if (!enabled) {
      await graph.revokeSessions(token(req), user.id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Standalone "revoke active sessions" action - independent of disabling
// the account, for cases like a lost device or suspected compromise
// where the account should stay enabled but get signed out everywhere.
router.post("/revoke-sessions", async (req, res) => {
  try {
    const { upn } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.revokeSessions(token(req), user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/update-profile", async (req, res) => {
  try {
    const {
      upn,
      firstName,
      lastName,
      jobTitle,
      department,
      officeLocation,
      officePhone,
      mobilePhone,
      streetAddress,
      city,
      state,
      postalCode,
      country,
    } = req.body;

    if (!firstName || !lastName) {
      return res
        .status(400)
        .json({ error: "First name and last name are required." });
    }

    const user = await graph.findUser(token(req), upn);
    await graph.updateUserProfile(token(req), user.id, {
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      jobTitle,
      department,
      officeLocation,
      officePhone,
      mobilePhone,
      streetAddress,
      city,
      state,
      postalCode,
      country,
    });

    res.json({ success: true, displayName: `${firstName} ${lastName}` });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/set-usage-location", async (req, res) => {
  try {
    const { upn, countryCode } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.setUsageLocation(token(req), user.id, countryCode);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Create a brand-new M365 user. License / group / site assignment for the
// new user are separate follow-up calls made by the frontend to the
// existing licenses/groups/sites endpoints, keyed off the returned upn.
router.post("/create", async (req, res) => {
  try {
    const { firstName, lastName, upn, usageLocation, password, department, jobTitle } = req.body;

    if (!firstName || !lastName || !upn) {
      return res
        .status(400)
        .json({ error: "First name, last name, and username/email are required." });
    }

    const mailNickname = upn.split("@")[0].replace(/[^a-zA-Z0-9._-]/g, "");
    const tempPassword = password || generateTempPassword();

    const payload = {
      accountEnabled: true,
      displayName: `${firstName} ${lastName}`,
      givenName: firstName,
      surname: lastName,
      mailNickname,
      userPrincipalName: upn,
      passwordProfile: {
        password: tempPassword,
        forceChangePasswordNextSignIn: true,
      },
    };

    if (usageLocation) {
      payload.usageLocation = usageLocation;
    }
    if (department) {
      payload.department = department;
    }
    if (jobTitle) {
      payload.jobTitle = jobTitle;
    }

    const user = await graph.createUser(token(req), payload);
    res.json({ success: true, user, temporaryPassword: tempPassword });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Shared by both the preview and send endpoints below, so what the
// admin previews is guaranteed to be exactly what actually gets sent -
// no separate copy of this template to drift out of sync. to/cc are
// optional overrides - if the admin edits recipients in the preview
// modal, those win; otherwise it falls back to the standing list above.
function buildWelcomeEmail({ displayName, upn, tempPassword, to, cc }) {
  const htmlBody = `
    <p>Hi Sir/Maam,</p>
    <p>We already created you a new email account. Please find email credentials below. Thanks</p>
    <p>
      Email Address: &nbsp; ${upn}<br/>
      Temporary Password: &nbsp; ${tempPassword}
    </p>
    <p>You will be required to change the email password on your first login.</p>
    <p>If you have any further questions or concerns, please don't hesitate to reach out to us at
      <a href="mailto:ict.department@philtower.midc.ph">ict.department@philtower.midc.ph</a>.</p>
    <p>Best regards,<br/>IT Department</p>
  `;
  return {
    to: Array.isArray(to) && to.length ? to : WELCOME_EMAIL_TO,
    cc: Array.isArray(cc) ? cc : WELCOME_EMAIL_CC,
    subject: `New Email Account Created - ${displayName || upn}`,
    htmlBody,
  };
}

// Builds and returns the exact email content WITHOUT sending it, so the
// UI can show the admin what's about to go out before they confirm.
router.post("/welcome-email-preview", (req, res) => {
  const { displayName, upn, tempPassword } = req.body;
  if (!upn || !tempPassword) {
    return res.status(400).json({ error: "upn and tempPassword are required." });
  }
  res.json(buildWelcomeEmail({ displayName, upn, tempPassword }));
});

// Sends the "new account created" notification. If the admin edited
// recipients in the preview modal, `to`/`cc` here reflect that; if
// they never touched them, these still equal the standing list since
// the frontend pre-fills the editor from the preview response.
router.post("/send-welcome-email", async (req, res) => {
  try {
    const { displayName, upn, tempPassword, to, cc } = req.body;
    if (!upn || !tempPassword) {
      return res.status(400).json({ error: "upn and tempPassword are required." });
    }
    if (!Array.isArray(to) || to.length === 0) {
      return res.status(400).json({ error: "At least one To recipient is required." });
    }

    const email = buildWelcomeEmail({ displayName, upn, tempPassword, to, cc });
    await graph.sendMail(token(req), email);

    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
