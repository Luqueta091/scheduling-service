export type EventHandler<T = unknown> = (payload: T) => Promise<void> | void;

export interface IEventBus {
  publish<T = unknown>(eventName: string, payload: T): Promise<void>;
  subscribe?<T = unknown>(
    eventName: string,
    handler: EventHandler<T>
  ): Promise<() => void> | (() => void);
  clearAllSubscribers?(): void;
}
