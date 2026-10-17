// The app imports ../core directly (linked via "file:../core"), so Metro must watch it.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, "../core")];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, "node_modules")];
module.exports = config;
