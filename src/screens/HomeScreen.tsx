import React, {useState, useCallback} from 'react';
import {StyleSheet, View, Alert} from 'react-native';
import {Text, Surface} from 'react-native-paper';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {DTButton, DTColors, DTSwitch} from '@dangerousthings/react-native';
import * as Clipboard from 'expo-clipboard';
import {useDataConsent} from '../hooks/useDataConsent';
import {sampleCollector} from '../services/motion';
import type {HomeScreenProps} from '../types/navigation';

export function HomeScreen({navigation}: HomeScreenProps) {
  const insets = useSafeAreaInsets();
  const {consentStatus, setConsent, clearLocalData} = useDataConsent();
  const [showSettings, setShowSettings] = useState(false);

  const handleToggleConsent = useCallback(
    async (value: boolean) => {
      await setConsent(value ? 'opted_in' : 'opted_out');
    },
    [setConsent],
  );

  const handleDeleteData = useCallback(() => {
    Alert.alert(
      'Delete Motion Data',
      'This will delete all locally stored motion samples and clear the upload queue. This cannot be undone.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await clearLocalData();
            await sampleCollector.clearSamples();
            Alert.alert('Deleted', 'All local motion data has been cleared.');
          },
        },
      ],
    );
  }, [clearLocalData]);

  const handleExport = useCallback(async () => {
    try {
      const samples = await sampleCollector.exportSamples();
      console.log(`[Motion] Export: ${samples.length} samples found`);
      if (samples.length === 0) {
        Alert.alert('No Data', 'No motion samples to export.');
        return;
      }

      const json = JSON.stringify(samples);
      await Clipboard.setStringAsync(json);
      console.log(`[Motion] Copied ${samples.length} samples to clipboard`);
      Alert.alert('Copied', `${samples.length} samples copied to clipboard.`);
    } catch (err) {
      console.log('[Motion] Export error:', err);
      Alert.alert('Error', 'Failed to export motion data.');
    }
  }, []);

  return (
    <View style={styles.container}>
      <Surface style={[styles.header, {paddingTop: insets.top + 20}]} elevation={0}>
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

      <View style={styles.settingsSection}>
        <DTButton
          variant="other"
          mode="outlined"
          onPress={() => setShowSettings(s => !s)}
          style={styles.settingsToggle}>
          {showSettings ? 'HIDE SETTINGS' : 'SETTINGS'}
        </DTButton>

        {showSettings && (
          <View style={styles.settingsContent}>
            <DTSwitch
              value={consentStatus === 'opted_in'}
              onValueChange={handleToggleConsent}
              label="Share motion data to improve scanning"
              variant="normal"
            />

            <View style={styles.settingsButtons}>
              <DTButton
                variant="other"
                mode="outlined"
                onPress={handleExport}
                style={styles.settingsButton}>
                EXPORT DATA
              </DTButton>

              <DTButton
                variant="warning"
                mode="outlined"
                onPress={handleDeleteData}
                style={styles.settingsButton}>
                DELETE MY DATA
              </DTButton>
            </View>
          </View>
        )}
      </View>

      <View style={[styles.footer, {paddingBottom: Math.max(insets.bottom, 20)}]}>
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
  settingsSection: {
    marginBottom: 16,
  },
  settingsToggle: {
    marginBottom: 12,
  },
  settingsContent: {
    paddingVertical: 12,
  },
  settingsButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
  },
  settingsButton: {
    flex: 1,
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    color: DTColors.modeNormal,
    opacity: 0.6,
  },
});
