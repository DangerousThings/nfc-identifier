module.exports = function (api) {
  api.cache(true);

  const plugins = [];

  // Remove console.log and console.warn in production builds
  // Keep console.error for actual error reporting
  if (process.env.NODE_ENV === 'production') {
    plugins.push([
      'transform-remove-console',
      {exclude: ['error']},
    ]);
  }

  return {
    presets: ['babel-preset-expo'],
    plugins,
  };
};
