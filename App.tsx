import React, {useMemo} from 'react';
import {StatusBar} from 'react-native';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import type {NativeStackNavigationOptions} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {DTThemeProvider, useDTTheme} from '@dangerousthings/react-native';

import {
  DataConsentScreen,
  HomeScreen,
  ScanScreen,
  ResultScreen,
} from './src/screens';
import {DataConsentProvider, useDataConsent} from './src/hooks/useDataConsent';
import {FixtureCaptureProvider} from './src/hooks/useFixtureCapture';
import {SwipeBackProvider} from './src/hooks/useSwipeBack';
import {AppearanceProvider, useAppearance} from './src/hooks/useAppearance';
import {useMotionMonitor} from './src/hooks/useMotionMonitor';
import {useReleaseNotesPrompt} from './src/hooks/useReleaseNotesPrompt';
import type {RootStackParamList} from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const {consentStatus} = useDataConsent();
  const theme = useDTTheme();

  // Start/stop motion monitoring based on consent
  useMotionMonitor(consentStatus);

  // Show the release-notes dialog once after each new release lands.
  useReleaseNotesPrompt();

  // Header and content chrome follow the active brand / colour vision palette.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      headerStyle: {
        backgroundColor: theme.colors.background,
      },
      headerTintColor: theme.custom.modeNormal,
      headerTitleStyle: {
        fontWeight: '600',
      },
      contentStyle: {
        backgroundColor: theme.colors.background,
      },
      animation: 'slide_from_right',
    }),
    [theme],
  );

  if (consentStatus === 'loading') {
    return null;
  }

  const initialRoute =
    consentStatus === 'not_asked' ? 'DataConsent' : 'Home';

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={screenOptions}>
      <Stack.Screen
        name="DataConsent"
        component={DataConsentScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="Home"
        component={HomeScreen}
        options={{headerShown: false}}
      />
      <Stack.Screen
        name="Scan"
        component={ScanScreen}
        options={{
          title: 'SCAN',
          headerBackTitle: 'Back',
        }}
      />
      <Stack.Screen
        name="Result"
        component={ResultScreen}
        options={{
          title: 'RESULT',
          headerBackTitle: 'Scan',
        }}
      />
    </Stack.Navigator>
  );
}

/** NavigationContainer whose theme is derived from the DT theme in context. */
function ThemedNavigationContainer({children}: {children: React.ReactNode}) {
  const theme = useDTTheme();

  const navigationTheme = useMemo(
    () => ({
      ...DefaultTheme,
      dark: true,
      colors: {
        ...DefaultTheme.colors,
        primary: theme.colors.primary,
        background: theme.colors.background,
        card: theme.colors.background,
        text: theme.colors.onBackground,
        border: theme.custom.border,
        notification: theme.custom.modeEmphasis,
      },
    }),
    [theme],
  );

  return (
    <NavigationContainer theme={navigationTheme}>{children}</NavigationContainer>
  );
}

/** Builds the DT theme from the persisted appearance settings. */
function ThemedApp() {
  const {brand, colorVision, motionScale, stillImages} = useAppearance();

  return (
    <DTThemeProvider
      brand={brand}
      colorVision={colorVision}
      motionScale={motionScale}
      stillImages={stillImages}>
      <StatusBar
        barStyle="light-content"
        translucent
        backgroundColor="transparent"
      />
      <ThemedNavigationContainer>
        <AppNavigator />
      </ThemedNavigationContainer>
    </DTThemeProvider>
  );
}

function App() {
  return (
    <SafeAreaProvider>
      <DataConsentProvider>
        <FixtureCaptureProvider>
          <SwipeBackProvider>
            <AppearanceProvider>
              <ThemedApp />
            </AppearanceProvider>
          </SwipeBackProvider>
        </FixtureCaptureProvider>
      </DataConsentProvider>
    </SafeAreaProvider>
  );
}

export default App;
