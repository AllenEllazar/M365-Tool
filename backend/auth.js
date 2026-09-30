const msal = require("@azure/msal-node");
const crypto = require("crypto");

// A real Azure app registration owned by your tenant - this is the
// switch away from the borrowed Microsoft Graph PowerShell client ID
// and device code flow, which proved unreliable (device code responses
// were consistently coming back with empty values in production,
// something no amount of app-side retry logic could fix since the
// failure was happening upstream, before our code ever saw a valid
// response).
//
// Standard OAuth authorization code flow + PKCE, same as the vast
// majority of production web apps use to sign into Microsoft. Still no
// client secret - PKCE proves this instance of the app is who it says
// it is without one, since it's a genuinely public client (the redirect
// lands on our own server, not a third party). Still no hardcoded
// tenant ID - the "common" authority below works whether the app
// registration itself is single-tenant or multi-tenant, since Microsoft
// checks tenant eligibility server-side regardless of which endpoint
// the sign-in request came through.
const CLIENT_ID = process.env.AZURE_CLIENT_ID;

if (!CLIENT_ID) {
  console.error(
    "AZURE_CLIENT_ID is not set. Sign-in will fail until this is configured - see README."
  );
}

const SCOPES = [
  "openid",
  "profile",
  "offline_access",
  "User.ReadWrite.All",
  "Group.ReadWrite.All",
  "Directory.ReadWrite.All",
  "Sites.ReadWrite.All",
  "Mail.Send",
  "User.Invite.All",
  "AuditLog.Read.All",
  "Reports.Read.All",
];

const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: "https://login.microsoftonline.com/common",
  },
};

const pca = new msal.PublicClientApplication(msalConfig);

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function generatePkce() {
  const verifier = base64UrlEncode(crypto.randomBytes(32));
  const challenge = base64UrlEncode(
    crypto.createHash("sha256").update(verifier).digest()
  );
  return { verifier, challenge };
}

async function getAuthCodeUrl(redirectUri, state, codeChallenge) {
  return pca.getAuthCodeUrl({
    scopes: SCOPES,
    redirectUri,
    state,
    codeChallenge,
    codeChallengeMethod: "S256",
  });
}

async function acquireTokenByCode(code, redirectUri, codeVerifier) {
  return pca.acquireTokenByCode({
    code,
    scopes: SCOPES,
    redirectUri,
    codeVerifier,
  });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.account && req.session.accessToken) {
    return next();
  }
  return res.status(401).json({ error: "Not signed in." });
}

module.exports = {
  pca,
  SCOPES,
  generatePkce,
  getAuthCodeUrl,
  acquireTokenByCode,
  requireAuth,
};
