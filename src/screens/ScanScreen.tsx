import React, {useCallback, useEffect} from 'react';
import {StyleSheet, View, Platform} from 'react-native';
import {Button, Text, ActivityIndicator} from 'react-native-paper';
import type {ScanScreenProps} from '../types/navigation';
import {DTColors} from '../theme';
import {useScan} from '../hooks';
import {getScanInstructions} from '../services/nfc';

export function ScanScreen({navigation}: ScanScreenProps) {
  const {
    state,
    tag,
    transponder,
    error,
    nfcStatus,
    startScan,
    cancelScan,
    openSettings,
  } = useScan();

  // Navigate to results when scan succeeds (detection happens in the hook)
  useEffect(() => {
    if (state === 'success' && tag) {
      navigation.replace('Result', {
        tagData: {
          uid: tag.uid,
          techTypes: tag.techTypes,
          sak: tag.sak,
          atqa: tag.atqa,
          ats: tag.ats,
          historicalBytes: tag.historicalBytes,
        },
        transponder: transponder ?? undefined,
      });
    }
  }, [state, tag, transponder, navigation]);

  // Auto-start scan when screen loads
  useEffect(() => {
    // Small delay to ensure screen is mounted
    const timeout = setTimeout(() => {
      startScan();
    }, 300);

    return () => clearTimeout(timeout);
    // Only run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = useCallback(async () => {
    await cancelScan();
    navigation.goBack();
  }, [cancelScan, navigation]);

  const handleRetry = useCallback(() => {
    startScan();
  }, [startScan]);

  // Render NFC not supported state
  if (!nfcStatus.isSupported && state !== 'scanning') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text variant="headlineMedium" style={styles.errorText}>
            NFC NOT SUPPORTED
          </Text>
          <Text variant="bodyLarge" style={styles.errorMessage}>
            This device does not support NFC scanning.
          </Text>
        </View>
        <View style={styles.footer}>
          <Button
            mode="text"
            onPress={() => navigation.goBack()}
            labelStyle={styles.cancelLabel}>
            GO BACK
          </Button>
        </View>
      </View>
    );
  }

  // Render NFC disabled state
  if (!nfcStatus.isEnabled && error?.type === 'NFC_NOT_ENABLED') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <Text variant="headlineMedium" style={styles.warningText}>
            NFC DISABLED
          </Text>
          <Text variant="bodyLarge" style={styles.errorMessage}>
            Please enable NFC in your device settings to scan tags.
          </Text>
          {Platform.OS === 'android' && (
            <Button
              mode="outlined"
              onPress={openSettings}
              style={styles.settingsButton}
              labelStyle={styles.buttonLabel}>
              OPEN SETTINGS
            </Button>
          )}
        </View>
        <View style={styles.footer}>
          <Button
            mode="text"
            onPress={handleRetry}
            labelStyle={styles.retryLabel}>
            TRY AGAIN
          </Button>
          <Button
            mode="text"
            onPress={() => navigation.goBack()}
            labelStyle={styles.cancelLabel}>
            CANCEL
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        {state === 'scanning' && (
          <>
            <View style={styles.scanIndicator}>
              <ActivityIndicator
                size="large"
                color={DTColors.modeNormal}
                style={styles.spinner}
              />
              <View style={styles.pulseRing} />
            </View>
            <Text variant="headlineMedium" style={styles.scanningText}>
              SCANNING
            </Text>
            <Text variant="bodyLarge" style={styles.instructionText}>
              {getScanInstructions()}
            </Text>
          </>
        )}

        {state === 'error' && (
          <>
            <Text variant="headlineMedium" style={styles.errorText}>
              SCAN FAILED
            </Text>
            <Text variant="bodyLarge" style={styles.errorMessage}>
              {error?.message || 'Unable to read NFC tag'}
            </Text>
            {error?.type === 'TAG_LOST' && (
              <Text variant="bodyMedium" style={styles.hintText}>
                Hold the tag steady until the scan completes
              </Text>
            )}
            <Button
              mode="outlined"
              onPress={handleRetry}
              style={styles.retryButton}
              labelStyle={styles.buttonLabel}>
              TRY AGAIN
            </Button>
          </>
        )}

        {state === 'idle' && (
          <>
            <Text variant="headlineMedium" style={styles.readyText}>
              READY TO SCAN
            </Text>
            <Button
              mode="outlined"
              onPress={startScan}
              style={styles.startButton}
              labelStyle={styles.buttonLabel}>
              START
            </Button>
          </>
        )}

        {state === 'processing' && (
          <>
            <ActivityIndicator
              size="large"
              color={DTColors.modeEmphasis}
              style={styles.processingSpinner}
            />
            <Text variant="headlineMedium" style={styles.processingText}>
              IDENTIFYING
            </Text>
            <Text variant="bodyMedium" style={styles.detectingHint}>
              Analyzing chip type...
            </Text>
          </>
        )}
      </View>

      <View style={styles.footer}>
        <Button
          mode="text"
          onPress={handleCancel}
          labelStyle={styles.cancelLabel}>
          CANCEL
        </Button>
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
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanIndicator: {
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 40,
  },
  spinner: {
    position: 'absolute',
  },
  pulseRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 2,
    borderColor: DTColors.modeNormal,
    opacity: 0.3,
  },
  scanningText: {
    color: DTColors.modeNormal,
    letterSpacing: 4,
    marginBottom: 16,
  },
  instructionText: {
    color: DTColors.light,
    opacity: 0.8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  errorText: {
    color: DTColors.modeWarning,
    letterSpacing: 2,
    marginBottom: 16,
  },
  warningText: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
    marginBottom: 16,
  },
  errorMessage: {
    color: DTColors.light,
    opacity: 0.8,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
  },
  hintText: {
    color: DTColors.modeNormal,
    opacity: 0.7,
    textAlign: 'center',
    marginBottom: 24,
    paddingHorizontal: 20,
    fontStyle: 'italic',
  },
  retryButton: {
    borderColor: DTColors.modeNormal,
    borderWidth: 2,
  },
  settingsButton: {
    borderColor: DTColors.modeEmphasis,
    borderWidth: 2,
    marginTop: 16,
  },
  readyText: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
    marginBottom: 32,
  },
  startButton: {
    borderColor: DTColors.modeNormal,
    borderWidth: 2,
  },
  buttonLabel: {
    color: DTColors.modeNormal,
    letterSpacing: 2,
  },
  processingSpinner: {
    marginBottom: 24,
  },
  processingText: {
    color: DTColors.modeEmphasis,
    letterSpacing: 4,
  },
  detectingHint: {
    color: DTColors.light,
    opacity: 0.7,
    marginTop: 12,
  },
  footer: {
    alignItems: 'center',
    paddingBottom: 20,
  },
  cancelLabel: {
    color: DTColors.light,
    opacity: 0.6,
  },
  retryLabel: {
    color: DTColors.modeNormal,
    marginBottom: 8,
  },
});
