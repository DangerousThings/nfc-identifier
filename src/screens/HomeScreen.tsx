import React from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Text, Surface} from 'react-native-paper';
import type {HomeScreenProps} from '../types/navigation';
import {DTColors} from '../theme';

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

        <Button
          mode="outlined"
          onPress={() => navigation.navigate('Scan')}
          style={styles.scanButton}
          labelStyle={styles.scanButtonLabel}
          contentStyle={styles.scanButtonContent}>
          START SCAN
        </Button>
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
  scanButton: {
    borderColor: DTColors.modeNormal,
    borderWidth: 2,
    borderRadius: 4,
  },
  scanButtonLabel: {
    color: DTColors.modeNormal,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
  },
  scanButtonContent: {
    paddingVertical: 12,
    paddingHorizontal: 32,
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
