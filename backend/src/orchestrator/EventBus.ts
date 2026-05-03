/**
 * Event Bus - Simple pub/sub system for agent communication
 */

import { EventEmitter } from 'events';
import { AgentEvent, EventHandler, AgentType } from '../types';
import { saveEvents, loadEvents } from '../services/StatePersistence';
import logger from '../utils/logger';

class EventBus extends EventEmitter {
  private static instance: EventBus;
  private decisionLog: AgentEvent[] = [];
  private readonly maxLogSize: number = 1000;
  private saveTimer: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.setMaxListeners(50);

    // Restore persisted events
    const persisted = loadEvents();
    if (persisted && Array.isArray(persisted.events)) {
      this.decisionLog = persisted.events as AgentEvent[];
      logger.info('Restored EventBus log from disk', {
        events: this.decisionLog.length,
        savedAt: new Date(persisted.savedAt).toISOString(),
      });
    }
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  /**
   * Publish an event
   */
  publish(event: AgentEvent): void {
    // Log the event
    this.decisionLog.push(event);
    if (this.decisionLog.length > this.maxLogSize) {
      this.decisionLog.shift();
    }

    // Emit to listeners
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard listener

    // Throttled persist (max once per 10s to avoid disk thrashing)
    if (!this.saveTimer) {
      this.saveTimer = setTimeout(() => {
        saveEvents(this.decisionLog);
        this.saveTimer = null;
      }, 10_000);
    }

    logger.debug(`Event published: ${event.type} from ${event.source}`);
  }

  /**
   * Subscribe to an event type
   */
  subscribe(eventType: string, handler: EventHandler): () => void {
    this.on(eventType, handler);
    
    // Return unsubscribe function
    return () => {
      this.off(eventType, handler);
    };
  }

  /**
   * Subscribe to all events
   */
  subscribeAll(handler: EventHandler): () => void {
    this.on('*', handler);
    
    return () => {
      this.off('*', handler);
    };
  }

  /**
   * Publish with automatic timestamp and source
   */
  emitEvent(
    type: string,
    source: AgentType,
    payload: Record<string, unknown>
  ): void {
    const event: AgentEvent = {
      type,
      source,
      payload,
      timestamp: Date.now(),
    };

    this.publish(event);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit: number = 50, source?: AgentType): AgentEvent[] {
    let events = [...this.decisionLog];
    
    if (source) {
      events = events.filter(e => e.source === source);
    }
    
    return events.slice(-limit).reverse();
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType: string, limit: number = 50): AgentEvent[] {
    return this.decisionLog
      .filter(e => e.type === eventType)
      .slice(-limit)
      .reverse();
  }

  /**
   * Clear event log
   */
  clearLog(): void {
    this.decisionLog = [];
    logger.info('Event log cleared');
  }

  /**
   * Wait for an event with timeout
   */
  waitForEvent(
    eventType: string,
    timeoutMs: number = 30000,
    filter?: (event: AgentEvent) => boolean
  ): Promise<AgentEvent> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off(eventType, handler);
        reject(new Error(`Timeout waiting for event: ${eventType}`));
      }, timeoutMs);

      const handler = (event: AgentEvent) => {
        if (!filter || filter(event)) {
          clearTimeout(timer);
          this.off(eventType, handler);
          resolve(event);
        }
      };

      this.on(eventType, handler);
    });
  }
}

export default EventBus.getInstance();
