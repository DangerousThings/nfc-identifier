/**
 * useScan Hook
 * React hook for managing NFC scan state and operations
 */

import {useState, useCallback, useEffect, useRef} from 'react';
import {Platform} from 'react-native';
import {isTagLoss} from '@dangerousthings/transponders';
import {nfcManager} from '../services/nfc';
import {identifyTransponder} from '../services/detection/adapter';
import * as fixtureRecorder from '../services/detection/fixtureRecorder';
import {isFixtureCaptureEnabled} from './useFixtureCapture';
import {sampleCollector} from '../services/motion';
import type {ScanState, RawTagData, ScanError, NFCStatus} from '../types/nfc';
import type {Transponder} from '../types/detection';
import type {ConsentStatus} from '../types/motion';

/** Progress update during scanning */
export interface ScanProgress {
  /** Current step description */
  step: string;
  /** Step number (1-indexed) */
  current: number;
  /** Total steps (if known) */
  total?: number;
}

export interface UseScanResult {
  /** Current scan state */
  state: ScanState;
  /** Scanned tag data (when state is 'success') */
  tag: RawTagData | null;
  /** Detected transponder info (when detection succeeds) */
  transponder: Transponder | null | undefined;
  /** Scan error (when state is 'error') */
  error: ScanError | null;
  /** NFC status (supported and enabled) */
  nfcStatus: NFCStatus;
  /** Current scan progress (during 'scanning' state) */
  scanProgress: ScanProgress | null;
  /** Start scanning for a tag */
  startScan: () => Promise<void>;
  /** Cancel ongoing scan */
  cancelScan: () => Promise<void>;
  /** Reset state to idle */
  reset: () => void;
  /** Open device NFC settings */
  openSettings: () => Promise<void>;
}

/**
 * Hook for managing NFC scanning
 */
// Combined scan result to ensure atomic updates
interface ScanResult {
  tag: RawTagData | null;
  transponder: Transponder | null | undefined;
}

