"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

/**
 * Subscribes to the tiny broadcast signals written by the database triggers.
 *
 * The payload carries only an account UUID and a kind -- never a message body or
 * a notification title. When one arrives, the caller reloads through its normal
 * authenticated API, so a client cannot use this channel to read data that is
 * not addressed to it.
 */
const SIGNAL_KINDS = ["message", "notification", "structure"] as const;

type Listener = {
  kindsRef: { current: string[] };
  changeRef: { current: () => void };
};

type SharedChannel = {
  channel: RealtimeChannel;
  listeners: Set<Listener>;
};

/**
 * Supabase reuses channels by topic: two mounted panels calling `.on()` on the
 * same channel after `subscribe()` throws and tears down the page. One shared
 * channel per account, with every event bound before subscribing, keeps the
 * exported hook usable from any number of panels.
 */
const sharedChannels = new Map<string, SharedChannel>();

export function useRealtimeSignals(
  accountId: string | null,
  kinds: string[],
  onChange: () => void,
) {
  const changeRef = useRef(onChange);
  const kindsRef = useRef(kinds);

  // Keep the latest callback and filter available to every broadcast listener
  // without writing refs during render.
  useEffect(() => {
    changeRef.current = onChange;
    kindsRef.current = kinds;
  });

  useEffect(() => {
    const client = supabase;
    if (!accountId || !client) return;

    const topic = `sgov-signals-${accountId}`;
    let shared = sharedChannels.get(topic);

    if (!shared) {
      const channel = client.channel(topic, { config: { private: false } });
      const listeners = new Set<Listener>();

      for (const kind of SIGNAL_KINDS) {
        channel.on("broadcast", { event: kind }, (payload) => {
          const signalKind =
            (payload.payload as { kind?: string } | null)?.kind ?? payload.event;
          if (!signalKind) return;
          for (const listener of listeners) {
            if (listener.kindsRef.current.includes(signalKind)) {
              listener.changeRef.current();
            }
          }
        });
      }

      channel.subscribe();
      shared = { channel, listeners };
      sharedChannels.set(topic, shared);
    }

    const listener: Listener = { kindsRef, changeRef };
    shared.listeners.add(listener);

    return () => {
      shared.listeners.delete(listener);
      if (shared.listeners.size === 0) {
        sharedChannels.delete(topic);
        void client.removeChannel(shared.channel);
      }
    };
  }, [accountId]);
}
