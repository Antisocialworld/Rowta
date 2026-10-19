// ENTRY (rules U11g, U2): Poppins 400/500/600 loads BEFORE the first frame; the native splash from app.json
// stays up until the fonts resolve, then hides on the first layout of the real UI — no system-font flash
// (U11g). A font failure falls back to the system font and still hides the splash: never a white screen.
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { Poppins_400Regular, Poppins_500Medium, Poppins_600SemiBold, useFonts } from '@expo-google-fonts/poppins';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Root } from './src/Root';

void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Poppins_400Regular,
    Poppins_500Medium,
    Poppins_600SemiBold,
  });
  const ready = fontsLoaded || fontError !== null;

  const onLayoutRootView = useCallback(() => {
    if (ready) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [ready]);

  if (!ready) return null;

  return (
    <View style={styles.fill} onLayout={onLayoutRootView}>
      <SafeAreaProvider>
        <Root />
      </SafeAreaProvider>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
