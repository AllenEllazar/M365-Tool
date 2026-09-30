const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");
const { friendlyName } = require("../sku-names");
const { toCsv } = require("../csv-utils");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

function sendCsv(res, filename, csv) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}

function safeFilename(name) {
  return (name || "export")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();
}

// All users with department + assigned license(s). One Graph call per
// user for license details - fine for a small team's tenant size; a
// very large tenant would want batching, not implemented here.
router.get("/users", async (req, res) => {
  try {
    const users = await graph.listAllUsersBasic(token(req));

    const rows = await Promise.all(
      users.map(async (u) => {
        let licenseNames = "";
        try {
          const details = await graph.getLicenseDetails(token(req), u.id);
          licenseNames = (details.value || [])
            .map((l) => friendlyName(l.skuPartNumber))
            .join("; ");
        } catch (e) {
          licenseNames = "(error reading licenses)";
        }
        return {
          displayName: u.displayName || "",
          userPrincipalName: u.userPrincipalName || "",
          department: u.department || "",
          accountStatus: u.accountEnabled ? "Enabled" : "Disabled",
          licenses: licenseNames,
        };
      })
    );

    const csv = toCsv(rows, [
      "displayName",
      "userPrincipalName",
      "department",
      "accountStatus",
      "licenses",
    ]);
    sendCsv(res, "users-export.csv", csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// All groups / distribution lists visible via Graph. Classic Exchange
// distribution lists (not mail-enabled security groups) don't appear
// here - Graph has no API for those, same limitation noted elsewhere
// in this app.
router.get("/groups", async (req, res) => {
  try {
    const groups = await graph.listAllGroups(token(req));

    const rows = groups.map((g) => {
      const isM365 =
        Array.isArray(g.groupTypes) && g.groupTypes.includes("Unified");
      let type;
      if (isM365) type = "Microsoft 365 Group";
      else if (g.mailEnabled && g.securityEnabled) type = "Mail-enabled security group";
      else if (g.securityEnabled) type = "Security group";
      else if (g.mailEnabled) type = "Distribution group";
      else type = "Other";

      return {
        displayName: g.displayName || "",
        email: g.mail || "",
        type,
      };
    });

    const csv = toCsv(rows, ["displayName", "email", "type"]);
    sendCsv(res, "groups-distro-lists-export.csv", csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// All SharePoint sites in the tenant.
router.get("/sites", async (req, res) => {
  try {
    const sites = await graph.listAllSites(token(req));

    const rows = sites.map((s) => ({
      displayName: s.displayName || s.name || "",
      url: s.webUrl || "",
    }));

    const csv = toCsv(rows, ["displayName", "url"]);
    sendCsv(res, "sharepoint-sites-export.csv", csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// One specific group/DL's members and owners - not the whole tenant.
router.get("/group/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const [group, owners, members] = await Promise.all([
      graph.getGroupById(token(req), groupId),
      graph.getGroupOwners(token(req), groupId),
      graph.getGroupMembers(token(req), groupId),
    ]);

    const ownerIds = new Set((owners.value || []).map((o) => o.userPrincipalName || o.mail));

    const rows = [
      ...(owners.value || []).map((o) => ({
        displayName: o.displayName || "",
        email: o.mail || o.userPrincipalName || "",
        role: "Owner",
      })),
      ...(members.value || [])
        // Avoid listing someone twice if they're both owner and member
        .filter((m) => !ownerIds.has(m.userPrincipalName || m.mail))
        .map((m) => ({
          displayName: m.displayName || "",
          email: m.mail || m.userPrincipalName || "",
          role: "Member",
        })),
    ];

    const csv = toCsv(rows, ["displayName", "email", "role"]);
    sendCsv(res, `${safeFilename(group.displayName)}-members.csv`, csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// One specific SharePoint site's access list. SharePoint doesn't expose
// a uniform "owner/member" model the way groups do - this reports
// whatever Graph's /permissions endpoint returns for the site (identity
// + role), which is the closest equivalent Graph actually provides.
router.get("/site/:siteId", async (req, res) => {
  try {
    const siteId = decodeURIComponent(req.params.siteId);
    const [site, permissions] = await Promise.all([
      graph.getSiteById(token(req), siteId),
      graph.getSitePermissions(token(req), siteId),
    ]);

    const rows = (permissions.value || []).map((p) => {
      const identityBlock =
        (p.grantedToIdentitiesV2 && p.grantedToIdentitiesV2[0]) ||
        (p.grantedToIdentities && p.grantedToIdentities[0]) ||
        p.grantedToV2 ||
        p.grantedTo ||
        {};
      const identity = identityBlock.user || identityBlock.group || identityBlock.siteUser || {};

      return {
        displayName: identity.displayName || "(unknown)",
        email: identity.email || identity.userPrincipalName || "",
        roles: (p.roles || []).join("; "),
      };
    });

    const csv = toCsv(rows, ["displayName", "email", "roles"]);
    sendCsv(res, `${safeFilename(site.displayName || site.name)}-access.csv`, csv);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
