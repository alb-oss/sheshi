import { View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { RoomFeed } from "@/components/RoomFeed";
import { AuthButton } from "@/components/AuthButton";
import { ThemeToggle } from "@/components/ThemeToggle";

export default function RoomScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return (
    <>
      <Stack.Screen
        options={{
          title: slug ? `#${slug}` : "Dhomë",
          headerRight: () => (
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <ThemeToggle />
              <AuthButton />
            </View>
          ),
        }}
      />
      <RoomFeed slug={slug ?? "sheshi"} />
    </>
  );
}
