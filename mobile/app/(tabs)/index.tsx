import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RoomFeed } from "@/components/RoomFeed";

export default function SheshiTab() {
  const insets = useSafeAreaInsets();
  return <RoomFeed slug="sheshi" dockOffset={49 + insets.bottom} />;
}
