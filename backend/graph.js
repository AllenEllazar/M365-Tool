const fetch = require("node-fetch");

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphRequest(accessToken, method, path, body, extraHeaders) {
  const url = path.startsWith("http") ? path : `${GRAPH_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(extraHeaders || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return {};

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    const message =
      (data && data.error && data.error.message) ||
      `Graph request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.graphError = data;
    throw err;
  }
  return data;
}

// Follows @odata.nextLink until exhausted, collecting all `value` items.
// Used for exports where a full tenant-wide list is needed rather than
// a single page.
async function graphRequestAllPages(accessToken, path, extraHeaders) {
  let items = [];
  let nextPath = path;
  while (nextPath) {
    const data = await graphRequest(accessToken, "GET", nextPath, null, extraHeaders);
    items = items.concat(data.value || []);
    nextPath = data["@odata.nextLink"] || null;
  }
  return items;
}

// ---- Users ----
const USER_SELECT =
  "id,displayName,userPrincipalName,mail,accountEnabled,givenName,surname," +
  "department,jobTitle,usageLocation,officeLocation,businessPhones," +
  "mobilePhone,streetAddress,city,state,postalCode,country";

function findUser(token, upnOrEmail) {
  return graphRequest(
    token,
    "GET",
    `/users/${encodeURIComponent(upnOrEmail)}?$select=${USER_SELECT}`
  );
}

// Search by display name, UPN, or email prefix - covers the case where
// the admin doesn't know (or doesn't want to type) the exact UPN.
function searchUsers(token, query) {
  const filter =
    `startswith(displayName,'${escapeODataString(query)}') or ` +
    `startswith(userPrincipalName,'${escapeODataString(query)}') or ` +
    `startswith(mail,'${escapeODataString(query)}')`;

  return graphRequest(
    token,
    "GET",
    `/users?$filter=${encodeURIComponent(filter)}&$select=${USER_SELECT}&$count=true&$top=15`,
    null,
    { ConsistencyLevel: "eventual" }
  );
}

