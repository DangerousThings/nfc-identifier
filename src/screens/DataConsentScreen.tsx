import React from 'react';
import {StyleSheet, View, ScrollView} from 'react-native';
import {Text} from 'react-native-paper';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DTButton, DTCard, DTColors} from '@dangerousthings/react-native';
import {useDataConsent} from '../hooks/useDataConsent';
import type {DataConsentScreenProps} from '../types/navigation';

export function DataConsentScreen({navigation}: DataConsentScreenProps) {
  const insets = useSafeAreaInsets();
  const {setConsent} = useDataConsent();

  const handleOptIn = async () => {
    await setConsent('opted_in');
    navigation.replace('Home');
  };

  const handleOptOut = async () => {
    await setConsent('opted_out');
    navigation.replace('Home');
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.contentContainer,
        {paddingTop: insets.top + 40, paddingBottom: Math.max(insets.bottom, 24)},
      ]}>
      <Text variant="headlineMedium" style={styles.title}>
        HELP IMPROVE SCANNING
      </Text>

      <Text variant="bodyLarge" style={styles.intro}>
        We're training a model to detect when you're about to scan — so future
        versions can start scanning automatically.
      </Text>

      <DTCard mode="normal" style={styles.card}>
        <Text variant="titleSmall" style={styles.cardTitle}>
          WHAT WE COLLECT
        </Text>
        <Text variant="bodyMedium" style={styles.cardText}>
          Motion sensor data (accelerometer and gyroscope) while you use the
          app. Data is uploaded to our server for analysis.
        </Text>
      </DTCard>

      <DTCard mode="normal" style={styles.card}>
        <Text variant="titleSmall" style={styles.cardTitle}>
          WHAT WE DON'T COLLECT
        </Text>
        <Text variant="bodyMedium" style={styles.cardText}>
          No personal information, no NFC tag contents, no location data, no
          device identifiers.
        </Text>
      </DTCard>

      <DTCard mode="normal" style={styles.card}>
        <Text variant="titleSmall" style={styles.cardTitle}>
          YOUR CHOICE
        </Text>
        <Text variant="bodyMedium" style={styles.cardText}>
          You can change this at any time from the home screen. You can also
          delete all collected data at any point.
        </Text>
      </DTCard>

      <View style={styles.buttons}>
        <DTButton variant="normal" onPress={handleOptIn}>
          HELP IMPROVE THE APP
        </DTButton>

        <View style={styles.spacer} />

        <DTButton variant="other" mode="outlined" onPress={handleOptOut}>
          NO THANKS
        </DTButton>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DTColors.dark,
  },
  contentContainer: {
    padding: 24,
  },
  title: {
    color: DTColors.modeNormal,
    fontWeight: '700',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 16,
  },
  intro: {
    color: DTColors.light,
    textAlign: 'center',
    marginBottom: 24,
    opacity: 0.9,
  },
  card: {
    marginBottom: 16,
  },
  cardTitle: {
    color: DTColors.modeEmphasis,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 8,
  },
  cardText: {
    color: DTColors.light,
    opacity: 0.85,
    lineHeight: 22,
  },
  buttons: {
    marginTop: 24,
  },
  spacer: {
    height: 12,
  },
});
