const express = require("express");
const { requireAuth } = require("../auth");
const graph = require("../graph");
const { friendlyName } = require("../sku-names");

const router = express.Router();
router.use(requireAuth);

function token(req) {
  return req.session.accessToken;
}

router.get("/", async (req, res) => {
  try {
    const skus = await graph.listSkus(token(req));
    const value = (skus.value || []).map((s) => ({
      skuId: s.skuId,
      skuPartNumber: s.skuPartNumber,
      friendlyName: friendlyName(s.skuPartNumber),
      total: s.prepaidUnits ? s.prepaidUnits.enabled : 0,
      consumed: s.consumedUnits,
      available: s.prepaidUnits
        ? s.prepaidUnits.enabled - s.consumedUnits
        : 0,
    }));
    res.json(value);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/assign", async (req, res) => {
  try {
    const { upn, skuId, countryCode } = req.body;
    const user = await graph.findUser(token(req), upn);

    if (countryCode) {
      await graph.setUsageLocation(token(req), user.id, countryCode);
    }
    await graph.assignLicense(token(req), user.id, skuId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post("/remove", async (req, res) => {
  try {
    const { upn, skuId } = req.body;
    const user = await graph.findUser(token(req), upn);
    await graph.removeLicense(token(req), user.id, skuId);
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