function escapeODataString(str) {
  return String(str).replace(/'/g, "''");
}

function resetPassword(token, userId, newPassword, forceChange = true) {
  return graphRequest(token, "PATCH", `/users/${userId}`, {
    passwordProfile: {
      password: newPassword,
      forceChangePasswordNextSignIn: forceChange,
    },
  });
}

// Updates whichever contact-info fields are provided (undefined ones are
// left untouched - only explicitly-passed keys get sent to Graph).
// officePhone maps to Graph's businessPhones, which is an array even
// though the UI only ever shows one number - matches how the actual
// Microsoft 365 admin center's "Manage contact information" panel works
// under the hood. There's no dedicated "fax number" field in Graph's
// user resource, so that one's intentionally left out rather than
// wired to something that would silently fail to save.
function updateUserProfile(token, userId, fields) {
  const payload = {};
  const map = {
    firstName: "givenName",
    lastName: "surname",
    displayName: "displayName",
    jobTitle: "jobTitle",
    department: "department",
    officeLocation: "officeLocation",
    mobilePhone: "mobilePhone",
    streetAddress: "streetAddress",
    city: "city",
    state: "state",
    postalCode: "postalCode",
    country: "country",
  };
  for (const [key, graphField] of Object.entries(map)) {
    if (fields[key] !== undefined) {
      payload[graphField] = fields[key] || null;
    }
  }
  if (fields.officePhone !== undefined) {
    payload.businessPhones = fields.officePhone ? [fields.officePhone] : [];
  }
  return graphRequest(token, "PATCH", `/users/${userId}`, payload);
}

function setAccountEnabled(token, userId, enabled) {
  return graphRequest(token, "PATCH", `/users/${userId}`, {
    accountEnabled: enabled,
  });
}

function revokeSessions(token, userId) {
  return graphRequest(
    token,
    "POST",
    `/users/${userId}/revokeSignInSessions`,
    {}
  );
}

function setUsageLocation(token, userId, countryCode) {
  return graphRequest(token, "PATCH", `/users/${userId}`, {
    usageLocation: countryCode,
  });
}

function listAllUsersBasic(token) {
  return graphRequestAllPages(
    token,
    `/users?$select=id,displayName,userPrincipalName,department,accountEnabled&$top=999`
  );
}

// ---- Groups ----
function listGroups(token) {
  return graphRequest(
    token,
    "GET",
    `/groups?$select=id,displayName,mailNickname,mailEnabled,securityEnabled,groupTypes&$top=999`
  );
}

function listAllGroups(token) {
  return graphRequestAllPages(
    token,
    `/groups?$select=id,displayName,mail,mailNickname,mailEnabled,securityEnabled,groupTypes,createdDateTime&$top=999`
  );
}

function addUserToGroup(token, groupId, userId) {
  return graphRequest(token, "POST", `/groups/${groupId}/members/$ref`, {
    "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${userId}`,
  });
}

function removeUserFromGroup(token, groupId, userId) {
  return graphRequest(
    token,
    "DELETE",
    `/groups/${groupId}/members/${userId}/$ref`
  );
}

function getGroupById(token, groupId) {
  return graphRequest(token, "GET", `/groups/${groupId}?$select=id,displayName,mail`);
}

function getGroupOwners(token, groupId) {
  return graphRequest(
    token,
    "GET",
    `/groups/${groupId}/owners?$select=displayName,mail,userPrincipalName`
  );
}

function getGroupMembers(token, groupId) {
  return graphRequest(
    token,
    "GET",
    `/groups/${groupId}/members?$select=displayName,mail,userPrincipalName`
  );
}

function addGroupOwner(token, groupId, userId) {
  return graphRequest(token, "POST", `/groups/${groupId}/owners/$ref`, {
    "@odata.id": `https://graph.microsoft.com/v1.0/directoryObjects/${userId}`,
  });
}

function removeGroupOwner(token, groupId, userId) {
  return graphRequest(
    token,
    "DELETE",
    `/groups/${groupId}/owners/${userId}/$ref`
  );
}

// Renaming a group updates displayName (what everyone sees) and, for
// mail-enabled groups, mailNickname (the part before @ in its email
// address) if a new one is explicitly provided - changing the email
// alias is a bigger, more disruptive operation than a display name
// change, so it's opt-in via a separate field rather than automatic.
function renameGroup(token, groupId, displayName, mailNickname) {
  const payload = { displayName };
  if (mailNickname) payload.mailNickname = mailNickname;
  return graphRequest(token, "PATCH", `/groups/${groupId}`, payload);
}

// ---- SharePoint sites ----
async function findSite(token, siteQuery) {
  return graphRequest(
    token,
    "GET",
    `/sites?search=${encodeURIComponent(siteQuery)}`
  );
}

// Uses the same /sites?search= endpoint as findSite() above, which is
// already proven to work with this app's permissions - the alternative
// /sites/getAllSites action is denied on some tenants even for Global
// Admins (SharePoint-level restriction, not something this app controls).
// search=* matches everything. Search-based listing caps around a few
// hundred results; fine for a small team's tenant.
async function listAllSites(token) {
  const data = await graphRequest(token, "GET", `/sites?search=*&$top=200`);
  return data.value || [];
}

function getSiteById(token, siteId) {
  return graphRequest(token, "GET", `/sites/${siteId}?$select=id,displayName,name,webUrl`);
}

// Returns raw site permission entries. SharePoint's permission model is
// less uniform than group membership - this exposes whatever Graph
// returns (roles + granted identity) rather than assuming a fixed shape,
// since the export route needs to handle a few different response forms.
function getSitePermissions(token, siteId) {
  return graphRequest(token, "GET", `/sites/${siteId}/permissions`);
}

function removeSitePermission(token, siteId, permissionId) {
  return graphRequest(
    token,
    "DELETE",
    `/sites/${siteId}/permissions/${permissionId}`
  );
}

// Checks every SharePoint site for a DIRECT permission grant to this
// user (the fallback path addUserToSite uses when a site isn't
// group-backed) and removes any found. This is separate from, and not
// covered by, removing group memberships - a user added to a site via
// the direct-permission fallback keeps that access even after being
// removed from every group, unless this runs too. Checks every site
// in the tenant since Graph has no reverse "which sites does this user
// have direct permission on" query - fine at the scale this app is
// built for (tens of sites, not thousands).
async function removeUserDirectSitePermissions(token, userId) {
  const results = [];

  // listAllSites() already returns the unwrapped array, not a
  // {value: [...]} object - and the whole lookup is best-effort: if it
  // fails for any reason (throttling, a permission edge case on this
  // specific call), that must NOT block the rest of offboarding
  // (session revoke, password reset) from running. This step is a
  // bonus cleanup on top of group removal, not a prerequisite for it.
  let sites;
  try {
    sites = await listAllSites(token);
  } catch (err) {
    results.push({ siteName: "(site lookup)", success: false, error: err.message });
    return results;
  }

  for (const site of sites) {
    let permissions;
    try {
      permissions = await getSitePermissions(token, site.id);
    } catch (err) {
      continue; // site not accessible for permission listing - skip, not a hard failure
    }

    for (const perm of permissions.value || []) {
      // Graph has returned this under a few different shapes across
      // API versions/site types - check all of them rather than
      // assuming one, since guessing wrong means silently missing a
      // permission that should have been removed.
      const identities =
        perm.grantedToIdentitiesV2 ||
        perm.grantedToIdentities ||
        (perm.grantedToV2 ? [perm.grantedToV2] : perm.grantedTo ? [perm.grantedTo] : []);

      const matches = identities.some(
        (identity) => identity.user && identity.user.id === userId
      );
      if (!matches) continue;

      try {
        await removeSitePermission(token, site.id, perm.id);
        results.push({ siteName: site.displayName || site.name, success: true });
      } catch (err) {
        results.push({ siteName: site.displayName || site.name, success: false, error: err.message });
      }
    }
  }

  return results;
}

async function addUserToSite(token, site, userId, userUpn) {
  // If the site is backed by an M365 Group, add via the group membership.
  if (site.id && site.id.includes(",")) {
    // Try to resolve the group behind the site
    const groupLookup = await graphRequest(
      token,
      "GET",
      `/sites/${site.id}/drive?$select=id`
    ).catch(() => null);

    if (site.group && site.group.id) {
      return addUserToGroup(token, site.group.id, userId);
    }
  }

  // Fallback: grant direct site permission (Read)
  return graphRequest(token, "POST", `/sites/${site.id}/permissions`, {
    roles: ["read"],
    grantedToIdentities: [
      {
        user: { id: userId, displayName: userUpn },
      },
    ],
  });
}

// ---- Licenses ----
function listSkus(token) {
  return graphRequest(token, "GET", `/subscribedSkus`);
}

function assignLicense(token, userId, skuId) {
  return graphRequest(token, "POST", `/users/${userId}/assignLicense`, {
    addLicenses: [{ skuId }],
    removeLicenses: [],
  });
}

function removeLicense(token, userId, skuId) {
  return graphRequest(token, "POST", `/users/${userId}/assignLicense`, {
    addLicenses: [],
    removeLicenses: [skuId],
  });
}

function getLicenseDetails(token, userId) {
  return graphRequest(token, "GET", `/users/${userId}/licenseDetails`);
}

function getMemberOf(token, userId) {
  return graphRequest(
    token,
    "GET",
    `/users/${userId}/memberOf?$select=id,displayName,groupTypes,mailEnabled,securityEnabled`
  );
}

// Resolves the SharePoint team site backing a Microsoft 365 Group.
// Only Unified (M365) groups have one - calling this on a plain
// security/distribution group would 404, so callers should filter
// first. Some very new or SharePoint-disabled groups can also lack a
// provisioned site yet, which surfaces as a normal 404 here too -
// callers should treat that as "no site" rather than a hard error.
function getGroupSite(token, groupId) {
  return graphRequest(
    token,
    "GET",
    `/groups/${groupId}/sites/root?$select=id,displayName,webUrl`
  );
}

function createUser(token, payload) {
  return graphRequest(token, "POST", `/users`, payload);
}

// Creates an external guest user via the B2B invitation API with the
// invitation EMAIL suppressed (sendInvitationMessage: false). Graph's
// invitation object is still the correct/only way to provision a real
// guest user in Entra ID - this just stops it from notifying them.
// The guest account exists in "PendingAcceptance" state; they aren't
// told anything happened until you decide to share access some other way.
function inviteGuest(token, { displayName, email, redirectUrl }) {
  return graphRequest(token, "POST", `/invitations`, {
    invitedUserDisplayName: displayName,
    invitedUserEmailAddress: email,
    inviteRedirectUrl: redirectUrl || "https://myapps.microsoft.com",
    sendInvitationMessage: false,
  });
}

// ---- Offboarding: scheduled license removal ----
// Stored directly on the Entra user object (extensionAttribute1) rather
// than in this app's own storage, since Render's disk doesn't survive
// redeploys and this app has no database. Writing it to the user record
// makes it durable regardless of what happens to the app's hosting -
// the marker lives in Microsoft 365 itself.
const OFFBOARD_MARKER_PREFIX = "OFFBOARD_LICENSE_REMOVAL:";

function setOffboardMarker(token, userId, dueDateIso) {
  return graphRequest(token, "PATCH", `/users/${userId}`, {
    onPremisesExtensionAttributes: {
      extensionAttribute1: `${OFFBOARD_MARKER_PREFIX}${dueDateIso}`,
    },
  });
}

function clearOffboardMarker(token, userId) {
  return graphRequest(token, "PATCH", `/users/${userId}`, {
    onPremisesExtensionAttributes: { extensionAttribute1: null },
  });
}

// Scans all users for the marker client-side, since Graph's $filter
// support for onPremisesExtensionAttributes sub-properties is unreliable
// with startswith(). Fine at the "small team" scale this app targets.
async function listUsersWithOffboardMarker(token) {
  const users = await graphRequestAllPages(
    token,
    `/users?$select=id,displayName,userPrincipalName,onPremisesExtensionAttributes&$top=999`
  );
  return users
    .filter(
      (u) =>
        u.onPremisesExtensionAttributes &&
        typeof u.onPremisesExtensionAttributes.extensionAttribute1 === "string" &&
        u.onPremisesExtensionAttributes.extensionAttribute1.startsWith(OFFBOARD_MARKER_PREFIX)
    )
    .map((u) => ({
      id: u.id,
      displayName: u.displayName,
      userPrincipalName: u.userPrincipalName,
      dueDate: u.onPremisesExtensionAttributes.extensionAttribute1.slice(OFFBOARD_MARKER_PREFIX.length),
    }));
}

// Sends from whichever admin is currently signed into this app (Graph's
// /me/sendMail always sends as the caller, not a shared mailbox) -
// see README for what that means in practice.
function sendMail(token, { to, cc, subject, htmlBody }) {
  return graphRequest(token, "POST", `/me/sendMail`, {
    message: {
      subject,
      body: { contentType: "HTML", content: htmlBody },
      toRecipients: (to || []).map((address) => ({ emailAddress: { address } })),
      ccRecipients: (cc || []).map((address) => ({ emailAddress: { address } })),
    },
    saveToSentItems: true,
  });
}

// ---- Audit trail ----
// Directory audit logs cover admin actions across the tenant (user,
// group, app, device changes, password resets, etc.) - unlike sign-in
// logs, this one is NOT gated behind an Entra ID Premium license, so it
// should work on Business Standard. $top caps at 999 in practice;
// Graph also caps how far back you can query without an Audit Premium
// add-on (typically 30 days), which shows up as a normal empty/short
// result rather than an error.
function getDirectoryAudits(token, top = 50) {
  return graphRequest(
    token,
    "GET",
    `/auditLogs/directoryAudits?$top=${top}&$orderby=activityDateTime desc`
  );
}

// ---- Email activity report ----
// This is Graph's real, available API for mail activity - but it's an
// AGGREGATE per-user report (send/receive/read counts over a period),
// not a per-message trace. There is no per-message trace endpoint in
// Microsoft Graph; that's an Exchange-only capability (Message Trace in
// the Exchange admin center), not something this app can replicate.
// Returns CSV text directly from Graph.
async function getEmailActivityReport(token, period = "D7") {
  const res = await fetch(
    `${GRAPH_BASE}/reports/getEmailActivityUserDetail(period='${period}')`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new Error(`Email activity report request failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.text();
}

module.exports = {
  graphRequest,
  graphRequestAllPages,
  findUser,
  searchUsers,
  resetPassword,
  updateUserProfile,
  setAccountEnabled,
  revokeSessions,
  setUsageLocation,
  listAllUsersBasic,
  listGroups,
  listAllGroups,
  addUserToGroup,
  removeUserFromGroup,
  getGroupById,
  getGroupOwners,
  getGroupMembers,
  addGroupOwner,
  removeGroupOwner,
  renameGroup,
  findSite,
  listAllSites,
  getSiteById,
  getSitePermissions,
  removeSitePermission,
  removeUserDirectSitePermissions,
  addUserToSite,
  listSkus,
  assignLicense,
  removeLicense,
  getLicenseDetails,
  getMemberOf,
  getGroupSite,
  createUser,
  inviteGuest,
  sendMail,
  getDirectoryAudits,
  getEmailActivityReport,
  setOffboardMarker,
  clearOffboardMarker,
  listUsersWithOffboardMarker,
};