export function useScan(consentStatus?: ConsentStatus): UseScanResult {
  const canCapture = consentStatus === 'opted_in';
  const [state, setState] = useState<ScanState>('idle');
  // Use combined state to ensure tag and transponder update atomically
  const [scanResult, setScanResult] = useState<ScanResult>({
    tag: null,
    transponder: undefined,
  });
  const [error, setError] = useState<ScanError | null>(null);
  // Optimistic default: assume NFC is supported until the async status check
  // (below) says otherwise. Starting false made ScanScreen flash "NFC NOT
  // SUPPORTED" for the moment between mount and the check resolving (most
  // visible on swipe-back into a fresh scan). isEnabled stays false — the
  // "NFC DISABLED" screen also requires an error to be set, so it won't flash.
  const [nfcStatus, setNfcStatus] = useState<NFCStatus>({
    isSupported: true,
    isEnabled: false,
  });
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  // Track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);

  // Track if a scan is in progress
  const scanInProgress = useRef(false);

  // True once a scan has succeeded and we've handed the tag off to the Result
  // screen. When set, we must NOT release the NFC session on ScanScreen unmount:
  // the card is still on the antenna and releasing here dispatches it to whoever
  // declares an NFC intent filter (NDEF Commander's .RuleTagDispatch → a chooser
  // dialog). We hold the field across the whole scan->result flow; ResultScreen
  // releases it on unmount, by which point the card is removed. See FORK.md
  // "Dispatch ownership".
  const handedOffToResult = useRef(false);

  // Initialize NFC and check status
  useEffect(() => {
    let mounted = true;

    async function initialize() {
      await nfcManager.init();
      if (mounted) {
        const status = await nfcManager.getStatus();
        setNfcStatus(status);
      }
    }

    initialize();

    return () => {
      mounted = false;
      isMounted.current = false;
      // Cleanup on unmount — but only if we did NOT hand a successful scan off to
      // the Result screen. On success the session is held across the scan->result
      // flow and ResultScreen releases it; releasing here would leak the still-
      // present tag to the OS dispatcher (see handedOffToResult).
      if (!handedOffToResult.current) {
        nfcManager.cancelScan();
      }
    };
  }, []);

  // Start scanning for a tag
  const startScan = useCallback(async () => {
    // Prevent multiple concurrent scans
    if (scanInProgress.current) {
      return;
    }

    scanInProgress.current = true;
    handedOffToResult.current = false;

    // Show the scanning UI immediately. This MUST happen before the awaited
    // cancelScan() below: cancelScan can block ~1s (the fork's unregister delay),
    // and while state is still 'idle' with the initial nfcStatus (isSupported:
    // false) the screen would flash "NFC NOT SUPPORTED".
    setState('scanning');
    setScanResult({ tag: null, transponder: undefined });
    setError(null);
    setScanProgress({step: 'Waiting for tag...', current: 1});

    // Capture motion data at moment user initiates scan
    if (canCapture) {
      sampleCollector.captureSample('scan_initiated');
    }

    // Release any session still held from a previous scan->result flow (e.g. the
    // user came back here from Result) before arming a fresh one.
    await nfcManager.cancelScan();

    try {
      // Check NFC status first
      const status = await nfcManager.getStatus();
      if (isMounted.current) {
        setNfcStatus(status);
      }

      if (!status.isSupported) {
        if (isMounted.current) {
          setState('error');
          setError({
            type: 'NFC_NOT_SUPPORTED',
            message: 'NFC is not supported on this device',
          });
        }
        return;
      }

      if (!status.isEnabled) {
        if (isMounted.current) {
          setState('error');
          setError({
            type: 'NFC_NOT_ENABLED',
            message: 'Please enable NFC in your device settings',
          });
        }
        return;
      }

      // Error thrown *inside* identify() (e.g. tag lost mid-identification).
      // scanWithDetection swallows a detect-callback throw and returns just
      // {tag}, so we capture the error here to map it after the session tears
      // down (the library backdoor/GET_VERSION reads want a clean teardown
      // before we touch React state).
      let identifyError: unknown = null;

      // Perform scan with detection in one session. The session is still armed
      // (technology requested / reader mode) exactly as before; identify() runs
      // on that already-connected tag — it does its own getTag() + transceive
      // and never re-requests technology, so there is no double-connect.
      const result = await nfcManager.scanWithDetection(async tagData => {
        // Update progress: tag detected
        if (isMounted.current) {
          setScanProgress({step: 'Tag detected, identifying chip...', current: 2});
        }

        // Fixture capture: honour the same toggle the old detector read, and
        // feed the library's per-exchange callback into the recorder so the
        // "Copy fixture JSON" flow still works. Off → make sure any prior
        // capture is cleared.
        const captureEnabled = await isFixtureCaptureEnabled();
        if (captureEnabled) {
          fixtureRecorder.startCapture();
        } else {
          fixtureRecorder.stopCapture();
        }

        try {
          // Run library identification while the NFC session is still active.
          const transponder = await identifyTransponder({
            onProgress: step => {
              if (isMounted.current) {
                setScanProgress({step, current: 3});
              }
            },
            onExchange: captureEnabled
              ? (cmd, resp) => fixtureRecorder.record('nfcA', cmd, resp)
              : undefined,
            // probeMagic: no dedicated UG4 setting exists in the app today, so
            // this follows the task's flagged default — run the magic sweep on
            // Android only (iOS has no backdoor support anyway).
            probeMagic: Platform.OS === 'android',
            platform: Platform.OS as 'android' | 'ios',
            // The normal scan cannot send bit-level frames (that is the SEND RAW
            // dev tool's dedicated session), so gen1a stays gated off.
            rawAvailable: false,
          });

          if (isMounted.current) {
            setScanProgress({step: 'Detection complete', current: 4});
          }

          return transponder;
        } catch (err) {
          identifyError = err;
          // Re-throw so scanWithDetection tears the session down; the swallowed
          // throw surfaces as {tag} with no detection, which we map below.
          throw err;
        }
      });

      if (!isMounted.current) {
        return;
      }

      if (result.error) {
        // Don't show error for cancellation
        if (result.error.type === 'SCAN_CANCELLED') {
          setState('idle');
        } else {
          setState('error');
          setError(result.error);

          if (canCapture) {
            sampleCollector.captureSample('scan_timeout');
          }
        }
      } else if (identifyError && result.detection === undefined) {
        // identify() threw (tag lost / unexpected). Map library errors to the
        // app's existing error states.
        setState('error');
        setError(
          isTagLoss(identifyError)
            ? {
                type: 'TAG_LOST',
                message: 'Tag was removed during scan',
                originalError: identifyError,
              }
            : {
                type: 'UNKNOWN',
                message:
                  identifyError instanceof Error
                    ? identifyError.message
                    : 'Chip identification failed',
                originalError: identifyError,
              },
        );

        if (canCapture) {
          sampleCollector.captureSample('scan_timeout');
        }
      } else if (result.tag) {
        const detectedTransponder = result.detection ?? null;
        console.log('[useScan] Scan complete:', {
          hasTag: !!result.tag,
          hasDetection: !!result.detection,
          transponderType: detectedTransponder?.type,
        });
        // Update tag and transponder atomically in a single state update
        setScanResult({
          tag: result.tag,
          transponder: detectedTransponder,
        });
        setState('success');
        // Handing off to the Result screen: keep the NFC session held so the
        // still-present tag is never released to the OS dispatcher.
        handedOffToResult.current = true;

        if (canCapture) {
          sampleCollector.captureSample('scan_success');
        }
      } else {
        setState('error');
        setError({
          type: 'UNKNOWN',
          message: 'No tag data received',
        });
      }
    } catch (err) {
      if (isMounted.current) {
        setState('error');
        setError({
          type: 'UNKNOWN',
          message: err instanceof Error ? err.message : 'An unknown error occurred',
          originalError: err,
        });
      }
    } finally {
      scanInProgress.current = false;
    }
  }, []);

  // Cancel ongoing scan
  const cancelScan = useCallback(async () => {
    await nfcManager.cancelScan();
    scanInProgress.current = false;
    if (isMounted.current) {
      setState('idle');
      setError(null);
    }
  }, []);

  // Reset state to idle
  const reset = useCallback(() => {
    setState('idle');
    setScanResult({ tag: null, transponder: undefined });
    setError(null);
    setScanProgress(null);
  }, []);

  // Open device NFC settings
  const openSettings = useCallback(async () => {
    await nfcManager.openNFCSettings();
    // Re-check status after returning from settings
    const status = await nfcManager.getStatus();
    if (isMounted.current) {
      setNfcStatus(status);
    }
  }, []);

  return {
    state,
    tag: scanResult.tag,
    transponder: scanResult.transponder,
    error,
    nfcStatus,
    scanProgress,
    startScan,
    cancelScan,
    reset,
    openSettings,
  };
}
