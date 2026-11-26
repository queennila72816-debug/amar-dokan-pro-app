import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  RefreshCw,
  SwitchCamera,
  AlertTriangle,
  CheckCircle2,
  Keyboard,
  ShieldAlert,
} from 'lucide-react';

export type CameraScannerStatus =
  | 'idle'
  | 'requesting_permission'
  | 'scanning'
  | 'permission_denied'
  | 'unsupported'
  | 'error';

interface CameraBarcodeScannerProps {
  active?: boolean;
  autoStart?: boolean;
  cooldownMs?: number;
  onScan: (code: string) => void;
  onStatusChange?: (status: CameraScannerStatus) => void;
  showManualFallback?: boolean;
  compact?: boolean;
}

const SUPPORTED_ZXING_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.ITF,
  BarcodeFormat.QR_CODE,
];

export const CameraBarcodeScanner: React.FC<CameraBarcodeScannerProps> = ({
  active = true,
  autoStart = true,
  cooldownMs = 1500,
  onScan,
  onStatusChange,
  showManualFallback = true,
  compact = false,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastScanRef = useRef<{ code: string; time: number }>({ code: '', time: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [status, setStatus] = useState<CameraScannerStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [torchSupported, setTorchSupported] = useState<boolean>(false);
  const [torchEnabled, setTorchEnabled] = useState<boolean>(false);
  const [lastDetectedFlash, setLastDetectedFlash] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState<string>('');

  const updateStatus = useCallback(
    (next: CameraScannerStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  const stopCameraStream = useCallback(() => {
    try {
      controlsRef.current?.stop();
    } catch {
      // ignore stop errors
    }
    controlsRef.current = null;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        try {
          track.stop();
        } catch {
          // ignore
        }
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      const currentStream = videoRef.current.srcObject as MediaStream | null;
      if (currentStream) {
        currentStream.getTracks().forEach(t => {
          try {
            t.stop();
          } catch {}
        });
      }
      videoRef.current.srcObject = null;
    }

    setTorchSupported(false);
    setTorchEnabled(false);
  }, []);

  const inspectTorchCapability = useCallback(() => {
    const videoEl = videoRef.current;
    const activeStream = (videoEl?.srcObject as MediaStream | null) || streamRef.current;
    if (!activeStream) {
      setTorchSupported(false);
      return;
    }
    streamRef.current = activeStream;
    const videoTrack = activeStream.getVideoTracks()[0];
    if (!videoTrack || typeof videoTrack.getCapabilities !== 'function') {
      setTorchSupported(false);
      return;
    }
    try {
      const caps = videoTrack.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
      setTorchSupported(Boolean(caps && 'torch' in caps && caps.torch));
    } catch {
      setTorchSupported(false);
    }
  }, []);

  const toggleTorch = useCallback(async () => {
    const videoEl = videoRef.current;
    const activeStream = (videoEl?.srcObject as MediaStream | null) || streamRef.current;
    const videoTrack = activeStream?.getVideoTracks()[0];
    if (!videoTrack || !torchSupported) return;
    const nextState = !torchEnabled;
    try {
      await videoTrack.applyConstraints({
        advanced: [{ torch: nextState } as MediaTrackConstraintSet],
      });
      setTorchEnabled(nextState);
    } catch {
      setTorchSupported(false);
      setTorchEnabled(false);
    }
  }, [torchEnabled, torchSupported]);

  const startScanner = useCallback(
    async (explicitDeviceId?: string) => {
      if (!active) return;

      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        updateStatus('unsupported');
        setErrorMessage(
          'Camera access is unavailable in this browser or non-HTTPS context. Use USB/Manual barcode entry below.'
        );
        return;
      }

      stopCameraStream();
      setErrorMessage('');
      updateStatus('requesting_permission');

      try {
        // Request video permission cleanly (prefer environment/rear camera on mobile)
        const testStream = await navigator.mediaDevices.getUserMedia({
          video: explicitDeviceId
            ? { deviceId: { exact: explicitDeviceId } }
            : { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        testStream.getTracks().forEach(t => t.stop());
        // Allow hardware driver a short settle pause before opening decode stream (prevents NotReadableError on Edge/Android)
        await new Promise(resolve => window.setTimeout(resolve, 80));

        const videoInputs = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(videoInputs);

        if (videoInputs.length === 0) {
          updateStatus('error');
          setErrorMessage('No camera hardware detected on this device.');
          return;
        }

        let targetDeviceId = explicitDeviceId || selectedDeviceId;
        if (!targetDeviceId || !videoInputs.some(d => d.deviceId === targetDeviceId)) {
          const backCam = videoInputs.find(d =>
            /back|rear|environment|wide/i.test(d.label || '')
          );
          targetDeviceId = backCam?.deviceId || videoInputs[0].deviceId;
          setSelectedDeviceId(targetDeviceId);
        }

        if (!videoRef.current) return;

        const hints = new Map();
        hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_ZXING_FORMATS);
        hints.set(DecodeHintType.TRY_HARDER, true);

        const reader = new BrowserMultiFormatReader(hints, {
          delayBetweenScanAttempts: 120,
          delayBetweenScanSuccess: 300,
        });

        const handleDecoded = (result: { getText: () => string } | undefined) => {
          if (!result) return;
          const code = result.getText().trim();
          if (!code) return;

          const now = Date.now();
          if (
            lastScanRef.current.code === code &&
            now - lastScanRef.current.time < cooldownMs
          ) {
            return;
          }
          lastScanRef.current = { code, time: now };
          setLastDetectedFlash(code);
          window.setTimeout(() => {
            setLastDetectedFlash(prev => (prev === code ? null : prev));
          }, 1400);

          onScanRef.current(code);
        };

        let controls: IScannerControls;
        try {
          controls = await reader.decodeFromVideoDevice(
            targetDeviceId,
            videoRef.current,
            result => handleDecoded(result)
          );
        } catch (deviceErr: any) {
          const errName = String(deviceErr?.name || '');
          if (
            !explicitDeviceId &&
            (errName === 'OverconstrainedError' || errName === 'NotFoundError')
          ) {
            controls = await reader.decodeFromConstraints(
              { video: { facingMode: { ideal: 'environment' } }, audio: false },
              videoRef.current,
              result => handleDecoded(result)
            );
          } else {
            throw deviceErr;
          }
        }

        controlsRef.current = controls;
        updateStatus('scanning');
        window.setTimeout(inspectTorchCapability, 350);
      } catch (err: any) {
        stopCameraStream();
        const errName = String(err?.name || '');
        const msg = String(err?.message || '');
        if (
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          /permission|denied/i.test(msg)
        ) {
          updateStatus('permission_denied');
          setErrorMessage(
            'Camera permission was denied. Allow camera access in your browser site settings and tap Retry, or enter barcode manually.'
          );
        } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
          updateStatus('error');
          setErrorMessage('No camera device found on this device.');
        } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
          updateStatus('error');
          setErrorMessage('Camera is currently in use by another app or tab.');
        } else {
          updateStatus('error');
          setErrorMessage(msg || 'Unable to initialize camera scanner.');
        }
      }
    },
    [active, cooldownMs, inspectTorchCapability, selectedDeviceId, stopCameraStream, updateStatus]
  );

  useEffect(() => {
    if (active && autoStart) {
      startScanner();
    } else if (!active) {
      stopCameraStream();
      updateStatus('idle');
    }

    const handlePageHide = () => stopCameraStream();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopCameraStream();
        updateStatus('idle');
      }
    };

    window.addEventListener('pagehide', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      stopCameraStream();
    };
  }, [active, autoStart]);

  const handleSwitchCamera = () => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex(d => d.deviceId === selectedDeviceId);
    const nextDevice = devices[(currentIndex + 1) % devices.length];
    if (nextDevice) {
      setSelectedDeviceId(nextDevice.deviceId);
      startScanner(nextDevice.deviceId);
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = manualCode.trim();
    if (!trimmed) return;
    onScanRef.current(trimmed);
    setManualCode('');
  };

  return (
    <div className="space-y-3">
      {/* Camera Viewport */}
      <div
        className={`relative w-full overflow-hidden rounded-xl border border-slate-300 dark:border-[#1F3158] bg-slate-950 ${
          compact ? 'aspect-[4/3] max-h-[260px]' : 'aspect-[4/3] sm:aspect-[16/10] max-h-[360px]'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={`w-full h-full object-cover ${status === 'scanning' ? 'opacity-100' : 'opacity-25'}`}
        />

        {/* Crisp Corner-Bracket Targeting Frame (when scanning) */}
        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="relative w-full max-w-[270px] aspect-[1.5/1] rounded-lg border border-white/25 shadow-[0_0_0_9999px_rgba(10,18,44,0.42)]">
              <span className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-[3px] border-l-[3px] border-[#FF9D32] rounded-tl-md" />
              <span className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-[3px] border-r-[3px] border-[#FF9D32] rounded-tr-md" />
              <span className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-[3px] border-l-[3px] border-[#FF9D32] rounded-bl-md" />
              <span className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-[3px] border-r-[3px] border-[#FF9D32] rounded-br-md" />
              <div className="absolute inset-x-3 top-1/2 h-[1.5px] bg-[#FF9D32]/75" />
            </div>
          </div>
        )}

        {/* Top Controls Overlay */}
        <div className="absolute top-2.5 inset-x-2.5 flex items-center justify-between gap-2">
          <div className="px-2.5 py-1 rounded-lg bg-slate-950/75 text-white text-[11px] font-semibold flex items-center gap-1.5 backdrop-blur-xs">
            <Camera className="w-3.5 h-3.5 text-[#FF9D32]" />
            <span>
              {status === 'scanning'
                ? 'Point camera at Barcode or QR'
                : status === 'requesting_permission'
                ? 'Requesting camera access...'
                : 'Camera Inactive'}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {torchSupported && status === 'scanning' && (
              <button
                type="button"
                onClick={toggleTorch}
                title={torchEnabled ? 'Turn Flashlight Off' : 'Turn Flashlight On'}
                className={`p-2 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                  torchEnabled
                    ? 'bg-[#FF9D32] text-[#101B3F] border-[#FF9D32]'
                    : 'bg-slate-950/75 text-white border-white/20 hover:bg-slate-900'
                }`}
              >
                {torchEnabled ? <Flashlight className="w-4 h-4" /> : <FlashlightOff className="w-4 h-4" />}
              </button>
            )}

            {devices.length > 1 && status === 'scanning' && (
              <button
                type="button"
                onClick={handleSwitchCamera}
                title="Switch Camera"
                className="p-2 rounded-lg bg-slate-950/75 hover:bg-slate-900 text-white border border-white/20 transition-colors cursor-pointer"
              >
                <SwitchCamera className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Last Scan Detected Banner */}
        {lastDetectedFlash && (
          <div className="absolute bottom-3 inset-x-3 flex justify-center pointer-events-none">
            <div className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-mono font-bold shadow-lg flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate max-w-[240px]">Scanned: {lastDetectedFlash}</span>
            </div>
          </div>
        )}

        {/* Idle / Permission / Error States */}
        {status !== 'scanning' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-5 text-center text-white bg-slate-950/80">
            {status === 'requesting_permission' && (
              <>
                <RefreshCw className="w-8 h-8 text-[#FF9D32] animate-spin mb-2" />
                <p className="text-sm font-bold">Opening Camera...</p>
                <p className="text-xs text-slate-300 mt-1 max-w-xs">
                  Please allow camera permission if your browser prompts you.
                </p>
              </>
            )}

            {status === 'idle' && (
              <>
                <Camera className="w-9 h-9 text-[#FF9D32] mb-2" />
                <p className="text-sm font-bold">Camera Scanner Ready</p>
                <p className="text-xs text-slate-300 mt-1 max-w-xs">
                  Supports EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, ITF, and QR codes.
                </p>
                <button
                  type="button"
                  onClick={() => startScanner()}
                  className="mt-3 px-4 py-2 rounded-[10px] bg-[#087F8C] hover:bg-[#066974] text-white text-xs font-bold cursor-pointer flex items-center gap-1.5"
                >
                  <Camera className="w-4 h-4" />
                  <span>Start Camera Scan</span>
                </button>
              </>
            )}

            {(status === 'permission_denied' || status === 'unsupported' || status === 'error') && (
              <>
                {status === 'permission_denied' ? (
                  <ShieldAlert className="w-9 h-9 text-amber-400 mb-2" />
                ) : status === 'unsupported' ? (
                  <CameraOff className="w-9 h-9 text-slate-400 mb-2" />
                ) : (
                  <AlertTriangle className="w-9 h-9 text-rose-400 mb-2" />
                )}
                <p className="text-sm font-bold">
                  {status === 'permission_denied'
                    ? 'Camera Permission Required'
                    : status === 'unsupported'
                    ? 'Camera Unavailable'
                    : 'Camera Error'}
                </p>
                <p className="text-xs text-slate-300 mt-1 max-w-sm">{errorMessage}</p>
                {status !== 'unsupported' && (
                  <button
                    type="button"
                    onClick={() => startScanner()}
                    className="mt-3 px-4 py-2 rounded-[10px] bg-[#FF9D32] text-[#101B3F] text-xs font-bold cursor-pointer flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry Camera</span>
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Camera Switch / Start-Stop Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {devices.length > 1 && (
            <select
              aria-label="Select camera device"
              value={selectedDeviceId}
              onChange={e => {
                setSelectedDeviceId(e.target.value);
                startScanner(e.target.value);
              }}
              className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0E182E] text-slate-700 dark:text-slate-200 text-xs max-w-[210px] truncate"
            >
              {devices.map((d, idx) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label || `Camera ${idx + 1}`}
                </option>
              ))}
            </select>
          )}
          <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
            1D Barcodes + QR Code
          </span>
        </div>

        <div className="flex items-center gap-2">
          {status === 'scanning' ? (
            <button
              type="button"
              onClick={() => {
                stopCameraStream();
                updateStatus('idle');
              }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-[#1F3158] bg-slate-100 dark:bg-[#162344] text-slate-700 dark:text-slate-200 font-semibold text-xs hover:bg-slate-200 cursor-pointer flex items-center gap-1.5"
            >
              <CameraOff className="w-3.5 h-3.5" />
              <span>Stop Camera</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startScanner()}
              className="px-3 py-1.5 rounded-lg bg-[#087F8C] hover:bg-[#066974] text-white font-semibold text-xs cursor-pointer flex items-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5" />
              <span>Start Camera</span>
            </button>
          )}
        </div>
      </div>

      {/* Manual Code Entry Fallback */}
      {showManualFallback && (
        <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
          <div className="relative flex-1">
            <Keyboard className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
            <input
              type="text"
              value={manualCode}
              onChange={e => setManualCode(e.target.value)}
              placeholder="Or type barcode / SKU / QR code manually..."
              className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-[#1F3158] bg-white dark:bg-[#0E182E] text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#087F8C]/25 focus:border-[#087F8C]"
            />
          </div>
          <button
            type="submit"
            className="px-3.5 py-2 rounded-lg bg-[#101B3F] hover:bg-[#1C2E63] text-white text-xs font-bold cursor-pointer shrink-0"
          >
            Lookup
          </button>
        </form>
      )}
    </div>
  );
};
