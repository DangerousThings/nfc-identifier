/**
 * Animated NFC Scan Indicator
 *
 * Shows pulsing concentric rings during NFC scanning. Honours the design
 * system's animation speed: durations scale with it, and at 0 the rings sit
 * in their resting state without animating.
 */

import React, {useEffect, useRef} from 'react';
import {View, StyleSheet, Animated, Easing} from 'react-native';
import {useDTMotionScale} from '@dangerousthings/react-native';
import {useColors} from '../../hooks/useColors';

interface ScanAnimationProps {
  /** Whether the animation is active */
  isActive: boolean;
  /** Color for the rings (defaults to the theme's modeNormal) */
  color?: string;
  /** Size of the component */
  size?: number;
}

/** Pulse length and ring stagger at motion scale 1. */
const PULSE_DURATION = 2000;
const RING_STAGGER = [0, 666, 1333];

export function ScanAnimation({
  isActive,
  color: colorProp,
  size = 200,
}: ScanAnimationProps) {
  const colors = useColors();
  const motionScale = useDTMotionScale();
  const color = colorProp ?? colors.modeNormal;

  // Animation values for each ring
  const ring1 = useRef(new Animated.Value(0)).current;
  const ring2 = useRef(new Animated.Value(0)).current;
  const ring3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!isActive || motionScale === 0) {
      // Reset to the resting state when not active or animation is off
      ring1.setValue(0);
      ring2.setValue(0);
      ring3.setValue(0);
      return;
    }

    // Create staggered pulsing animations
    const createPulse = (animatedValue: Animated.Value, delay: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.delay(delay * motionScale),
          Animated.timing(animatedValue, {
            toValue: 1,
            duration: PULSE_DURATION * motionScale,
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

    const animation1 = createPulse(ring1, RING_STAGGER[0]);
    const animation2 = createPulse(ring2, RING_STAGGER[1]);
    const animation3 = createPulse(ring3, RING_STAGGER[2]);

    animation1.start();
    animation2.start();
    animation3.start();

    return () => {
      animation1.stop();
      animation2.stop();
      animation3.stop();
    };
  }, [isActive, motionScale, ring1, ring2, ring3]);

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
