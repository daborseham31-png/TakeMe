import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { signOut } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import React, { useEffect, useState } from "react";
import {
  Alert,
  Image,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { auth, db } from "../../firebase";

export default function ProfileScreen() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState("English");
  const [gender, setGender] = useState("No Preference");
  const [photo, setPhoto] = useState<string | null>(null);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    const user = auth.currentUser;

    if (!user) {
      router.replace("/");
      return;
    }

    const snap = await getDoc(doc(db, "users", user.uid));

    if (snap.exists()) {
      const data = snap.data();
      setName(data.name || "");
      setEmail(data.email || user.email || "");
      setPhone(data.phone || "");
      setLanguage(data.language || "English");
      setGender(data.gender || "No Preference");
      setPhoto(data.photo || null);
    } else {
      setEmail(user.email || "");
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });

    if (!result.canceled) {
      setPhoto(result.assets[0].uri);
    }
  };

  const saveChanges = async () => {
    const user = auth.currentUser;

    if (!user) return;

    await updateDoc(doc(db, "users", user.uid), {
      name,
      phone,
      language,
      gender,
      photo,
    });

    Alert.alert("Saved", "Profile updated successfully.");
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <View style={styles.avatarWrapper}>
            {photo ? (
              <Image source={{ uri: photo }} style={styles.avatar} />
            ) : (
              <View style={styles.avatarPlaceholder}>
                <Text style={styles.avatarIcon}>👤</Text>
              </View>
            )}

            <Pressable style={styles.cameraButton} onPress={pickImage}>
              <Text style={styles.cameraText}>📷</Text>
            </Pressable>
          </View>

          <Text style={styles.label}>Full Name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.inputDisabled}
            value={email}
            editable={false}
          />

          <Text style={styles.label}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
          />

          <Text style={styles.label}>Preferred Communication Language</Text>
          <Pressable
            style={styles.selectBox}
            onPress={() =>
              Alert.alert("Choose language", "", [
                { text: "English", onPress: () => setLanguage("English") },
                { text: "עברית", onPress: () => setLanguage("עברית") },
                { text: "عربي", onPress: () => setLanguage("عربي") },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <Text>{language}</Text>
            <Text>⌄</Text>
          </Pressable>

          <Text style={styles.label}>Preferred Driver Gender</Text>
          <Pressable
            style={styles.selectBox}
            onPress={() =>
              Alert.alert("Choose driver gender", "", [
                { text: "Male", onPress: () => setGender("Male") },
                { text: "Female", onPress: () => setGender("Female") },
                {
                  text: "No Preference",
                  onPress: () => setGender("No Preference"),
                },
                { text: "Cancel", style: "cancel" },
              ])
            }
          >
            <Text>{gender}</Text>
            <Text>⌄</Text>
          </Pressable>

          <Pressable style={styles.saveButton} onPress={saveChanges}>
            <Text style={styles.saveText}>Save Changes</Text>
          </Pressable>

          <Pressable style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutText}>Log Out</Text>
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
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E7DCD1",
  },
  avatarWrapper: {
    alignItems: "center",
    marginBottom: 24,
  },
  avatar: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  avatarPlaceholder: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "#EFEAE4",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarIcon: {
    fontSize: 44,
  },
  cameraButton: {
    marginTop: -28,
    marginLeft: 80,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#F58220",
    justifyContent: "center",
    alignItems: "center",
  },
  cameraText: {
    color: "white",
  },
  label: {
    fontWeight: "800",
    marginTop: 14,
    marginBottom: 10,
    color: "#111827",
  },
  input: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#FFFDFC",
  },
  inputDisabled: {
    borderWidth: 1,
    borderColor: "#E2D8CF",
    borderRadius: 12,
    padding: 14,
    backgroundColor: "#F7F3EF",
    color: "#8B7B6B",
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
  saveButton: {
    backgroundColor: "#F58220",
    borderRadius: 12,
    padding: 16,
    marginTop: 26,
  },
  saveText: {
    color: "white",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
  logoutButton: {
    borderWidth: 1.5,
    borderColor: "#DC2626",
    borderRadius: 12,
    padding: 16,
    marginTop: 14,
  },
  logoutText: {
    color: "#DC2626",
    textAlign: "center",
    fontWeight: "900",
    fontSize: 16,
  },
});
