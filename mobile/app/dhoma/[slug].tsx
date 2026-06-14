import { Stack, useLocalSearchParams } from "expo-router";
import { RoomFeed } from "@/components/RoomFeed";
import { AuthButton } from "@/components/AuthButton";

export default function RoomScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <>
      <Stack.Screen options={{ title: slug ? `#${slug}` : "Dhomë", headerRight: () => <AuthButton /> }} />
      <RoomFeed slug={slug ?? "sheshi"} />
    </>
  );
}
