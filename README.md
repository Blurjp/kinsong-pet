# Kinsong Pet

A quiet memorial garden by the Rainbow Bridge for a pet who has passed. The pet lives there: it wanders, naps under the memory tree, plays with its favorite toy, and sleeps under the stars at night. It comes when you call, using **your own photos and recordings** of it. Everything stays on the phone.

- `app/` is the Expo (React Native) app. See [app/README.md](app/README.md) for features and product rules.
- `core/` is the pure TypeScript logic shared with the app: remembrance days, the garden, the pet's behaviour, and reading colours from a photo. It has unit tests.
- `docs/MEMORIAL_GARDEN.md` has the market and ethics research behind it.

Split out of [Blurjp/kinsong](https://github.com/Blurjp/kinsong) (`pets/` and `core/`, as of `3ab96c4`).

## Run it

```sh
cd core && npm install && npm test      # core logic tests
cd ../app && npm install && npm test    # app tests
npm run web                             # quick look in a browser
```

### iOS Simulator (needs a Mac with Xcode)

The app only uses modules that ship in Expo Go, so the quickest way is:

```sh
cd app
npx expo start --ios          # boots the default iPhone simulator, installs Expo Go, opens the app
```

For a standalone build installed in the simulator:

```sh
cd app
npx expo run:ios                                 # prebuilds ios/, builds with Xcode, boots a simulator, installs and launches
# pick a device:  npx expo run:ios --device "iPhone 16"
xcrun simctl io booted screenshot garden.png     # screenshot of the running simulator
```

When it first launches you'll see the setup screen ("A garden for your friend"). Fill in a name and the day they passed to reach the garden.
