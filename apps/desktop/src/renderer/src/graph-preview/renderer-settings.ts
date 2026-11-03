import { resolveSettings } from 'sigma/settings';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import type { NodeData, EdgeData } from './projection';
import { drawLabel } from './labels';

/** Shared visual baseline for the live graph and isolated export renderers. */
export function graphRendererSettings() {
  return resolveSettings<NodeData, EdgeData>({
    labelFont: 'Nunito Sans Variable',
    labelSize: 11,
    labelDensity: 0.4,
    labelGridCellSize: 120,
    labelRenderedSizeThreshold: 6.5,
    stagePadding: 32,
    defaultDrawNodeLabel: drawLabel,
    edgeProgramClasses: {
      curved: createEdgeCurveProgram<NodeData, EdgeData>({
        arrowHead: {
          extremity: 'target',
          lengthToThicknessRatio: 2.5,
          widenessToThicknessRatio: 2,
        },
      }),
    },
    renderEdgeLabels: false,
    enableEdgeEvents: true,
    minCameraRatio: 0.12,
    maxCameraRatio: 3,
    zIndex: true,
  });
}
