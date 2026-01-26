import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Text, Surface} from 'react-native-paper';
import {DTButton, DTColors} from 'react-native-dt-theme';
import type {HomeScreenProps} from '../types/navigation';

export function HomeScreen({navigation}: HomeScreenProps) {
  return (
    <View style={styles.container}>
      <Surface style={styles.header} elevation={0}>
        <Text variant="displaySmall" style={styles.title}>
          DANGEROUS THINGS
        </Text>
        <Text variant="headlineSmall" style={styles.subtitle}>
          NFC IDENTIFIER
        </Text>
      </Surface>

      <View style={styles.content}>
        <Text variant="bodyLarge" style={styles.description}>
          Scan any NFC transponder to find compatible Dangerous Things implants.
        </Text>

        <DTButton
          variant="normal"
          onPress={() => navigation.navigate('Scan')}>
          START SCAN
        </DTButton>
      </View>

      <View style={styles.footer}>
        <Text variant="bodySmall" style={styles.footerText}>
          dngr.us
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DTColors.dark,
    padding: 24,
  },
  header: {
    alignItems: 'center',
    paddingTop: 60,
    paddingBottom: 40,
    backgroundColor: 'transparent',
  },
  title: {
    color: DTColors.modeNormal,
    fontWeight: '700',
    letterSpacing: 2,
  },
  subtitle: {
    color: DTColors.modeEmphasis,
    marginTop: 8,
    letterSpacing: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  description: {
    color: DTColors.light,
    textAlign: 'center',
    marginBottom: 48,
    opacity: 0.9,
    paddingHorizontal: 20,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  footerText: {
    color: DTColors.modeNormal,
    opacity: 0.6,
  },
});
