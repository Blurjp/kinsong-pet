// Reminders are local notifications, so the app never needs push. expo-notifications adds the push
// entitlement anyway, and a free Apple developer account can't sign an app that has it.
const { withEntitlementsPlist } = require("expo/config-plugins");

module.exports = function withoutPush(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults["aps-environment"];
    return c;
  });
};
