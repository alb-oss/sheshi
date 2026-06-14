import { useEffect } from "react";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { RoomFeed } from "@/components/RoomFeed";

// Lives inside the tabs navigator so the dock stays visible; header (back + title) comes from the
// tabs layout. The room stream itself is the exact same RoomFeed as the Sheshi tab.
export default function RoomScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const navigation = useNavigation();

  useEffect(() => {
    if (slug) navigation.setOptions({ title: `#${slug}` });
  }, [navigation, slug]);

  return <RoomFeed slug={slug ?? "sheshi"} />;
}
