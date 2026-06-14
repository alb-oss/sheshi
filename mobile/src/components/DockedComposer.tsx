import { View } from "react-native";
import { Composer } from "@/components/Composer";
import { useDockOffset } from "@/useDockOffset";
import type { ComponentProps } from "react";

// The one composer used across the app (Sheshi feed, every #dhomë room, and threads). Wraps the
// shared Composer and floats it above the always-present glass dock (and onto the keyboard while typing)
// so every screen behaves identically.
export function DockedComposer(props: ComponentProps<typeof Composer>) {
  const offset = useDockOffset();
  return (
    <View style={{ paddingBottom: offset }}>
      <Composer {...props} />
    </View>
  );
}
