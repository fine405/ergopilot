import { afterEach, describe, expect, it, vi } from "vitest";

import { HonoControlPlane } from "./control-plane";

afterEach(() => vi.unstubAllGlobals());

describe("HonoControlPlane", () => {
  it("keeps realtime observations optional when EventSource is unavailable", () => {
    vi.stubGlobal("EventSource", undefined);
    const onObservation = vi.fn();
    const onError = vi.fn();

    const unsubscribe = new HonoControlPlane(
      "http://localhost:8787",
    ).subscribeTaskRun("run-1", onObservation, onError);

    expect(onObservation).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(unsubscribe()).toBeUndefined();
  });

  it("falls back without throwing when a realtime observation is malformed", () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    const onObservation = vi.fn();
    const onError = vi.fn();
    const unsubscribe = new HonoControlPlane(
      "http://localhost:8787/",
    ).subscribeTaskRun("run/1", onObservation, onError);
    const source = FakeEventSource.latest;

    source.emit("observation", new MessageEvent("observation", { data: "{" }));

    expect(source.url).toBe(
      "http://localhost:8787/api/task-runs/run%2F1/stream",
    );
    expect(onObservation).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(source.closed).toBe(false);

    unsubscribe();
    expect(source.closed).toBe(true);
  });
});

class FakeEventSource {
  static latest: FakeEventSource;
  readonly #listeners = new Map<string, EventListener>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.#listeners.set(type, listener);
  }

  emit(type: string, event: Event) {
    this.#listeners.get(type)?.(event);
  }

  close() {
    this.closed = true;
  }
}
