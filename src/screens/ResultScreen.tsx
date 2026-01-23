import React from 'react';
import {StyleSheet, View, ScrollView, Linking} from 'react-native';
import {Button, Text, Surface, Divider, Chip} from 'react-native-paper';
import type {ResultScreenProps} from '../types/navigation';
import {DTColors} from '../theme';

export function ResultScreen({route, navigation}: ResultScreenProps) {
  const {tagData, transponder} = route.params;

  const handleConversionLink = () => {
    Linking.openURL('https://dngr.us/conversion');
  };

  // Determine card colors based on detection
  const getCloneabilityColor = () => {
    if (!transponder) return DTColors.light;
    return transponder.isCloneable ? DTColors.modeSuccess : DTColors.modeWarning;
  };

  const getConfidenceLabel = () => {
    if (!transponder) return null;
    const colors = {
      high: DTColors.modeSuccess,
      medium: DTColors.modeEmphasis,
      low: DTColors.modeWarning,
    };
    return {color: colors[transponder.confidence], label: `${transponder.confidence.toUpperCase()} CONFIDENCE`};
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Chip Identification Card */}
        {transponder && (
          <Surface style={styles.identificationCard} elevation={1}>
            <Text variant="labelLarge" style={styles.identificationLabel}>
              CHIP IDENTIFIED
            </Text>
            <Divider style={styles.divider} />

            <Text variant="headlineMedium" style={styles.chipName}>
              {transponder.chipName}
            </Text>

            <View style={styles.chipMeta}>
              <Chip
                style={[styles.familyChip, {borderColor: DTColors.modeNormal}]}
                textStyle={styles.familyChipText}>
                {transponder.family}
              </Chip>
              {getConfidenceLabel() && (
                <Chip
                  style={[styles.confidenceChip, {borderColor: getConfidenceLabel()!.color}]}
                  textStyle={[styles.confidenceChipText, {color: getConfidenceLabel()!.color}]}>
                  {getConfidenceLabel()!.label}
                </Chip>
              )}
            </View>

            {transponder.memorySize && (
              <View style={styles.detailRow}>
                <Text variant="bodyMedium" style={styles.detailLabel}>
                  MEMORY
                </Text>
                <Text variant="bodyLarge" style={styles.detailValue}>
                  {transponder.memorySize} bytes
                </Text>
              </View>
            )}

            <View style={styles.detailRow}>
              <Text variant="bodyMedium" style={styles.detailLabel}>
                CLONEABLE
              </Text>
              <Text
                variant="bodyLarge"
                style={[styles.detailValue, {color: getCloneabilityColor()}]}>
                {transponder.isCloneable ? 'YES' : 'NO'}
              </Text>
            </View>

            {transponder.cloneabilityNote && (
              <Text variant="bodySmall" style={styles.cloneabilityNote}>
                {transponder.cloneabilityNote}
              </Text>
            )}
          </Surface>
        )}

        {/* SAK Swap Detection Card */}
        {transponder?.sakSwapInfo?.hasSakSwap && (
          <Surface style={styles.sakSwapCard} elevation={1}>
            <Text variant="labelLarge" style={styles.sakSwapLabel}>
              SAK SWAP DETECTED
            </Text>
            <Divider style={[styles.divider, {backgroundColor: DTColors.modeEmphasis}]} />

            <Text variant="bodyLarge" style={styles.sakSwapType}>
              {transponder.sakSwapInfo.swapType?.replace(/_/g, ' ').toUpperCase()}
            </Text>

            <Text variant="bodyMedium" style={styles.sakSwapDescription}>
              {transponder.sakSwapInfo.description}
            </Text>

            {transponder.sakSwapInfo.notes && transponder.sakSwapInfo.notes.length > 0 && (
              <View style={styles.sakSwapNotes}>
                {transponder.sakSwapInfo.notes.map((note, index) => (
                  <Text key={index} variant="bodySmall" style={styles.sakSwapNote}>
                    • {note}
                  </Text>
                ))}
              </View>
            )}
          </Surface>
        )}

        {/* Raw Tag Data Card */}
        <Surface style={styles.resultCard} elevation={1}>
          <Text variant="labelLarge" style={styles.cardLabel}>
            RAW TAG DATA
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

        {/* No Detection Card (fallback) */}
        {!transponder && (
          <Surface style={styles.noDetectionCard} elevation={1}>
            <Text variant="labelLarge" style={styles.noDetectionLabel}>
              CHIP NOT IDENTIFIED
            </Text>
            <Divider style={[styles.divider, {backgroundColor: DTColors.modeWarning}]} />
            <Text variant="bodyMedium" style={styles.noDetectionText}>
              Unable to identify this chip type. It may be unsupported or require advanced detection.
            </Text>
          </Surface>
        )}

        {/* Conversion Service Card - only show if chip is NOT cloneable */}
        {(!transponder || !transponder.isCloneable) && (
          <Surface style={styles.conversionCard} elevation={1}>
            <Text variant="bodyMedium" style={styles.conversionText}>
              Can't clone this chip? Check out our conversion service.
            </Text>
            <Button
              mode="outlined"
              onPress={handleConversionLink}
              style={styles.conversionButton}
              labelStyle={styles.conversionButtonLabel}>
              CONVERSION SERVICE
            </Button>
          </Surface>
        )}

        {/* Action Buttons */}
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
  // Identification Card
  identificationCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: DTColors.modeSuccess,
    padding: 20,
    marginBottom: 20,
  },
  identificationLabel: {
    color: DTColors.modeSuccess,
    letterSpacing: 2,
    marginBottom: 12,
  },
  chipName: {
    color: DTColors.light,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  chipMeta: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  familyChip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  familyChipText: {
    color: DTColors.modeNormal,
    fontSize: 12,
  },
  confidenceChip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
  },
  confidenceChipText: {
    fontSize: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  detailLabel: {
    color: DTColors.light,
    opacity: 0.6,
    letterSpacing: 1,
  },
  detailValue: {
    color: DTColors.light,
  },
  cloneabilityNote: {
    color: DTColors.light,
    opacity: 0.5,
    fontStyle: 'italic',
    marginTop: 8,
  },
  // SAK Swap Card
  sakSwapCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: DTColors.modeEmphasis,
    padding: 20,
    marginBottom: 20,
  },
  sakSwapLabel: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
    marginBottom: 12,
  },
  sakSwapType: {
    color: DTColors.modeEmphasis,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  sakSwapDescription: {
    color: DTColors.light,
    opacity: 0.9,
    marginBottom: 12,
  },
  sakSwapNotes: {
    marginTop: 8,
  },
  sakSwapNote: {
    color: DTColors.light,
    opacity: 0.7,
    marginBottom: 4,
  },
  // Raw Data Card
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
  // No Detection Card
  noDetectionCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeWarning,
    padding: 20,
    marginBottom: 20,
  },
  noDetectionLabel: {
    color: DTColors.modeWarning,
    letterSpacing: 2,
    marginBottom: 12,
  },
  noDetectionText: {
    color: DTColors.light,
    opacity: 0.8,
  },
  // Conversion Card
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
  // Actions
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
