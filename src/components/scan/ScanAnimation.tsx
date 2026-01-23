/**
 * Animated NFC Scan Indicator
 *
 * Shows pulsing concentric rings during NFC scanning
 */

import React, {useEffect, useRef} from 'react';
import {View, StyleSheet, Animated, Easing} from 'react-native';
import {DTColors} from '../../theme';

interface ScanAnimationProps {
  /** Whether the animation is active */
  isActive: boolean;
  /** Color for the rings (defaults to modeNormal/cyan) */
  color?: string;
  /** Size of the component */
  size?: number;
}

export function ScanAnimation({
  isActive,
  color = DTColors.modeNormal,
  size = 200,
}: ScanAnimationProps) {
  // Animation values for each ring
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isActive) {
      // Reset animations when not active
      ring1.setValue(0);
      ring2.setValue(0);
      ring3.setValue(0);
      return;
    }

    // Create staggered pulsing animations
    const createPulse = (animatedValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: 2000,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(animatedValue, {
            toValue: 0,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      );
    };

    const animation1 = createPulse(ring1, 0);
    const animation2 = createPulse(ring2, 666);
    const animation3 = createPulse(ring3, 1333);

    animation1.start();
    animation2.start();
    animation3.start();

    return () => {
      animation1.stop();
      animation2.stop();
      animation3.stop();
    };
  }, [isActive, ring1, ring2, ring3]);

  const createRingStyle = (animatedValue: Animated.Value) => {
    const scale = animatedValue.interpolate({
      inputRange: [0, 1],
      outputRange: [0.3, 1],
    });

    const opacity = animatedValue.interpolate({
      inputRange: [0, 0.5, 1],
      outputRange: [0.8, 0.4, 0],
    });

    return {
      transform: [{scale}],
      opacity,
      borderColor: color,
    };
  };

  return (
    <View style={[styles.container, {width: size, height: size}]}>
      {/* Pulsing rings */}
      <Animated.View
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2},
          createRingStyle(ring1),
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2},
          createRingStyle(ring2),
        ]}
      />
      <Animated.View
        style={[
          styles.ring,
          {width: size, height: size, borderRadius: size / 2},
          createRingStyle(ring3),
        ]}
      />

      {/* Center dot */}
      <View style={[styles.centerDot, {backgroundColor: color}]} />

      {/* NFC icon representation */}
      <View style={styles.nfcIcon}>
        <View style={[styles.nfcArc, styles.nfcArc1, {borderColor: color}]} />
        <View style={[styles.nfcArc, styles.nfcArc2, {borderColor: color}]} />
        <View style={[styles.nfcArc, styles.nfcArc3, {borderColor: color}]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  centerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    position: 'absolute',
  },
  nfcIcon: {
    position: 'absolute',
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingLeft: 10,
  },
  nfcArc: {
    position: 'absolute',
    borderWidth: 2,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 50,
    borderBottomRightRadius: 50,
  },
  nfcArc1: {
    width: 15,
    height: 20,
    left: 20,
  },
  nfcArc2: {
    width: 25,
    height: 34,
    left: 20,
  },
  nfcArc3: {
    width: 35,
    height: 48,
    left: 20,
  },
});
