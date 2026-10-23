/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = () => ({
  type: "widget",
  name: "KinsongWidget",
  displayName: "Kinsong Pets",
  deploymentTarget: "17.0",
  // Shares the app's group (mirrored from app.json): the app writes the pet's picture and days there.
  colors: { $widgetBackground: "#dcebd0", $accent: "#6a8fc7" },
});
