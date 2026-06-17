// jest-expo handles the Expo/React Native module graph. AsyncStorage ships an official in-memory
// jest mock; register it here so api.ts's token persistence runs against a real (fake) store
// instead of throwing on the native bridge.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
