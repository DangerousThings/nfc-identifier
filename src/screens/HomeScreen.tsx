import React, { useState, useCallback, useMemo } from 'react';
import { StyleSheet, View, Alert, ScrollView, useWindowDimensions, Linking } from 'react-native';
import { Text, Surface } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import {
  DTButton,
  DTModal,
  DTRadioGroup,
  DTRadioOption,
  DTSettingsPanel,
  DTSwitch,
} from '@dangerousthings/react-native';
import { useColors, type AppColors } from '../hooks/useColors';
import * as Clipboard from 'expo-clipboard';
import { useDataConsent } from '../hooks/useDataConsent';
import { useFixtureCapture } from '../hooks/useFixtureCapture';
import { SWIPE_BACK_OPTIONS, useSwipeBack } from '../hooks/useSwipeBack';
import { useAppearance } from '../hooks/useAppearance';
import { sampleCollector } from '../services/motion';
import { VersionInfo } from '../components/VersionInfo';
import { buildTrackedUrl } from '../utils/utm';
import { SendRawModal } from '../components/SendRawModal';
import type { HomeScreenProps } from '../types/navigation';

export function HomeScreen({ navigation }: HomeScreenProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { consentStatus, setConsent, clearLocalData } = useDataConsent();
  const { enabled: fixtureCaptureEnabled, setEnabled: setFixtureCaptureEnabled } =
    useFixtureCapture();
  const { action: swipeBackAction, setAction: setSwipeBackAction } =
    useSwipeBack();
  const appearance = useAppearance();
  const { height: windowHeight } = useWindowDimensions();
  const [showSettings, setShowSettings] = useState(false);
  const [showSendRaw, setShowSendRaw] = useState(false);
  // Hide START SCAN the moment it's pressed so its pressed-state bevel doesn't
  // flicker during the navigation transition; restore it when we return.
  const [navigatingToScan, setNavigatingToScan] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setNavigatingToScan(false);
    }, []),
  );

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
        { text: 'Cancel', style: 'cancel' },
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
      <Surface style={[styles.header, { paddingTop: insets.top + 20 }]} elevation={0}>
        <Text
          variant="displaySmall"
          style={styles.title}
          numberOfLines={1}
          adjustsFontSizeToFit>
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

        {/* DTButton's inner container is flexGrow:1 (for buttons sharing a row);
            in this column it otherwise fills all vertical space. The style prop
            lands on the outer Pressable, so an explicit height caps it.
            Swapped for a same-size spacer once pressed (see navigatingToScan)
            to avoid a pressed-state flicker mid-transition and any layout jump. */}
        {navigatingToScan ? (
          <View style={styles.scanButton} />
        ) : (
          <DTButton
            variant="normal"
            style={styles.scanButton}
            onPress={() => {
              setNavigatingToScan(true);
              navigation.navigate('Scan');
            }}>
            START SCAN
          </DTButton>
        )}
      </View>

      <View style={styles.settingsSection}>
        <DTButton
          variant="other"
          mode="outlined"
          onPress={() => setShowSettings(true)}>
          SETTINGS
        </DTButton>
      </View>

      <DTModal
        visible={showSettings}
        onDismiss={() => setShowSettings(false)}
        title="SETTINGS"
        variant="other">
        <ScrollView style={{ maxHeight: windowHeight * 0.65 }}>
          <View style={styles.settingsContent}>
            <DTSettingsPanel
              brand={appearance.brand}
              onBrandChange={appearance.setBrand}
              motionScale={appearance.motionScale}
              onMotionScaleChange={appearance.setMotionScale}
              stillImages={appearance.stillImages}
              onStillImagesChange={appearance.setStillImages}
              colorVision={appearance.colorVision}
              onColorVisionChange={appearance.setColorVision}
              style={styles.appearancePanel}
            />

            <DTSwitch
              value={consentStatus === 'opted_in'}
              onValueChange={handleToggleConsent}
              label="Share motion data to improve scanning"
              variant="normal"
            />

            <DTSwitch
              value={fixtureCaptureEnabled}
              onValueChange={setFixtureCaptureEnabled}
              label="Capture detection fixtures (dev/QA)"
              variant="other"
            />

            <View style={styles.settingGroup}>
              <Text variant="labelMedium" style={styles.settingLabel}>
                SWIPE BACK
              </Text>
              <DTRadioGroup
                value={swipeBackAction}
                onValueChange={value =>
                  setSwipeBackAction(value as typeof swipeBackAction)
                }
                variant="normal">
                {SWIPE_BACK_OPTIONS.map(option => (
                  <DTRadioOption
                    key={option.value}
                    value={option.value}
                    label={option.label}
                  />
                ))}
              </DTRadioGroup>
            </View>

            <View style={styles.settingsButtons}>
              <DTButton
                variant="other"
                mode="outlined"
                onPress={() => setShowSendRaw(true)}
                style={styles.settingsButton}>
                SEND RAW
              </DTButton>

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
        </ScrollView>
      </DTModal>

      <SendRawModal
        visible={showSendRaw}
        onDismiss={() => setShowSendRaw(false)}
      />

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <Text
          variant="bodySmall"
          style={styles.footerText}
          onPress={() =>
            Linking.openURL(
              buildTrackedUrl('https://dangerousthings.com', undefined, 'footer'),
            )
          }>
          dangerousthings.com
        </Text>
        <VersionInfo />
      </View>
    </View>
  );
}

const makeStyles = (c: AppColors) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: c.dark,
    padding: 24,
  },
  header: {
    alignItems: 'center',
    paddingBottom: 40,
    backgroundColor: 'transparent',
  },
  title: {
    color: c.modeNormal,
    fontWeight: '700',
    letterSpacing: 2,
  },
  subtitle: {
    color: c.modeEmphasis,
    marginTop: 8,
    letterSpacing: 4,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanButton: {
    height: 64,
    flexGrow: 0,
    alignSelf: 'center',
  },
  description: {
    color: c.light,
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
  appearancePanel: {
    marginBottom: 16,
  },
  settingGroup: {
    gap: 8,
    marginTop: 16,
  },
  settingLabel: {
    color: c.modeNormal,
    letterSpacing: 1,
  },
  settingsButtons: {
    // Stacked, not side by side: the modal is narrower than the screen and
    // "DELETE MY DATA" wraps to two lines in half of it.
    gap: 12,
    marginTop: 16,
  },
  settingsButton: {
    width: '100%',
  },
  footer: {
    alignItems: 'center',
  },
  footerText: {
    color: c.modeNormal,
    opacity: 0.6,
    marginBottom: 4,
  },
});
