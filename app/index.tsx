import { router } from "expo-router";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../firebase";

export default function AppStartScreen() {
  const [loading, setLoading] = useState(true);
  const [showPw, setShowPw] = useState(false);
  const [role, setRole] = useState<"user" | "admin">("user");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 2500);
    return () => clearTimeout(timer);
  }, []);

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Missing details", "Please enter email and password.");
      return;
    }

    try {
      await signInWithEmailAndPassword(auth, email, password);

      const userDoc = await getDoc(doc(db, "users", "admin"));

      let roleFromDatabase = "user";

      if (userDoc.exists()) {
        const adminEmail = userDoc.data().email;
        const adminRole = userDoc.data().role;

        if (
          email.trim().toLowerCase() === adminEmail.trim().toLowerCase() &&
          adminRole === "admin"
        ) {
          roleFromDatabase = "admin";
        }
      }

      if (role === "admin" && roleFromDatabase !== "admin") {
        Alert.alert("Access denied", "This account is not an admin.");
        return;
      }

      if (role === "admin") {
        router.replace("/login/admin");
      } else {
        router.replace("/(tabs)/home" as any);
      }
    } catch (error: any) {
      Alert.alert("Login failed", "Invalid email or password.");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.splash}>
        <Text style={styles.logo}>TakeMe</Text>
        <Text style={styles.tagline}>Connecting people, simplifying life</Text>
        <ActivityIndicator size="large" color="#ffffff" style={styles.loader} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.card}>
        <Text style={styles.title}>Login</Text>
        <Text style={styles.subtitle}>Welcome back!</Text>

        <Text style={styles.label}>Login as</Text>

        <View style={styles.roleRow}>
          <Pressable
            onPress={() => setRole("user")}
            style={[styles.roleBox, role === "user" && styles.activeRole]}
          >
            <Text
              style={[styles.roleIcon, role === "user" && styles.activeText]}
            >
              ♙
            </Text>
            <Text
              style={[styles.roleText, role === "user" && styles.activeText]}
            >
              User
            </Text>
          </Pressable>

          <Pressable
            onPress={() => setRole("admin")}
            style={[styles.roleBox, role === "admin" && styles.activeRole]}
          >
            <Text
              style={[styles.roleIcon, role === "admin" && styles.activeText]}
            >
              ♜
            </Text>
            <Text
              style={[styles.roleText, role === "admin" && styles.activeText]}
            >
              Admin
            </Text>
          </Pressable>
        </View>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#8b7b6b"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
        />

        <Text style={styles.label}>Password</Text>
        <View style={styles.passwordRow}>
          <TextInput
            style={styles.passwordInput}
            placeholder="Password"
            placeholderTextColor="#8b7b6b"
            secureTextEntry={!showPw}
            value={password}
            onChangeText={setPassword}
          />
          <Pressable onPress={() => setShowPw(!showPw)}>
            <Text style={styles.eye}>{showPw ? "Hide" : "Show"}</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.push("/login/forgot-password" as any)}>
          <Text style={styles.forgot}>Forgot Password?</Text>
        </Pressable>

        <Pressable style={styles.loginButton} onPress={handleLogin}>
          <Text style={styles.loginText}>Login</Text>
        </Pressable>

        <Pressable onPress={() => router.push("/login/signup" as any)}>
          <Text style={styles.signupText}>
            Don't have an account?{" "}
            <Text style={styles.signupLink}>Sign Up</Text>
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: "#F28C28",
    justifyContent: "center",
    alignItems: "center",
  },
  logo: {
    fontSize: 48,
    fontWeight: "900",
    color: "#ffffff",
  },
  tagline: {
    color: "#fff7ed",
    marginTop: 10,
    fontSize: 16,
  },
  loader: {
    marginTop: 30,
  },
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  title: {
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
    color: "#111827",
    marginBottom: 8,
  },
  subtitle: {
    textAlign: "center",
    color: "#7C5F46",
    marginBottom: 28,
    fontSize: 15,
  },
  label: {
    fontWeight: "800",
    color: "#111827",
    marginBottom: 10,
    marginTop: 14,
  },
  roleRow: {
    flexDirection: "row",
    gap: 14,
  },
  roleBox: {
    flex: 1,
    height: 98,
    borderWidth: 1.5,
    borderColor: "#E2D8CF",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
  },
  activeRole: {
    borderColor: "#F47C20",
    backgroundColor: "#FFF8F2",
  },
  roleIcon: {
    fontSize: 25,
    color: "#8B7B6B",
    marginBottom: 6,
  },
  roleText: {
    fontWeight: "900",
    color: "#111827",
  },
  activeText: {
    color: "#F47C20",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    color: "#111827",
  },
  passwordRow: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    paddingHorizontal: 14,
    backgroundColor: "#FFFDFC",
  },
  passwordInput: {
    flex: 1,
    paddingVertical: 14,
    color: "#111827",
  },
  eye: {
    color: "#8B7B6B",
    fontWeight: "700",
  },
  forgot: {
    textAlign: "right",
    color: "#F47C20",
    marginTop: 14,
    fontWeight: "700",
  },
  loginButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 22,
  },
  loginText: {
    color: "white",
    textAlign: "center",
    fontSize: 17,
    fontWeight: "900",
  },
  signupText: {
    textAlign: "center",
    marginTop: 20,
    color: "#7C5F46",
  },
  signupLink: {
    color: "#F47C20",
    fontWeight: "900",
  },
});
