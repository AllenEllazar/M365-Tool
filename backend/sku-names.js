// Friendly names for common SKU part numbers. Shared between the
// licenses route and the user-overview route so both display the same
// human-readable names.
const FRIENDLY_NAMES = {
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  SPB: "Microsoft 365 Business Premium",
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
};

function friendlyName(skuPartNumber) {
  return FRIENDLY_NAMES[skuPartNumber] || skuPartNumber;
}

module.exports = { FRIENDLY_NAMES, friendlyName };
