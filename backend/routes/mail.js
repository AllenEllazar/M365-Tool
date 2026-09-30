const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

// Parses Graph's report CSV into objects. Graph's activity reports have
// a fixed, documented column order for each report type.
function parseReportCsv(csvText) {
  const lines = csvText.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/"/g, "").trim());
  return lines.slice(1).map((line) => {
    // Simple CSV split - Graph's report values don't contain embedded commas.
    const values = line.split(",").map((v) => v.replace(/"/g, "").trim());
    const row = {};
    headers.forEach((h, i) => (row[h] = values[i]));
    return row;
  });
}

// This is Graph's real, available mail API - an AGGREGATE per-user
// activity report (send/receive/read counts over a period). It is NOT
// per-message trace (no sender/recipient/subject/delivery-status lookup
// for an individual email) - Microsoft Graph has no API for that at
// all. Genuine message trace only exists in the Exchange admin center.
router.get("/activity", async (req, res) => {
  try {
    const period = req.query.period || "D7";
    const validPeriods = ["D7", "D30", "D90", "D180"];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({ error: "Invalid period." });
    }

    const csvText = await graph.getEmailActivityReport(token(req), period);
    const rows = parseReportCsv(csvText);

    const entries = rows.map((r) => ({
      displayName: r["Display Name"] || r["User Principal Name"],
      userPrincipalName: r["User Principal Name"],
      sendCount: r["Send Count"] || "0",
      receiveCount: r["Receive Count"] || "0",
      readCount: r["Read Count"] || "0",
      lastActivityDate: r["Last Activity Date"],
    }));

    res.json({ period, entries });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
