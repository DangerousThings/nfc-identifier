import React, { useCallback, useEffect } from 'react';
import { StyleSheet, View, Platform } from 'react-native';
import { Button, Text } from 'react-native-paper';
import type { ScanScreenProps } from '../types/navigation';
import { DTColors } from '../theme';
import { useScan } from '../hooks';
import { getScanInstructions } from '../services/nfc';
import { ScanAnimation } from '../components';

export function ScanScreen({ navigation }: ScanScreenProps) {
  const {
    state,
    tag,
    transponder,
    error,
    nfcStatus,
    scanProgress,
    startScan,
    cancelScan,
    openSettings,
  } = useScan();

  // Track if we've already navigated to prevent double navigation
  const hasNavigated = React.useRef(false);

  // Navigate to results when scan succeeds AND transponder is set
  // We need transponder to be set (even if null for failed detection) before navigating
  useEffect(() => {
    // Only navigate once per scan session
    if (hasNavigated.current) return;

    // Wait for success state, tag data, AND transponder to be set
    // transponder: undefined = not yet set, null = detection failed, Transponder = success
    if (state === 'success' && tag && transponder !== undefined) {
      hasNavigated.current = true;
      console.log('[ScanScreen] Navigating to Result:', {
        hasTag: !!tag,
        hasTransponder: !!transponder,
        transponderType: transponder?.type,
        transponderChipName: transponder?.chipName,
      });
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

  // Reset navigation flag when starting a new scan
  useEffect(() => {
    if (state === 'scanning') {
      hasNavigated.current = false;
    }
  }, [state]);

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

  // Get contextual error hints based on error type
  const getErrorHint = () => {
    if (!error?.type) return null;

    switch (error.type) {
      case 'TAG_LOST':
        return 'Hold the tag steady against the back of your phone until scanning completes.';
      case 'TIMEOUT':
        return 'The tag took too long to respond. Try repositioning it closer to the NFC reader.';
      case 'SCAN_CANCELLED':
        return null; // User cancelled, no hint needed
      case 'NFC_NOT_ENABLED':
        return Platform.OS === 'ios'
          ? 'Go to Settings > NFC to enable NFC scanning.'
          : 'Enable NFC in your device settings.';
      case 'PERMISSION_DENIED':
        return 'NFC permission was denied. Please grant NFC access in your device settings.';
      case 'UNKNOWN':
        return 'An unexpected error occurred. Make sure the tag is positioned correctly and try again.';
      default:
        return 'Make sure the tag is positioned correctly and try again.';
    }
  };

  // Render NFC not supported state
  if (!nfcStatus.isSupported && state !== 'scanning') {
    return (
      <View style={styles.container}>
        <View style={styles.content}>
          <View style={styles.errorIcon}>
            <Text style={styles.errorIconText}>✕</Text>
          </View>
          <Text variant="headlineMedium" style={styles.errorText}>
            NFC NOT SUPPORTED
          </Text>
          <Text variant="bodyLarge" style={styles.errorMessage}>
            This device does not have NFC hardware.
          </Text>
          <Text variant="bodyMedium" style={styles.hintText}>
            NFC scanning requires a device with NFC capability. Most modern smartphones have NFC, but it may need to be enabled in settings.
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
          <View style={styles.warningIcon}>
            <Text style={styles.warningIconText}>⚡</Text>
          </View>
          <Text variant="headlineMedium" style={styles.warningText}>
            NFC DISABLED
          </Text>
          <Text variant="bodyLarge" style={styles.errorMessage}>
            NFC is turned off on this device.
          </Text>
          <Text variant="bodyMedium" style={styles.hintText}>
            {Platform.OS === 'ios'
              ? 'Go to Settings and enable NFC scanning to continue.'
              : 'Enable NFC in your device settings to scan tags.'}
          </Text>
          {Platform.OS === 'android' && (
            <Button
              mode="outlined"
              onPress={openSettings}
              style={styles.settingsButton}
              labelStyle={styles.settingsButtonLabel}>
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
            <ScanAnimation isActive={true} size={180} />
            <Text variant="headlineMedium" style={styles.scanningText}>
              SCANNING
            </Text>
            <Text variant="bodyLarge" style={styles.instructionText}>
              {getScanInstructions()}
            </Text>
            <Text variant="headlineSmall" style={{ paddingTop: 15, paddingBottom: 10 }}>
              Not Scanning?
            </Text>
            <Text variant="bodyLarge" style={styles.instructionText}>
              Phones can only read high frequency (13.56 MHz) -- low and ultra high frequency transponders cannot be scanned.
            </Text>
            {scanProgress && scanProgress.current > 1 && (
              <Text variant="bodySmall" style={styles.progressText}>
                {scanProgress.step}
              </Text>
            )}
          </>
        )}

        {state === 'error' && (
          <>
            <View style={styles.errorIcon}>
              <Text style={styles.errorIconText}>!</Text>
            </View>
            <Text variant="headlineMedium" style={styles.errorText}>
              {error?.type === 'TAG_LOST'
                ? 'TAG LOST'
                : error?.type === 'TIMEOUT'
                  ? 'TIMEOUT'
                  : error?.type === 'PERMISSION_DENIED'
                    ? 'PERMISSION DENIED'
                    : 'SCAN FAILED'}
            </Text>
            <Text variant="bodyLarge" style={styles.errorMessage}>
              {error?.message || 'Unable to read NFC tag'}
            </Text>
            {getErrorHint() && (
              <Text variant="bodyMedium" style={styles.hintText}>
                {getErrorHint()}
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
            <ScanAnimation
              isActive={true}
              size={180}
              color={DTColors.modeEmphasis}
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
  scanningText: {
    color: DTColors.modeNormal,
    letterSpacing: 4,
    marginTop: 32,
    marginBottom: 16,
  },
  instructionText: {
    color: DTColors.light,
    opacity: 0.8,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  progressText: {
    color: DTColors.modeNormal,
    opacity: 0.7,
    marginTop: 16,
    textAlign: 'center',
    fontStyle: 'italic',
  },
  errorIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: DTColors.modeWarning,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  errorIconText: {
    color: DTColors.modeWarning,
    fontSize: 48,
    fontWeight: 'bold',
  },
  errorText: {
    color: DTColors.modeWarning,
    letterSpacing: 2,
    marginBottom: 16,
  },
  warningIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: DTColors.modeEmphasis,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  warningIconText: {
    color: DTColors.modeEmphasis,
    fontSize: 36,
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
  settingsButtonLabel: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
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
  processingText: {
    color: DTColors.modeEmphasis,
    letterSpacing: 4,
    marginTop: 32,
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
