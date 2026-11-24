"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Subscribes to the tiny signal rows written by the database triggers.
 *
 * The row carries only an account UUID and a kind -- never a message body or a
 * notification title. When one arrives, the caller reloads through its normal
 * authenticated API, so a client cannot use this channel to read data that is
 * not addressed to it.
 */
export function useRealtimeSignals(
  accountId: string | null,
  kinds: string[],
  onChange: () => void,
) {
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const kindsRef = useRef(kinds);
  kindsRef.current = kinds;

  useEffect(() => {
    const client = supabase;
    if (!accountId || !client) return;

    const channel = client
      .channel(`sgov-signals-${accountId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "realtime_events",
          filter: `channel=eq.${accountId}`,
        },
        (payload) => {
          const kind = (payload.new as { kind?: string } | null)?.kind;
          if (!kind || kindsRef.current.includes(kind)) changeRef.current();
        },
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [accountId]);
}
