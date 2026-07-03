import { router } from "expo-router";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc } from "firebase/firestore";
import React, { useState } from "react";
import {
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { auth, db } from "../../firebase";

export default function SignUpScreen() {
  const [showPw, setShowPw] = useState(false);
  const [isDriver, setIsDriver] = useState(false);

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    language: "English",
    gender: "No Preference",
  });

  const handleSignUp = async () => {
    if (!form.name || !form.email || !form.password) {
      Alert.alert("Missing details", "Please fill in all required fields.");
      return;
    }

    if (form.password.length < 6) {
      Alert.alert("Weak password", "Password must be at least 6 characters.");
      return;
    }

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        form.email.trim(),
        form.password,
      );

      await setDoc(doc(db, "users", userCredential.user.uid), {
        name: form.name,
        email: form.email.trim().toLowerCase(),
        phone: form.phone,
        language: form.language,
        gender: form.gender,
        isDriver: isDriver,
        role: "user",
      });

      Alert.alert("Success", "Account created successfully!");
      router.replace("/(tabs)/home" as any);
    } catch (error: any) {
      Alert.alert("Sign up failed", error.message);
    }
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.title}>Sign Up</Text>
          <Text style={styles.subtitle}>Create your account</Text>

          <Text style={styles.label}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Full name"
            placeholderTextColor="#8b7b6b"
            value={form.name}
            onChangeText={(text) => setForm({ ...form, name: text })}
          />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="you@example.com"
            placeholderTextColor="#8b7b6b"
            keyboardType="email-address"
            autoCapitalize="none"
            value={form.email}
            onChangeText={(text) => setForm({ ...form, email: text })}
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="Phone number"
            placeholderTextColor="#8b7b6b"
            keyboardType="phone-pad"
            value={form.phone}
            onChangeText={(text) => setForm({ ...form, phone: text })}
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              placeholder="Password"
              placeholderTextColor="#8b7b6b"
              secureTextEntry={!showPw}
              value={form.password}
              onChangeText={(text) => setForm({ ...form, password: text })}
            />
            <Pressable onPress={() => setShowPw(!showPw)}>
              <Text style={styles.eye}>{showPw ? "Hide" : "Show"}</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Preferred Language</Text>
          <Pressable
            style={styles.selectBox}
            onPress={() =>
              Alert.alert("Choose language", "", [
                {
                  text: "English",
                  onPress: () => setForm({ ...form, language: "English" }),
                },
                {
                  text: "עברית",
                  onPress: () => setForm({ ...form, language: "עברית" }),
                },
                {
                  text: "عربي",
                  onPress: () => setForm({ ...form, language: "عربي" }),
                },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <Text style={styles.selectText}>{form.language}</Text>
            <Text style={styles.arrow}>⌄</Text>
          </Pressable>

          <Text style={styles.label}>Preferred Driver Gender</Text>
          <Pressable
            style={styles.selectBox}
            onPress={() =>
              Alert.alert("Choose driver gender", "", [
                {
                  text: "Male",
                  onPress: () => setForm({ ...form, gender: "Male" }),
                },
                {
                  text: "Female",
                  onPress: () => setForm({ ...form, gender: "Female" }),
                },

                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <Text style={styles.selectText}>{form.gender}</Text>
            <Text style={styles.arrow}>⌄</Text>
          </Pressable>

          <Pressable
            style={styles.checkRow}
            onPress={() => setIsDriver(!isDriver)}
          >
            <View style={[styles.circle, isDriver && styles.circleActive]} />
            <Text style={styles.checkText}>Also register as a Driver</Text>
          </Pressable>

          <Pressable style={styles.signUpButton} onPress={handleSignUp}>
            <Text style={styles.signUpText}>Sign Up</Text>
          </Pressable>

          <Pressable onPress={() => router.replace("/")}>
            <Text style={styles.loginText}>
              Already have an account?{" "}
              <Text style={styles.loginLink}>Login</Text>
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: "#FBF7F1",
  },
  scroll: {
    flexGrow: 1,
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
  selectBox: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  selectText: {
    color: "#111827",
  },
  arrow: {
    color: "#8B7B6B",
    fontWeight: "900",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 18,
    marginBottom: 18,
    gap: 10,
  },
  circle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: "#F47C20",
  },
  circleActive: {
    backgroundColor: "#F47C20",
  },
  checkText: {
    fontWeight: "700",
    color: "#111827",
  },
  signUpButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
  },
  signUpText: {
    color: "white",
    textAlign: "center",
    fontSize: 17,
    fontWeight: "900",
  },
  loginText: {
    textAlign: "center",
    marginTop: 20,
    color: "#7C5F46",
  },
  loginLink: {
    color: "#F47C20",
    fontWeight: "900",
  },
});
