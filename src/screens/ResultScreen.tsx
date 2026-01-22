import React from 'react';
import {StyleSheet, View, ScrollView, Linking} from 'react-native';
import {Button, Text, Surface, Divider} from 'react-native-paper';
import type {ResultScreenProps} from '../types/navigation';
import {DTColors} from '../theme';

export function ResultScreen({route, navigation}: ResultScreenProps) {
  const {tagData} = route.params;

  const handleConversionLink = () => {
    Linking.openURL('https://dngr.us/conversion');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Surface style={styles.resultCard} elevation={1}>
          <Text variant="labelLarge" style={styles.cardLabel}>
            TAG DETECTED
          </Text>
          <Divider style={styles.divider} />

          {tagData ? (
            <>
              <View style={styles.dataRow}>
                <Text variant="bodyMedium" style={styles.dataLabel}>
                  UID
                </Text>
                <Text variant="bodyLarge" style={styles.dataValue}>
                  {tagData.uid || 'N/A'}
                </Text>
              </View>

              <View style={styles.dataRow}>
                <Text variant="bodyMedium" style={styles.dataLabel}>
                  TECHNOLOGIES
                </Text>
                <Text variant="bodyLarge" style={styles.dataValue}>
                  {tagData.techTypes.join(', ') || 'N/A'}
                </Text>
              </View>

              {tagData.sak !== undefined && (
                <View style={styles.dataRow}>
                  <Text variant="bodyMedium" style={styles.dataLabel}>
                    SAK
                  </Text>
                  <Text variant="bodyLarge" style={styles.dataValue}>
                    0x{tagData.sak.toString(16).toUpperCase().padStart(2, '0')}
                  </Text>
                </View>
              )}

              {tagData.atqa && (
                <View style={styles.dataRow}>
                  <Text variant="bodyMedium" style={styles.dataLabel}>
                    ATQA
                  </Text>
                  <Text variant="bodyLarge" style={styles.dataValue}>
                    {tagData.atqa}
                  </Text>
                </View>
              )}

              {tagData.historicalBytes && (
                <View style={styles.dataRow}>
                  <Text variant="bodyMedium" style={styles.dataLabel}>
                    HISTORICAL BYTES
                  </Text>
                  <Text variant="bodyLarge" style={styles.dataValue}>
                    {tagData.historicalBytes}
                  </Text>
                </View>
              )}
            </>
          ) : (
            <Text variant="bodyLarge" style={styles.noData}>
              No tag data available
            </Text>
          )}
        </Surface>

        <Surface style={styles.matchCard} elevation={1}>
          <Text variant="labelLarge" style={styles.matchLabel}>
            COMPATIBLE IMPLANTS
          </Text>
          <Divider style={styles.divider} />

          <Text variant="bodyLarge" style={styles.placeholderText}>
            Detection coming in Phase 3-5
          </Text>

          <Text variant="bodyMedium" style={styles.hintText}>
            Full chip identification and product matching will be implemented in
            later phases.
          </Text>
        </Surface>

        <Surface style={styles.conversionCard} elevation={1}>
          <Text variant="bodyMedium" style={styles.conversionText}>
            Can't find a match? Check out our conversion service.
          </Text>
          <Button
            mode="outlined"
            onPress={handleConversionLink}
            style={styles.conversionButton}
            labelStyle={styles.conversionButtonLabel}>
            CONVERSION SERVICE
          </Button>
        </Surface>

        <View style={styles.actions}>
          <Button
            mode="outlined"
            onPress={() => navigation.navigate('Scan')}
            style={styles.actionButton}
            labelStyle={styles.actionButtonLabel}>
            SCAN ANOTHER
          </Button>

          <Button
            mode="text"
            onPress={() => navigation.navigate('Home')}
            labelStyle={styles.homeLabel}>
            HOME
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DTColors.dark,
  },
  content: {
    padding: 24,
  },
  resultCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeNormal,
    padding: 20,
    marginBottom: 20,
  },
  cardLabel: {
    color: DTColors.modeNormal,
    letterSpacing: 2,
    marginBottom: 12,
  },
  divider: {
    backgroundColor: DTColors.modeNormal,
    opacity: 0.3,
    marginBottom: 16,
  },
  dataRow: {
    marginBottom: 16,
  },
  dataLabel: {
    color: DTColors.light,
    opacity: 0.6,
    marginBottom: 4,
    letterSpacing: 1,
  },
  dataValue: {
    color: DTColors.light,
    fontFamily: 'monospace',
  },
  noData: {
    color: DTColors.light,
    opacity: 0.6,
    fontStyle: 'italic',
  },
  matchCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeEmphasis,
    padding: 20,
    marginBottom: 20,
  },
  matchLabel: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
    marginBottom: 12,
  },
  placeholderText: {
    color: DTColors.light,
    opacity: 0.8,
    marginBottom: 8,
  },
  hintText: {
    color: DTColors.light,
    opacity: 0.5,
    fontStyle: 'italic',
  },
  conversionCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeOther,
    padding: 20,
    marginBottom: 32,
    alignItems: 'center',
  },
  conversionText: {
    color: DTColors.light,
    textAlign: 'center',
    marginBottom: 16,
    opacity: 0.9,
  },
  conversionButton: {
    borderColor: DTColors.modeOther,
    borderWidth: 2,
  },
  conversionButtonLabel: {
    color: DTColors.modeOther,
    letterSpacing: 1,
  },
  actions: {
    alignItems: 'center',
    gap: 16,
  },
  actionButton: {
    borderColor: DTColors.modeNormal,
    borderWidth: 2,
    width: '100%',
  },
  actionButtonLabel: {
    color: DTColors.modeNormal,
    letterSpacing: 2,
  },
  homeLabel: {
    color: DTColors.light,
    opacity: 0.6,
  },
});
