import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardVisible } from "@/useKeyboardVisible";

// The bottom tab dock is always present (49pt + safe-area). A docked composer must float just above
// it, and collapse to 0 while the keyboard is up (the dock hides itself via tabBarHideOnKeyboard).
const DOCK_HEIGHT = 49;

export function useDockOffset(): number {
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  return keyboardUp ? 0 : DOCK_HEIGHT + insets.bottom;
}
