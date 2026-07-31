/**
 * VersionInfo
 *
 * Compact runtime diagnostic shown in the home-screen footer:
 *
 *   v1.2.0 · beta · fb7eaa0f
 *   └─ binary  └─ channel  └─ OTA update ID prefix (or "embedded")
 *
 * - Binary version is hardcoded here. Mirror app.config.ts when a new
 *   native build ships.
 * - Channel and update ID come from expo-updates, which is already a
 *   dependency and exposes them as sync constants — no new native
 *   module, OTA-safe.
 * - When the app is running the bundle baked into the APK (no OTA
 *   applied yet), `Updates.updateId` is null and we render "embedded"
 *   so testers can tell the difference at a glance.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import * as Updates from 'expo-updates';
import { DTColors } from '@dangerousthings/react-native';

/**
 * Binary version. Mirror this with `version` in app.config.ts on each
 * native build. JS-only OTA pushes do not bump this string — that's
 * intentional, since the binary on the device is what `version` describes.
 */
const APP_VERSION = '1.3.0';

export function VersionInfo() {
  const channel = Updates.channel ?? 'unknown';
  const updateId = Updates.updateId;
  const updateLabel = updateId ? updateId.slice(0, 8) : 'embedded';

  return (
    <View style={styles.row}>
      <Text variant="bodySmall" style={styles.text}>
        v{APP_VERSION} · {channel} · {updateLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
  },
  text: {
    color: DTColors.modeNormal,
    opacity: 0.5,
    fontSize: 11,
  },
});
