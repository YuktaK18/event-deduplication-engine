import { useCallback, useEffect, useRef, useState } from 'react';
import { SimulationConfig, SimState, ComparisonResult, SimPhase } from '@/sim/types';
import { createInitialState, stepSimulation, runFullSimulation, computeOutcomes } from '@/sim/simulationEngine';
import { DEFAULT_CONFIG } from '@/sim/presets';

const SPEED_DELAYS: Record<string, number> = {
  slow: 600,
  normal: 250,
  fast: 60,
};

export function useSimulation() {
  const [config, setConfig] = useState<SimulationConfig>(DEFAULT_CONFIG);
  const [state, setState] = useState<SimState>(() => createInitialState(DEFAULT_CONFIG));
  const [phase, setPhase] = useState<SimPhase>('idle');
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(state);
  const phaseRef = useRef(phase);

  stateRef.current = state;
  phaseRef.current = phase;

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => {
    return () => clearTimer();
  }, []);

  const tick = useCallback(() => {
    const current = stateRef.current;
    const result = stepSimulation(current);
    if (result.done) {
      const finalState = {
        ...result.state,
        outcomes: computeOutcomes(result.state.deliveries),
        phase: 'completed' as const,
      };
      setState(finalState);
      setPhase('completed');
      clearTimer();
    } else {
      const newState = {
        ...result.state,
        outcomes: computeOutcomes(result.state.deliveries),
        phase: 'running' as const,
      };
      setState(newState);
      timerRef.current = setTimeout(tick, SPEED_DELAYS[current.config.speed]);
    }
  }, []);

  const run = useCallback((cfg?: SimulationConfig) => {
    clearTimer();
    const effectiveConfig = cfg ?? config;
    const initial = createInitialState(effectiveConfig);
    initial.phase = 'running';
    initial.componentStatuses = {
      producer: 'Active',
      queue: 'Active',
      dedup: effectiveConfig.deduplicationEnabled ? 'Active' : 'Idle',
      registry: effectiveConfig.deduplicationEnabled ? 'Active' : 'Idle',
      effect: 'Idle',
    };
    setState(initial);
    setPhase('running');
    if (cfg) setConfig(cfg);
    timerRef.current = setTimeout(tick, SPEED_DELAYS[effectiveConfig.speed]);
  }, [config, tick]);

  const pause = useCallback(() => {
    clearTimer();
    setPhase('paused');
    setState((s) => ({ ...s, phase: 'paused' }));
  }, []);

  const resume = useCallback(() => {
    if (phaseRef.current !== 'paused') return;
    setPhase('running');
    setState((s) => ({ ...s, phase: 'running' }));
    timerRef.current = setTimeout(tick, SPEED_DELAYS[stateRef.current.config.speed]);
  }, [tick]);

  const reset = useCallback(() => {
    clearTimer();
    const initial = createInitialState(config);
    setState(initial);
    setPhase('idle');
    setComparison(null);
  }, [config]);

  const updateConfig = useCallback((partial: Partial<SimulationConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }));
  }, []);

  const loadConfig = useCallback((cfg: SimulationConfig) => {
    clearTimer();
    setConfig(cfg);
    const initial = createInitialState(cfg);
    setState(initial);
    setPhase('idle');
    setComparison(null);
  }, []);

  const compareResults = useCallback(() => {
    const configWithout: SimulationConfig = { ...config, deduplicationEnabled: false };
    const configWith: SimulationConfig = { ...config, deduplicationEnabled: true };

    const resultWithout = runFullSimulation(configWithout);
    const resultWith = runFullSimulation(configWith);

    const comp: ComparisonResult = {
      configWithout,
      configWith,
      metricsWithout: resultWithout.metrics,
      metricsWith: resultWith.metrics,
      eventsGenerated: config.totalEvents,
      duplicateDeliveries: resultWithout.metrics.totalDeliveryAttempts - config.totalEvents,
    };
    setComparison(comp);
  }, [config]);

  return {
    config,
    state,
    phase,
    comparison,
    run,
    pause,
    resume,
    reset,
    updateConfig,
    loadConfig,
    compareResults,
  };
}
