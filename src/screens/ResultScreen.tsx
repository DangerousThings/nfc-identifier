import React, { useMemo, useState, useEffect, useRef } from 'react';
import { StyleSheet, View, ScrollView, Linking, TouchableOpacity, Animated } from 'react-native';
import { Button, Text, Surface, Divider, Chip } from 'react-native-paper';
import { DTCard, DTButton, DTColors, DTLabel, DTChip } from 'react-native-dt-theme';

// Animated section wrapper for staggered entry
interface AnimatedSectionProps {
  children: React.ReactNode;
  delay: number;
  duration?: number;
  style?: any;
}

function AnimatedSection({ children, delay, duration = 400, style }: AnimatedSectionProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, duration, opacity, translateY]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}
import type { ResultScreenProps } from '../types/navigation';
import { matchChipToProducts, getMatchSummary, getDesfireEvMismatchWarning, getMifareClassicCapacityWarning } from '../services/matching';
import { Product } from '../types/products';
import { getChipInfo, getChipFamilyInfo, getSecurityLevelDescription } from '../data/chipInfo';
import { getChipFamily } from '../types/detection';

export function ResultScreen({ route, navigation }: ResultScreenProps) {
  const { tagData, transponder } = route.params;
  const [showChipInfo, setShowChipInfo] = useState(false);

  // Match chip to products
  const matchResult = useMemo(() => {
    if (!transponder) return null;
    return matchChipToProducts(transponder);
  }, [transponder]);

  // Get educational chip info
  const chipInfo = useMemo(() => {
    if (!transponder) return null;
    return getChipInfo(transponder.type);
  }, [transponder]);

  const chipFamilyInfo = useMemo(() => {
    if (!transponder) return null;
    return getChipFamilyInfo(getChipFamily(transponder.type));
  }, [transponder]);

  // Calculate product count for animation timing
  const productCount = useMemo(() => {
    if (!matchResult) return 0;
    const exactCount = matchResult.exactMatches.length;
    const cloneCount = matchResult.cloneTargets.filter(
      p => !matchResult.exactMatches.find(e => e.id === p.id)
    ).length;
    return exactCount + cloneCount;
  }, [matchResult]);

  // Animation delays - sequential flow
  const delays = useMemo(() => {
    const base = {
      chipIdentified: 0,
      aboutChip: 150,
      compatibleLabel: 300,
      productBase: 450,
      productIncrement: 150,
    };
    const afterProducts = base.productBase + (productCount * base.productIncrement);
    return {
      ...base,
      noMatch: base.compatibleLabel, // Shows in place of products
      sakSwap: base.aboutChip, // Shows after chip info
      rawData: productCount > 0 ? afterProducts : 300,
      actions: productCount > 0 ? afterProducts + 150 : 450,
      conversion: productCount > 0 ? afterProducts + 75 : 375, // Between raw data and actions
    };
  }, [productCount]);

  // Build URL with UTM tracking parameters for analytics
  const buildTrackedUrl = (baseUrl: string, content?: string) => {
    const url = new URL(baseUrl);
    url.searchParams.set('utm_source', 'dt_nfc_identifier');
    url.searchParams.set('utm_medium', 'app');
    url.searchParams.set('utm_campaign', 'chip_scan');
    if (content) {
      url.searchParams.set('utm_content', content);
    }
    return url.toString();
  };

  const handleConversionLink = () => {
    const baseUrl = matchResult?.conversionUrl || 'https://dngr.us/conversion';
    const content = transponder?.chipName || transponder?.type;
    Linking.openURL(buildTrackedUrl(baseUrl, content));
  };

  const handleProductLink = (product: Product) => {
    Linking.openURL(buildTrackedUrl(product.url, product.name));
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
    return { color: colors[transponder.confidence], label: `${transponder.confidence.toUpperCase()} CONFIDENCE` };
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        {/* Chip Identification Card */}
        {transponder && (
          <AnimatedSection delay={delays.chipIdentified}>
            <DTCard mode="success" title="CHIP IDENTIFIED" style={{ marginBottom: 20 }}>

              <Text variant="headlineMedium" style={styles.chipName}>
                {transponder.chipName}
              </Text>

              {/* Show implant name if detected from memory, or payment device */}
              {transponder.implantName && (
                transponder.implantName.includes('Payment Card') ? (
                  <View style={styles.paymentDeviceRow}>
                    <Text variant="labelMedium" style={styles.paymentDeviceLabel}>
                      PAYMENT DEVICE DETECTED
                    </Text>
                    <Text variant="titleLarge" style={styles.paymentDeviceValue}>
                      {transponder.implantName.replace(' Payment Card', '')}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.implantNameRow}>
                    <Text variant="labelMedium" style={styles.implantNameLabel}>
                      IMPLANT DETECTED
                    </Text>
                    <Text variant="titleLarge" style={styles.implantNameValue}>
                      {transponder.implantName}
                    </Text>
                  </View>
                )
              )}

              <View style={styles.chipMeta}>
                <DTChip
                  variant="normal">
                  {transponder.family}
                </DTChip>
                {getConfidenceLabel() && (
                  <DTChip
                    variant='other'
                  // style={[styles.confidenceChip, { borderColor: getConfidenceLabel()!.color }]}
                  // textStyle={[styles.confidenceChipText, { color: getConfidenceLabel()!.color }]}>
                  >
                    {getConfidenceLabel()!.label}
                  </DTChip>
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
                  style={[styles.detailValue, { color: getCloneabilityColor() }]}>
                  {transponder.isCloneable ? 'YES' : 'NO'}
                </Text>
              </View>

              {transponder.cloneabilityNote && (
                <Text variant="bodySmall" style={styles.cloneabilityNote}>
                  {transponder.cloneabilityNote}
                </Text>
              )}
            </DTCard>
          </AnimatedSection>
        )}

        {/* Educational Chip Info Card */}
        {transponder && (chipInfo || chipFamilyInfo) && (
          <AnimatedSection delay={delays.aboutChip}>
            <Surface style={styles.chipInfoCard} elevation={1}>
              <TouchableOpacity
                onPress={() => setShowChipInfo(!showChipInfo)}
                style={styles.chipInfoHeader}
                activeOpacity={0.7}>
                <Text variant="labelLarge" style={styles.chipInfoLabel}>
                  ABOUT THIS CHIP
                </Text>
                <Text style={styles.expandIndicator}>
                  {showChipInfo ? '▼' : '▶'}
                </Text>
              </TouchableOpacity>

              {showChipInfo && (
                <>
                  <Divider style={[styles.divider, { backgroundColor: DTColors.modeOther }]} />

                  {/* Family description */}
                  {chipFamilyInfo && (
                    <Text variant="bodyMedium" style={styles.chipFamilyDescription}>
                      {chipFamilyInfo}
                    </Text>
                  )}

                  {/* Detailed chip info */}
                  {chipInfo && (
                    <>
                      <Text variant="bodyMedium" style={styles.chipDescription}>
                        {chipInfo.description}
                      </Text>

                      {chipInfo.memoryNote && (
                        <View style={styles.chipInfoRow}>
                          <Text variant="bodySmall" style={styles.chipInfoRowLabel}>
                            Memory:
                          </Text>
                          <Text variant="bodySmall" style={styles.chipInfoRowValue}>
                            {chipInfo.memoryNote}
                          </Text>
                        </View>
                      )}

                      <View style={styles.chipInfoRow}>
                        <Text variant="bodySmall" style={styles.chipInfoRowLabel}>
                          Security:
                        </Text>
                        <Text
                          variant="bodySmall"
                          style={[
                            styles.chipInfoRowValue,
                            {
                              color:
                                chipInfo.securityLevel === 'high'
                                  ? DTColors.modeSuccess
                                  : chipInfo.securityLevel === 'medium'
                                    ? DTColors.modeEmphasis
                                    : DTColors.modeWarning,
                            },
                          ]}>
                          {chipInfo.securityLevel.toUpperCase()}
                        </Text>
                      </View>

                      <Text variant="bodySmall" style={styles.securityNote}>
                        {getSecurityLevelDescription(chipInfo.securityLevel)}
                      </Text>

                      {chipInfo.commonUses.length > 0 && (
                        <>
                          <Text variant="labelSmall" style={styles.chipInfoSectionLabel}>
                            COMMON USES
                          </Text>
                          {chipInfo.commonUses.map((use, idx) => (
                            <Text key={idx} variant="bodySmall" style={styles.chipInfoListItem}>
                              • {use}
                            </Text>
                          ))}
                        </>
                      )}

                      {chipInfo.capabilities.length > 0 && (
                        <>
                          <Text variant="labelSmall" style={styles.chipInfoSectionLabel}>
                            CAPABILITIES
                          </Text>
                          {chipInfo.capabilities.map((cap, idx) => (
                            <Text key={idx} variant="bodySmall" style={styles.chipInfoListItem}>
                              • {cap}
                            </Text>
                          ))}
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </Surface>
          </AnimatedSection>
        )}

        {/* Product Matches Card - hide for payment devices */}
        {transponder && matchResult && (matchResult.exactMatches.length > 0 || matchResult.cloneTargets.length > 0) && !transponder.implantName?.includes('Payment Card') && (
          <AnimatedSection delay={delays.compatibleLabel}>
            <DTLabel mode='emphasis' primaryText="Compatible Implants" style={{ marginBottom: 25, }} size="large" animated={false} />
          </AnimatedSection>
        )}

        {/* Individual Product Cards - staggered */}
        {transponder && matchResult && (matchResult.exactMatches.length > 0 || matchResult.cloneTargets.length > 0) && !transponder.implantName?.includes('Payment Card') && (
          [...matchResult.exactMatches, ...matchResult.cloneTargets.filter(
            p => !matchResult.exactMatches.find(e => e.id === p.id)
          )].map((product, index) => (
            <AnimatedSection key={product.id} delay={delays.productBase + (index * delays.productIncrement)}>
              <DTCard mode='emphasis' title={product.name} style={{ marginBottom: 25 }}>
                <View style={styles.productHeader}>
                  {/* <Text variant="titleMedium" style={styles.productName}>
                    {product.name}
                  </Text> */}
                  <DTChip
                    style={styles.formFactorChip}
                    textStyle={styles.formFactorChipText}>
                    {product.formFactor.replace('_', ' ')}
                  </DTChip>
                  {product.formFactor.startsWith("X") && <Text style={styles.chipDescription}>Injectable</Text>}
                  {product.formFactor.startsWith("B") && <Text style={styles.chipDescription}>Large, rigid</Text>}
                  {product.formFactor.startsWith("F") && <Text style={styles.chipDescription}>Large, semi-rigid</Text>}
                </View>

                <Text variant="bodySmall" style={styles.productDescription}>
                  {product.description}
                </Text>

                {product.notes && (
                  <Text variant="bodySmall" style={styles.productNote}>
                    Note: {product.notes}
                  </Text>
                )}

                {/* DESFire EV mismatch warning */}
                {getDesfireEvMismatchWarning(transponder.type, product) && (
                  <Text variant="bodySmall" style={styles.evMismatchWarning}>
                    ⚠️ {getDesfireEvMismatchWarning(transponder.type, product)}
                  </Text>
                )}

                {/* MIFARE Classic 4K → 1K capacity warning */}
                {getMifareClassicCapacityWarning(transponder.type, product) && (
                  <Text variant="bodySmall" style={styles.evMismatchWarning}>
                    ⚠️ {getMifareClassicCapacityWarning(transponder.type, product)}
                  </Text>
                )}

                <View style={styles.productFeatures}>
                  {product.features.slice(0, 3).map((feature, idx) => (
                    <Text key={idx} variant="bodySmall" style={styles.productFeature}>
                      • {feature}
                    </Text>
                  ))}
                </View>

                <DTButton
                  onPress={() => handleProductLink(product)}
                >
                  VIEW PRODUCT

                </DTButton>
              </DTCard>
            </AnimatedSection>
          ))
        )}

        {/* No Match Card - show when chip detected but no products match */}
        {transponder && matchResult && matchResult.exactMatches.length === 0 && matchResult.cloneTargets.length === 0 && (
          <AnimatedSection delay={delays.noMatch}>
            <Surface style={styles.noMatchCard} elevation={1}>
              <Text variant="labelLarge" style={styles.noMatchLabel}>
                NO DIRECT MATCH
              </Text>
              <Divider style={[styles.divider, { backgroundColor: DTColors.modeOther }]} />

              <Text variant="bodyMedium" style={styles.noMatchText}>
                {getMatchSummary(matchResult, transponder.chipName)}
              </Text>

              {matchResult.familyMatches.length > 0 && (
                <>
                  <Text variant="bodySmall" style={styles.familyMatchesLabel}>
                    Related products in the same chip family:
                  </Text>
                  {matchResult.familyMatches.slice(0, 2).map(product => (
                    <Text key={product.id} variant="bodySmall" style={styles.familyMatchItem}>
                      • {product.name}
                    </Text>
                  ))}
                </>
              )}
            </Surface>
          </AnimatedSection>
        )}

        {/* SAK Swap Detection Card */}
        {transponder?.sakSwapInfo?.hasSakSwap && (
          <AnimatedSection delay={delays.sakSwap}>
            <Surface style={styles.sakSwapCard} elevation={1}>
              <Text variant="labelLarge" style={styles.sakSwapLabel}>
                SAK SWAP DETECTED
              </Text>
              <Divider style={[styles.divider, { backgroundColor: DTColors.modeEmphasis }]} />

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
          </AnimatedSection>
        )}

        {/* Raw Tag Data Card */}
        <AnimatedSection delay={delays.rawData}>
          <DTCard mode="normal" title="RAW TAG DATA" style={{ marginBottom: 20 }}>

            {tagData ? (
              <>
                <View style={styles.dataRow}>
                  <Text variant="bodyLarge" style={styles.dataLabel}>
                    UID
                  </Text>
                  <Text variant="bodyMedium" style={styles.dataValue}>
                    {tagData.uid || 'N/A'}
                  </Text>
                </View>

                <View style={styles.dataRow}>
                  <Text variant="bodyLarge" style={styles.dataLabel}>
                    TECHNOLOGIES
                  </Text>
                  {
                    tagData.techTypes.map((t, i) =>
                      <Text key={i} variant="bodyMedium" style={styles.dataValue}>
                        {t}
                      </Text>)
                  }
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
          </DTCard>
        </AnimatedSection>

        {/* No Detection Card (fallback) */}
        {!transponder && (
          <AnimatedSection delay={0}>
            <Surface style={styles.noDetectionCard} elevation={1}>
              <Text variant="labelLarge" style={styles.noDetectionLabel}>
                CHIP NOT IDENTIFIED
              </Text>
              <Divider style={[styles.divider, { backgroundColor: DTColors.modeWarning }]} />
              <Text variant="bodyMedium" style={styles.noDetectionText}>
                Unable to identify this chip type. It may be unsupported or require advanced detection.
              </Text>
              <Text variant="bodyMedium" style={styles.noDetectionText}>
                Need help? Ask on our forum for assistance.
              </Text>
              <DTButton
                onPress={() => Linking.openURL(buildTrackedUrl('https://dngr.us/forum', 'unknown_chip'))}
              >
                VISIT FORUM
              </DTButton>
            </Surface>
          </AnimatedSection>
        )}

        {/* Conversion Service Card - show for payment devices, or when recommended (but NOT for unidentified chips) */}
        {transponder && (transponder?.implantName?.includes('Payment Card') ||
          (matchResult?.conversionRecommended && !transponder?.implantName)) && (
            <AnimatedSection delay={delays.conversion}>
              <Surface style={styles.conversionCard} elevation={1}>
                <Text variant="bodyMedium" style={styles.conversionText}>
                  {transponder?.implantName?.includes('Payment Card')
                    ? "Payment cards can't be copied/cloned to implants. Our conversion service might be an option."
                    : !transponder
                      ? 'Unknown chip? Our conversion service can help.'
                      : matchResult?.isCloneable === false
                        ? "This chip uses cryptographic protection and can't be cloned. Our conversion service can help find alternatives."
                        : "No direct product match found. Our conversion service can help."}
                </Text>
                <Button
                  mode="outlined"
                  onPress={handleConversionLink}
                  style={styles.conversionButton}
                  labelStyle={styles.conversionButtonLabel}>
                  CONVERSION SERVICE
                </Button>
              </Surface>
            </AnimatedSection>
          )}

        {/* Action Buttons */}
        <AnimatedSection delay={delays.actions}>
          <View style={styles.actions}>
            <DTButton
              variant="normal"
              onPress={() => navigation.navigate('Scan')}
              style={{ width: '100%' }}>
              SCAN ANOTHER
            </DTButton>

            <Button
              mode="text"
              onPress={() => navigation.navigate('Home')}
              labelStyle={styles.homeLabel}>
              HOME
            </Button>
          </View>
        </AnimatedSection>
      </View>
    </ScrollView >
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
    marginBottom: 12,
  },
  forumButton: {
    borderColor: DTColors.modeWarning,
    borderWidth: 1,
    marginTop: 8,
  },
  forumButtonLabel: {
    color: DTColors.modeWarning,
    fontSize: 12,
  },
  // Products Card
  productsCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 2,
    borderColor: DTColors.modeEmphasis,
    padding: 20,
    marginBottom: 20,
  },
  productsLabel: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
    marginBottom: 12,
  },
  matchSummary: {
    color: DTColors.light,
    marginBottom: 16,
  },
  productItem: {
    backgroundColor: '#111111',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeNormal,
    padding: 16,
    marginBottom: 12,
  },
  productHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  productName: {
    color: DTColors.modeEmphasis,
    fontWeight: 'bold',
  },
  formFactorChip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: DTColors.modeNormal,
    height: 35,
  },
  formFactorChipText: {
    color: DTColors.modeNormal,
    fontSize: 10,
  },
  productDescription: {
    color: DTColors.light,
    opacity: 0.8,
    marginBottom: 8,
  },
  productNote: {
    color: DTColors.modeOther,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  evMismatchWarning: {
    color: DTColors.modeEmphasis,
    backgroundColor: 'rgba(255, 255, 0, 0.1)',
    padding: 8,
    borderRadius: 4,
    marginBottom: 8,
  },
  productFeatures: {
    marginBottom: 12,
  },
  productFeature: {
    color: DTColors.light,
    opacity: 0.7,
    marginBottom: 2,
  },
  productButton: {
    borderColor: DTColors.modeEmphasis,
    borderWidth: 1,
  },
  productButtonLabel: {
    color: DTColors.modeEmphasis,
    fontSize: 12,
  },
  // No Match Card
  noMatchCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeOther,
    padding: 20,
    marginBottom: 20,
  },
  noMatchLabel: {
    color: DTColors.modeOther,
    letterSpacing: 2,
    marginBottom: 12,
  },
  noMatchText: {
    color: DTColors.light,
    opacity: 0.8,
    marginBottom: 12,
  },
  familyMatchesLabel: {
    color: DTColors.light,
    opacity: 0.6,
    marginBottom: 8,
  },
  familyMatchItem: {
    color: DTColors.modeNormal,
    marginBottom: 4,
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
  // Chip Info Card
  chipInfoCard: {
    backgroundColor: '#0a0a0a',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeOther,
    padding: 20,
    marginBottom: 20,
  },
  chipInfoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipInfoLabel: {
    color: DTColors.modeOther,
    letterSpacing: 2,
  },
  expandIndicator: {
    color: DTColors.modeOther,
    fontSize: 12,
  },
  chipFamilyDescription: {
    color: DTColors.light,
    opacity: 0.8,
    marginBottom: 12,
    lineHeight: 22,
  },
  chipDescription: {
    color: DTColors.light,
    marginBottom: 16,
    lineHeight: 22,
  },
  chipInfoRow: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  chipInfoRowLabel: {
    color: DTColors.light,
    opacity: 0.6,
    marginRight: 8,
  },
  chipInfoRowValue: {
    color: DTColors.light,
  },
  securityNote: {
    color: DTColors.light,
    opacity: 0.5,
    fontStyle: 'italic',
    marginTop: 4,
    marginBottom: 16,
  },
  chipInfoSectionLabel: {
    color: DTColors.modeOther,
    letterSpacing: 1,
    marginTop: 8,
    marginBottom: 8,
  },
  chipInfoListItem: {
    color: DTColors.light,
    opacity: 0.8,
    marginBottom: 4,
  },
  // Implant name styles
  implantNameRow: {
    backgroundColor: 'rgba(0, 255, 0, 0.1)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeSuccess,
    padding: 12,
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  implantNameLabel: {
    color: DTColors.modeSuccess,
    letterSpacing: 2,
    marginBottom: 4,
  },
  implantNameValue: {
    color: DTColors.modeSuccess,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  // Payment device styles
  paymentDeviceRow: {
    backgroundColor: 'rgba(255, 255, 0, 0.1)',
    borderRadius: 4,
    borderWidth: 1,
    borderColor: DTColors.modeEmphasis,
    padding: 12,
    marginTop: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  paymentDeviceLabel: {
    color: DTColors.modeEmphasis,
    letterSpacing: 2,
    marginBottom: 4,
  },
  paymentDeviceValue: {
    color: DTColors.modeEmphasis,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
