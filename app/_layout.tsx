import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";

export default function RootLayout() {
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
<<<<<<< Updated upstream
        <Stack.Screen name="signup" />
        <Stack.Screen name="home" />
        <Stack.Screen name="forgot-password" />
        <Stack.Screen name="admin" />
=======
        <Stack.Screen name="home" />
>>>>>>> Stashed changes
      </Stack>
      <StatusBar style="auto" />
    </>
  );
}
