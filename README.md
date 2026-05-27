# Monginis Sales Counter

Offline-first mobile app built with Expo and React Native for quickly counting daily Monginis item sales during rush hours.

The app is designed for shop use where staff need a fast tap-based counter, end-of-day quantity reporting, and local history without depending on an internet connection.

## Why this project exists

In many shops, sales are entered later into the official Monginis web app after the rush is over. This app helps staff:

- quickly increase or decrease sold quantities during the day
- search and filter items by category
- add custom items when needed
- review a clean end-of-day report
- keep previous daily reports saved locally

This app does not replace the official Monginis system. It is only a fast daily counting tool.

## Features

- Offline-first workflow
- Local SQLite storage on the device
- Fast counter screen with large plus and minus buttons
- Manual quantity entry for any item
- Search bar for quick item lookup
- Category filters
- Add, edit, and delete custom items
- Today's report view with total quantity sold
- Copy report as text
- Export report as CSV or PDF
- Automatic daily reset after midnight using the phone's local time
- Saved history of previous daily reports
- Backup and restore using a local JSON file

## Default item categories

- `Small Cake Items`
- `Pastries Items`
- `Non-Veg Savouries Items`
- `Veg Savouries Items`

## Tech stack

- Expo
- React Native
- TypeScript
- `expo-sqlite`
- `expo-file-system`
- `expo-document-picker`
- `expo-print`
- `expo-sharing`
- `expo-clipboard`

## Project structure

- `App.tsx` - main app UI and screen flows
- `src/data/database.ts` - SQLite schema, reset logic, reports, backup and restore
- `src/constants/demoItems.ts` - default seeded item catalog
- `src/types.ts` - shared TypeScript types
- `eas.json` - Expo Application Services build profiles

## Getting started

### Requirements

- Node.js 18+ or newer
- npm
- Android Studio for emulator use
- Android phone with USB debugging enabled if testing on a real device through USB

### Install dependencies

```bash
npm install
```

## Run the app during development

### Option 1: Android emulator

1. Open Android Studio.
2. Start an Android emulator.
3. In the project folder, run:

```bash
npm run android
```

4. The app will build and open in the emulator.

### Option 2: Android phone with Expo Go

1. Install `Expo Go` from the Play Store on your Android phone.
2. Connect your phone and computer to the same Wi-Fi network.
3. In the project folder, run:

```bash
npm start
```

4. Scan the QR code using Expo Go.
5. The app will open on your phone in development mode.

### Option 3: Android phone through USB debugging

1. Enable Developer Options on the phone.
2. Enable `USB debugging`.
3. Connect the phone to your computer with a USB cable.
4. Allow the debugging prompt on the phone.
5. Run:

```bash
npm run android
```

6. The app will install and open on the connected device.

## Build an APK for Android phone

This project can be built as a standalone APK that works without Expo Go.

### Local release APK build

1. Generate the Android project if needed:

```bash
npx expo prebuild --platform android
```

2. Build the release APK:

```bash
cd android
./gradlew assembleRelease
```

3. The APK will be created at:

```bash
android/app/build/outputs/apk/release/app-release.apk
```

### Expo cloud APK build

1. Install EAS CLI:

```bash
npm install -g eas-cli
```

2. Log in to Expo:

```bash
eas login
```

3. Start the Android APK build:

```bash
eas build -p android --profile preview
```

4. Expo will give you a download link when the build is complete.

## Install the APK on an Android phone

1. Transfer `app-release.apk` to your phone using USB, Google Drive, WhatsApp document, Telegram, email, or Nearby Share.
2. On the phone, open the APK file.
3. If Android blocks the install, allow `Install unknown apps` for the app you used to open the APK.
4. Tap `Install`.
5. Open the app after installation.

## How to update the APK on your phone

If you build a new APK version and want the new app code on your phone:

1. Transfer the new APK to the phone.
2. Install it over the old app, or uninstall the old app first and then install the new APK.

Important note about local data:

- This app stores data locally in SQLite.
- If the app already has existing item data on the phone, reinstalling may keep the saved local database.
- If you changed the default seeded catalog and want those new seed items to appear on an already-used phone, you may need to:
  - uninstall the old app first, or
  - clear app data from Android settings

Steps to clear app data:

1. Open `Settings`
2. Open `Apps`
3. Select `Monginis Sales Counter`
4. Open `Storage`
5. Tap `Clear data`
6. Open the app again

## Daily reset behavior

- The app stores the last reset date in local SQLite metadata.
- Whenever the app opens or becomes active, it checks the phone's local date.
- If the date changed after midnight, it saves the previous day as a history report and starts the new day from zero.
- This works even if the app was closed overnight and opened the next morning.

## Reports and history

### Today's report

- Shows only items with quantity greater than zero
- Displays item name, category, and quantity sold
- Shows total quantity sold
- Can be copied as text
- Can be exported as CSV or PDF

### History

- Saves previous daily reports by date
- Lets the user open any saved day and review its sold items

## Backup and restore

The app supports local JSON backup and restore for:

- item list
- saved quantities
- daily reports
- metadata required for reset and history

## iPhone notes

The codebase is cross-platform and can run on iPhone as well, but a standalone iOS install requires Apple signing and an Apple Developer account.

For quick testing on iPhone:

```bash
npm start
```

Then scan the Expo QR code using Expo Go on the iPhone.

## Useful commands

```bash
npm start
npm run android
npm run ios
npm run web
```

## Notes

- This app is intended for internal or personal shop use.
- All sales data is stored locally on the device unless manually exported.
- The repository does not include the generated native `android/` and `ios/` folders by default because they can be recreated with Expo prebuild.
