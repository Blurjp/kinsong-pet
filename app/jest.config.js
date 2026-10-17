module.exports = {
  preset: "jest-expo",
  setupFiles: ["<rootDir>/jest.setup.ts"],
  // ../core is linked into node_modules as raw TypeScript, so it must be transformed too.
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-async-storage/.*|expo(nent)?|@expo(nent)?/.*|react-native-svg|@sinian/core))",
  ],
  testPathIgnorePatterns: ["/node_modules/", "/ios/", "/android/", "/dist/"],
  moduleFileExtensions: ["ios.tsx", "android.tsx", "ios.ts", "android.ts", "ts", "tsx", "ios.js", "android.js", "js", "jsx", "json", "mjs", "cjs"],
  moduleNameMapper: {
    "^@babel/runtime$": "<rootDir>/node_modules/@babel/runtime",
    "^@babel/runtime/(.*)$": "<rootDir>/node_modules/@babel/runtime/$1",
  },
};
