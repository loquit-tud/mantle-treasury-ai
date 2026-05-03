/**
 * RiskAgent - Compliance & risk oversight agent
 * Participates in Board Meetings as the third voice — focused on
 * systemic risk, regulatory compliance, and portfolio protection.
 * Does NOT execute transactions — advisory only.
 */

import EventBus from '../orchestrator/EventBus';
import logger from '../utils/logger';
import type { AgentStatus, AgentConfig } from '../types';

export class RiskAgent {
  private status: AgentStatus = 'idle';

  constructor(_config: AgentConfig) {
    logger.info('RiskAgent initialized (advisory mode)');
  }

  getStatus(): AgentStatus {
    return this.status;
  }

  start(): void {
    this.status = 'active';
    EventBus.emitEvent('agent:status', 'risk', {
      action: 'status_change',
      reasoning: 'Risk & Compliance Agent online — monitoring systemic risk',
      data: { status: 'active' },
      status: 'executed',
    });
    logger.info('RiskAgent started');
  }

  stop(): void {
    this.status = 'idle';
    logger.info('RiskAgent stopped');
  }
}

export default RiskAgent;
