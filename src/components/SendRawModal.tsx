/**
 * Send Raw Modal
 *
 * Dev/QA tool: type a hex command, send it to the tag as a raw ISO 14443-3A
 * frame, see the response back as byte-spaced hex. On Android it fires against
 * whatever tag the app-wide reader session already has in the field, so you
 * rest the tag on the phone and tap SEND when you want — it does not wait for a
 * fresh tap. iOS uses its modal per-send session.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { DTButton, DTModal, DTTextInput } from '@dangerousthings/react-native';
import { useColors, type AppColors } from '../hooks/useColors';
import { nfcManager } from '../services/nfc';

/** Separators are cosmetic: "30 04", "30:04" and "3004" are the same command. */
export function parseHex(input: string): number[] | null {
  const hex = input.replace(/[\s:-]/g, '');
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }
  return hex.match(/.{2}/g)!.map(byte => parseInt(byte, 16));
}

export function toSpacedHex(bytes: number[]): string {
  return bytes
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(' ');
}

interface SendRawModalProps {
  visible: boolean;
  onDismiss: () => void;
}

export function SendRawModal({ visible, onDismiss }: SendRawModalProps) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const command = parseHex(input);
  const invalid = input.trim().length > 0 && command === null;

  // Hold a presence-off reader session only while the dialog is open, so
  // SEND fires against the tag already in the field with no OS read ahead of
  // it — and, crucially, without disturbing the normal scan's tag discovery
  // (which needs the presence check the rest of the time). Closing the dialog
  // ends the session and clears any stuck SENDING state.
  useEffect(() => {
    if (!visible) {
      return;
    }
    nfcManager.beginPresentTagSession();
    return () => {
      nfcManager.endPresentTagSession();
      setSending(false);
    };
  }, [visible]);

  const handleSend = useCallback(async () => {
    if (!command) {
      return;
    }
    setSending(true);
    setResponse(null);
    setError(null);
    try {
      setResponse(toSpacedHex(await nfcManager.sendRawNfcA(command)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  }, [command]);

  const handleDismiss = useCallback(() => {
    setResponse(null);
    setError(null);
    onDismiss();
  }, [onDismiss]);

  return (
    <DTModal
      visible={visible}
      onDismiss={handleDismiss}
      title="SEND RAW"
      variant="other">
      <View style={styles.content}>
        <DTTextInput
          variant="other"
          label="COMMAND (HEX)"
          value={input}
          onChangeText={setInput}
          autoCapitalize="characters"
          autoCorrect={false}
          error={invalid}
          errorMessage={invalid ? 'Whole hex bytes only, e.g. 30 00' : undefined}
        />

        <DTButton
          variant="other"
          onPress={handleSend}
          disabled={!command || sending}>
          {sending ? 'SENDING...' : 'SEND'}
        </DTButton>

        {response !== null && (
          <View>
            <Text variant="labelMedium" style={styles.label}>
              RESPONSE
            </Text>
            <Text
              variant="bodyMedium"
              selectable
              style={styles.response}>
              {response.length > 0 ? response : '(empty)'}
            </Text>
          </View>
        )}

        {error !== null && (
          <View>
            <Text variant="labelMedium" style={styles.errorLabel}>
              FAILED
            </Text>
            <Text variant="bodyMedium" style={styles.error}>
              {error}
            </Text>
          </View>
        )}
      </View>
    </DTModal>
  );
}

const makeStyles = (c: AppColors) =>
  StyleSheet.create({
    content: {
      gap: 16,
      paddingVertical: 12,
    },
    label: {
      color: c.modeOther,
      letterSpacing: 1,
      marginBottom: 4,
    },
    response: {
      color: c.light,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    errorLabel: {
      color: c.modeWarning,
      letterSpacing: 1,
      marginBottom: 4,
    },
    error: {
      color: c.modeWarning,
    },
  });
