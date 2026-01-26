const {getDefaultConfig} = require('expo/metro-config');
const path = require('path');

const themePackagePath = path.resolve(__dirname, '../react-native-dt-theme');
const appNodeModules = path.resolve(__dirname, 'node_modules');

const config = getDefaultConfig(__dirname);

// Watch the external theme package
config.watchFolders = [themePackagePath];

// Redirect all imports to use app's node_modules (avoids duplicates)
config.resolver.extraNodeModules = {
  'react': path.resolve(appNodeModules, 'react'),
  'react-native': path.resolve(appNodeModules, 'react-native'),
  'react-native-paper': path.resolve(appNodeModules, 'react-native-paper'),
  'react-native-svg': path.resolve(appNodeModules, 'react-native-svg'),
  'react-native-safe-area-context': path.resolve(appNodeModules, 'react-native-safe-area-context'),
};

// Block theme package's node_modules entirely
config.resolver.blockList = [
  new RegExp(`${themePackagePath.replace(/[/\\]/g, '[/\\\\]')}/node_modules/.*`),
];

module.exports = config;
