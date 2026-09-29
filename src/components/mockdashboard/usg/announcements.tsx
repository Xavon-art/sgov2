"use client";

import { useState } from "react";
import type { MockState } from "@/lib/mockdashboard/db";
import { stamp } from "@/lib/mockdashboard/format";
import { Card } from "@/components/mockdashboard/card";
import { Button } from "@/components/mockdashboard/button";
import { Field, inputCls } from "@/components/mockdashboard/field";

type Actions = {
  announce: (input: { title: string; body: string }) => void;
  togglePin: (id: string) => void;
};

export function Announcements({ state, actions }: { state: MockState; actions: Actions }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const feed = [...state.announcements].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.at.localeCompare(a.at));

  return (
    <div className="space-y-5">
      <Card title="Post an announcement" subtitle="Reaches all councils on the LSG dashboard">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim()) return;
            actions.announce({ title: title.trim(), body: body.trim() });
            setTitle("");
            setBody("");
          }}
        >
          <Field label="Headline">
            <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Midterms break notice" required />
          </Field>
          <Field label="Message">
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} className={inputCls} placeholder="Details councils should know…" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit">Post announcement</Button>
          </div>
        </form>
      </Card>

      <Card title="Announcement feed" subtitle={`${feed.length} posts`}>
        {feed.length === 0 ? (
          <p className="text-sm text-slate-400">No announcements yet.</p>
        ) : (
          <ul className="space-y-4">
            {feed.map((a) => (
              <li key={a.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {a.pinned && <span className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Pinned</span>}
                      {a.title}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">{a.body}</p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {a.by} · {stamp(a.at)}
                    </p>
                  </div>
                  <Button variant="ghost" onClick={() => actions.togglePin(a.id)} className="shrink-0">
                    {a.pinned ? "Unpin" : "Pin"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}