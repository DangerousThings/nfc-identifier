import React from 'react';
import {StatusBar} from 'react-native';
import {NavigationContainer, DefaultTheme} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {DTThemeProvider, DTColors} from '@dangerousthings/react-native';

import {
  DataConsentScreen,
  HomeScreen,
  ScanScreen,
  ResultScreen,
} from './src/screens';
import {DataConsentProvider, useDataConsent} from './src/hooks/useDataConsent';
import {useMotionMonitor} from './src/hooks/useMotionMonitor';
import type {RootStackParamList} from './src/types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();

const NavigationTheme = {
  ...DefaultTheme,
  dark: true,
  colors: {
    ...DefaultTheme.colors,
    primary: DTColors.modeNormal,
    background: DTColors.dark,
    card: DTColors.dark,
    text: DTColors.light,
    border: DTColors.modeNormal,
    notification: DTColors.modeEmphasis,
  },
};

function AppNavigator() {
  const {consentStatus} = useDataConsent();

  // Start/stop motion monitoring based on consent
  useMotionMonitor(consentStatus);

  if (consentStatus === 'loading') {
    return null;
  }

  const initialRoute =
    consentStatus === 'not_asked' ? 'DataConsent' : 'Home';

  return (
    <Stack.Navigator
      initialRouteName={initialRoute}
      screenOptions={{
        headerStyle: {
          backgroundColor: DTColors.dark,
        },
        headerTintColor: DTColors.modeNormal,
        headerTitleStyle: {
          fontWeight: '600',
        },
        contentStyle: {
          backgroundColor: DTColors.dark,
        },
        animation: 'slide_from_right',
      }}>
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

function App() {
  return (
    <DataConsentProvider>
      <DTThemeProvider>
        <StatusBar
          barStyle="light-content"
          translucent
          backgroundColor="transparent"
        />
        <NavigationContainer theme={NavigationTheme}>
          <AppNavigator />
        </NavigationContainer>
      </DTThemeProvider>
    </DataConsentProvider>
  );
}

export default App;
