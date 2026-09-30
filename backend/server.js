require("dotenv").config();
const path = require("path");
const express = require("express");
const session = require("express-session");

const authRoutes = require("./routes/auth-routes");
const userRoutes = require("./routes/users");
const groupRoutes = require("./routes/groups");
const siteRoutes = require("./routes/sites");
const licenseRoutes = require("./routes/licenses");
const exportRoutes = require("./routes/export");
const dashboardRoutes = require("./routes/dashboard");
const offboardingRoutes = require("./routes/offboarding");
const guestRoutes = require("./routes/guests");
const auditRoutes = require("./routes/audit");
const mailRoutes = require("./routes/mail");

const app = express();
const PORT = process.env.PORT || 3000;

app.set("trust proxy", 1);
app.use(express.json());

app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    // saveUninitialized is fine to leave true - the session gets
    // populated with pkceVerifier/authState on the redirect to Microsoft
    // and needs its cookie to persist across that round trip.
    saveUninitialized: true,
    cookie: {
      secure: process.env.COOKIE_SECURE === "true",
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 2, // 2 hours
    },
  })
);

// Optional simple shared-access gate (separate from M365 admin login).
// If SITE_PASSWORD is set, anyone opening the app must enter it once
// before they can even see the sign-in button. Leave blank to disable.
app.use((req, res, next) => {
  const gate = process.env.SITE_PASSWORD;
  if (!gate) return next();

  if (req.path === "/gate" && req.method === "POST") return next();
  if (req.session.gatePassed) return next();
  if (req.path.startsWith("/auth/") || req.path.startsWith("/api/")) {
    if (!req.session.gatePassed) {
      return res.status(401).json({ error: "Access code required." });
    }
  }
  if (req.path === "/" || req.path === "/index.html") {
    return res.sendFile(path.join(__dirname, "public", "gate.html"));
  }
  next();
});

app.post("/gate", express.urlencoded({ extended: false }), (req, res) => {
  if (req.body.code === process.env.SITE_PASSWORD) {
    req.session.gatePassed = true;
  }
  res.redirect("/");
});

app.use("/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/groups", groupRoutes);
app.use("/api/sites", siteRoutes);
app.use("/api/licenses", licenseRoutes);
app.use("/api/export", exportRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/offboarding", offboardingRoutes);
app.use("/api/guests", guestRoutes);
app.use("/api/audit", auditRoutes);
app.use("/api/mail", mailRoutes);

app.use(express.static(path.join(__dirname, "public")));

app.listen(PORT, () => {
  console.log(`M365 onboarding app is running on port ${PORT}`);
});
