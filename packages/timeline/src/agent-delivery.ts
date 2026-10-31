import type { AgentPin, AgentPlatform, AgentDistribution } from './agent-definition.ts';
import type { BundledSessionRuntime } from './builtin-session.ts';
import type { Emit, ProjectionContext } from './projection.ts';
import type { Projector } from './replay.ts';

/** Installed independently, pinned by the existing public release manifest v1. */
export interface ManagedNpmDelivery {
  kind: 'managed-npm';
  pin: AgentPin;
  downloadSize: number;
  distribution(platform: AgentPlatform, pin: AgentPin): AgentDistribution;
}

/** Part of the application payload; never an npm installer/update component. */
export interface BundledDelivery {
  kind: 'bundled';
  runtimePackage: string;
  /** Runtime semver is supplied by its real package once implemented, not a CLI pin. */
  versioning: 'with-skaro';
  contracts: { host: number; events: number; journal: number; projector: number };
}

export type AgentDelivery = ManagedNpmDelivery | BundledDelivery;

/** Reserves identity/delivery without advertising a runnable adapter or invented UI. */
interface BundledRegistrationBase {
  id: string;
  delivery: BundledDelivery;
}

export interface ReservedBundledRegistration extends BundledRegistrationBase {
  stage: 'contract-only';
  unavailableReason: 'runtime-not-implemented';
}

export interface BundledRuntimeRegistration extends BundledRegistrationBase {
  stage: 'runtime-core';
  unavailableReason: 'model-host-not-connected';
  package: { name: string; version: string; dependencies: Record<string, string> };
  adapterVersion: string;
  loadSessionRuntime(): Promise<BundledSessionRuntime>;
  loadProjector(): Promise<
    (context: ProjectionContext, emit: Emit, adapterVersion?: string) => Projector
  >;
}

export type BundledAgentRegistration = ReservedBundledRegistration | BundledRuntimeRegistration;

/** Runtime availability and route configuration are independent admission requirements. */
export interface BuiltinAgentReadiness {
  runtime: { state: 'unavailable'; reason: string } | { state: 'available'; version: string };
  connection:
    | { state: 'not-configured' }
    | { state: 'unavailable'; connectionId: string; reason: string }
    | { state: 'configured'; connectionId: string; routeId: string; revision: number };
}

export function builtinAgentReady(readiness: BuiltinAgentReadiness): boolean {
  return readiness.runtime.state === 'available' && readiness.connection.state === 'configured';
}
