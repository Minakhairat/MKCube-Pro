import { packRemainingManualBatchInContainer, runOptimization } from './packer';
import {
  LoadingDirection,
  LoadingSpace,
  OptimizationMode,
  PackageSpec,
  PlacedPackage,
} from '../types/packvol';

export interface WorkerRequest {
  type: 'optimize' | 'manual_batch' | 'cancel';
  jobId: string;
  payload?: {
    space: LoadingSpace;
    spaces?: LoadingSpace[];
    packages: PackageSpec[];
    mode: OptimizationMode;
    allowRotation: boolean;
    loadingDirection: LoadingDirection;
    targetUtilizationPct?: number;
    autoDetermineContainers?: boolean;
    preferKeepItemSameContainer?: boolean;
  };
  manualBatchPayload?: {
    space: LoadingSpace;
    existingInContainer: PlacedPackage[];
    containerIndex: number;
    spec: PackageSpec;
    remainingQty: number;
    preferredOrientation: { dx: number; dy: number; dz: number; label: string };
    allowGlobalRotation: boolean;
    loadingDirection: LoadingDirection;
    specsList: PackageSpec[];
    displayName: string;
    displayCategory: string;
  };
}

let cancelledJobId: string | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data;
  if (msg.type === 'cancel') {
    cancelledJobId = msg.jobId;
    return;
  }

  if (msg.type === 'manual_batch' && msg.manualBatchPayload) {
    try {
      const p = msg.manualBatchPayload;
      const specsMap = new Map<string, PackageSpec>();
      for (const s of p.specsList) specsMap.set(s.id, s);
      const placedRaw = packRemainingManualBatchInContainer(
        p.space,
        p.existingInContainer,
        p.containerIndex,
        p.spec,
        p.remainingQty,
        p.preferredOrientation,
        p.allowGlobalRotation,
        p.loadingDirection,
        specsMap
      );
      const newBoxes = placedRaw.map((b) => ({
        ...b,
        name: p.displayName,
        category: p.displayCategory,
      }));
      self.postMessage({ type: 'manual_batch_result', jobId: msg.jobId, newBoxes });
    } catch (err) {
      self.postMessage({
        type: 'error',
        jobId: msg.jobId,
        error: err instanceof Error ? err.message : 'Manual batch worker error',
      });
    }
    return;
  }

  if (msg.type === 'optimize' && msg.payload) {
    cancelledJobId = null;
    try {
      const result = runOptimization({
        ...msg.payload,
        onProgress: (pct, stage) => {
          self.postMessage({ type: 'progress', jobId: msg.jobId, pct, stage });
        },
        shouldCancel: () => cancelledJobId === msg.jobId,
      });

      if (cancelledJobId === msg.jobId) {
        self.postMessage({ type: 'cancelled', jobId: msg.jobId });
      } else {
        self.postMessage({ type: 'result', jobId: msg.jobId, result });
      }
    } catch (err) {
      self.postMessage({
        type: 'error',
        jobId: msg.jobId,
        error: err instanceof Error ? err.message : 'Optimization worker error',
      });
    }
  }
};
