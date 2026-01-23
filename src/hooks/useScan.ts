/**
 * useScan Hook
 * React hook for managing NFC scan state and operations
 */

import {useState, useCallback, useEffect, useRef} from 'react';
import {nfcManager} from '../services/nfc';
import {detectChip} from '../services/detection';
import type {ScanState, RawTagData, ScanError, NFCStatus} from '../types/nfc';
import type {Transponder} from '../types/detection';

export interface UseScanResult {
  /** Current scan state */
  state: ScanState;
  /** Scanned tag data (when state is 'success') */
  tag: RawTagData | null;
  /** Detected transponder info (when detection succeeds) */
  transponder: Transponder | null;
  /** Scan error (when state is 'error') */
  error: ScanError | null;
  /** NFC status (supported and enabled) */
  nfcStatus: NFCStatus;
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
export function useScan(): UseScanResult {
  const [state, setState] = useState<ScanState>('idle');
  const [tag, setTag] = useState<RawTagData | null>(null);
  const [transponder, setTransponder] = useState<Transponder | null>(null);
  const [error, setError] = useState<ScanError | null>(null);
  const [nfcStatus, setNfcStatus] = useState<NFCStatus>({
    isSupported: false,
    isEnabled: false,
  });

  // Track if component is mounted to prevent state updates after unmount
  const isMounted = useRef(true);

  // Track if a scan is in progress
  const scanInProgress = useRef(false);

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
      // Cleanup on unmount
      nfcManager.cancelScan();
    };
  }, []);

  // Start scanning for a tag
  const startScan = useCallback(async () => {
    // Prevent multiple concurrent scans
    if (scanInProgress.current) {
      return;
    }

    scanInProgress.current = true;
    setState('scanning');
    setTag(null);
    setTransponder(null);
    setError(null);

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

      // Perform scan with detection in one session
      const result = await nfcManager.scanWithDetection(async tagData => {
        // Run chip detection while NFC session is still active
        const detectionResult = await detectChip(tagData);
        return detectionResult.success ? detectionResult.transponder : null;
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
        }
      } else if (result.tag) {
        setState('success');
        setTag(result.tag);
        if (result.detection) {
          setTransponder(result.detection);
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
    setTag(null);
    setTransponder(null);
    setError(null);
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
    tag,
    transponder,
    error,
    nfcStatus,
    startScan,
    cancelScan,
    reset,
    openSettings,
  };
}
