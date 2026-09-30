const express = require("express");
const crypto = require("crypto");
const { generatePkce, getAuthCodeUrl, acquireTokenByCode } = require("../auth");

const router = express.Router();

// Must exactly match the redirect URI registered on the Azure app
// (Authentication blade, Web platform). Falls back to computing it from
// the incoming request if PUBLIC_URL isn't set - works fine on Render
// since trust proxy is enabled and Render forwards the real proto/host.
function redirectUri(req) {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get("host")}`;
  return `${base}/auth/callback`;
}

router.get("/login", async (req, res) => {
  try {
    const { verifier, challenge } = generatePkce();
    const state = crypto.randomBytes(16).toString("hex");

    req.session.pkceVerifier = verifier;
    req.session.authState = state;

    const url = await getAuthCodeUrl(redirectUri(req), state, challenge);
    res.redirect(url);
  } catch (err) {
    console.error("Failed to start sign-in:", err.message);
    res.status(500).send("Failed to start sign-in: " + err.message);
  }
});

router.get("/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error("Microsoft returned an error on callback:", error, error_description);
    return res
      .status(400)
      .send(`Sign-in failed: ${error} - ${error_description || ""}`);
  }

  if (!code || state !== req.session.authState) {
    return res.status(400).send("Invalid sign-in response (state mismatch or missing code). Please try again.");
  }

  try {
    const result = await acquireTokenByCode(code, redirectUri(req), req.session.pkceVerifier);

    req.session.account = result.account;
    req.session.accessToken = result.accessToken;
    delete req.session.pkceVerifier;
    delete req.session.authState;

    res.redirect("/");
  } catch (err) {
    console.error("Token exchange failed:", err.message);
    res.status(500).send("Sign-in failed: " + err.message);
  }
});

router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

router.get("/me", (req, res) => {
  if (req.session && req.session.account) {
    return res.json({
      signedIn: true,
      name: req.session.account.name,
      username: req.session.account.username,
    });
  }
  res.json({ signedIn: false });
});

module.exports = router;
