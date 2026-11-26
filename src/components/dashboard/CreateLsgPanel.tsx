"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import { IconCheck } from "@/components/ui/Icons";
import { selectClass } from "./workspace-shared";
import type { PlaceOption } from "@/app/api/locations/route";

/**
 * Create the local government unit first, then invite the officer who runs it.
 *
 * Splitting the two writes is deliberate: an LSG can exist before its mailbox is
 * known, and the umbrella should show the campus even while the officer is still
 * being tracked down. The location is chosen from PSGC codes through
 * `/api/locations`, so a department filed under "City of Cebu" is the same place
 * for every owner instead of a free-text guess.
 */
type CreatedLsg = {
  id: string;
  name: string;
  unitType: string;
  address: string;
  email: string;
  sending: boolean;
  invited: boolean;
  error: string;
};

const UNIT_OPTIONS = [
  { value: "campus", label: "Campus" },
  { value: "college", label: "College" },
  { value: "department", label: "Department" },
] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function loadPlaces(
  level: "regions" | "provinces" | "cities" | "barangays",
  params: Record<string, string>,
): Promise<PlaceOption[]> {
  const query = new URLSearchParams({ level, ...params });
  const res = await fetch(`/api/locations?${query.toString()}`);
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    places?: PlaceOption[];
    message?: string;
  };
  if (!res.ok || !data.ok) throw new Error(data.message ?? "We could not load locations.");
  return data.places ?? [];
}

function nameOf(places: PlaceOption[], code: string): string {
  return places.find((place) => place.code === code)?.name ?? "";
}

export function CreateLsgPanel({
  onCreated,
  onInvited,
}: {
  onCreated?: () => void;
  onInvited?: () => void;
}) {
  const [regions, setRegions] = useState<PlaceOption[]>([]);
  const [provinces, setProvinces] = useState<PlaceOption[]>([]);
  const [cities, setCities] = useState<PlaceOption[]>([]);
  const [barangays, setBarangays] = useState<PlaceOption[]>([]);

  const [region, setRegion] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [barangay, setBarangay] = useState("");

  const [name, setName] = useState("");
  const [unitType, setUnitType] = useState<string>("campus");
  const [created, setCreated] = useState<CreatedLsg[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void loadPlaces("regions", {})
      .then((rows) => {
        if (!cancelled) setRegions(rows);
      })
      .catch(() => {
        if (!cancelled) setError("We could not load Philippine regions. Try again.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      setProvinces([]);
      setCities([]);
      setBarangays([]);
      setProvince("");
      setCity("");
      setBarangay("");
    });
    if (!region) return;

    void (async () => {
      try {
        const rows = await loadPlaces("provinces", { region });
        if (cancelled) return;
        setProvinces(rows);
        // NCR and other province-less regions keep their cities at region level.
        if (rows.length === 0) {
          const directCities = await loadPlaces("cities", { region });
          if (!cancelled) setCities(directCities);
        }
      } catch {
        if (!cancelled) setError("We could not load provinces for that region.");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [region]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      setCities([]);
      setBarangays([]);
      setCity("");
      setBarangay("");
    });
    if (!province) return;

    void loadPlaces("cities", { province })
      .then((rows) => {
        if (!cancelled) setCities(rows);
      })
      .catch(() => {
        if (!cancelled) setError("We could not load cities for that province.");
      });

    return () => {
      cancelled = true;
    };
  }, [province]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      setBarangays([]);
      setBarangay("");
    });
    if (!city) return;

    void loadPlaces("barangays", { city })
      .then((rows) => {
        if (!cancelled) setBarangays(rows);
      })
      .catch(() => {
        if (!cancelled) setError("We could not load barangays for that city.");
      });

    return () => {
      cancelled = true;
    };
  }, [city]);

  const address = [
    nameOf(barangays, barangay),
    nameOf(cities, city),
    nameOf(provinces, province),
    nameOf(regions, region),
  ]
    .filter(Boolean)
    .join(", ");
  const locationCode = barangay || city || province || region;

  async function createLsg(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Give the LSG a name.");
      return;
    }
    if (!city) {
      setError("Choose the city or municipality where it is located.");
      return;
    }

    setCreating(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmed,
          unitType,
          address,
          locationCode,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        unitId?: string;
        message?: string;
      };
      if (!res.ok || !data.ok || !data.unitId) {
        setError(data.message ?? "We could not create that LSG.");
        return;
      }

      setCreated((rows) => [
        ...rows,
        {
          id: data.unitId as string,
          name: trimmed,
          unitType,
          address,
          email: "",
          sending: false,
          invited: false,
          error: "",
        },
      ]);
      setName("");
      setBarangay("");
      setNotice(`${trimmed} created. Add the officer email below to invite them.`);
      onCreated?.();
    } catch {
      setError("We could not reach the server. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  async function inviteLsg(item: CreatedLsg) {
    const email = item.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setCreated((rows) =>
        rows.map((row) =>
          row.id === item.id ? { ...row, error: "Enter a valid email address." } : row,
        ),
      );
      return;
    }

    setCreated((rows) =>
      rows.map((row) =>
        row.id === item.id ? { ...row, sending: true, error: "" } : row,
      ),
    );
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          campusName: item.name,
          unitType: item.unitType,
          unitId: item.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        delivered?: boolean;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        const message = data.message ?? "We could not send that invitation.";
        setCreated((rows) =>
          rows.map((row) => (row.id === item.id ? { ...row, sending: false, error: message } : row)),
        );
        return;
      }
      setCreated((rows) =>
        rows.map((row) =>
          row.id === item.id
            ? {
                ...row,
                sending: false,
                invited: true,
                email,
                error: data.delivered === false ? data.message ?? "Invitation recorded; email not delivered." : "",
              }
            : row,
        ),
      );
      setNotice(`Invitation sent to ${email}.`);
      onInvited?.();
    } catch {
      setCreated((rows) =>
        rows.map((row) =>
          row.id === item.id
            ? { ...row, sending: false, error: "We could not reach the server." }
            : row,
        ),
      );
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-paper/70 p-6 sm:p-7">
      <p className="eyebrow">Create LSGs</p>
      <h2 className="mt-2 text-[1.125rem] leading-tight text-ink">Name the LSG, then invite its officer</h2>
      <p className="mt-2 max-w-2xl text-[0.875rem] leading-relaxed text-body">
        Add each campus, college, or department under your umbrella with its Philippine
        location. Once it is created, enter the email of the officer who will manage it.
      </p>

      <form onSubmit={createLsg} noValidate className="mt-6 flex flex-col gap-4">
        <TextField
          id="lsg-name"
          label="Department, campus, or college name"
          placeholder="College of Engineering"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="flex flex-col gap-2">
          <label htmlFor="lsg-type" className="text-[0.8125rem] font-semibold text-ink">
            What kind of LSG?
          </label>
          <select
            id="lsg-type"
            value={unitType}
            onChange={(e) => setUnitType(e.target.value)}
            className={selectClass}
          >
            {UNIT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <label htmlFor="lsg-region" className="text-[0.8125rem] font-semibold text-ink">
              Region
            </label>
            <select
              id="lsg-region"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className={selectClass}
            >
              <option value="">Choose a region…</option>
              {regions.map((place) => (
                <option key={place.code} value={place.code}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="lsg-province" className="text-[0.8125rem] font-semibold text-ink">
              Province <span className="font-normal text-muted">(optional for NCR)</span>
            </label>
            <select
              id="lsg-province"
              value={province}
              onChange={(e) => setProvince(e.target.value)}
              disabled={!region || provinces.length === 0}
              className={selectClass}
            >
              <option value="">{provinces.length === 0 ? "No province needed" : "Choose a province…"}</option>
              {provinces.map((place) => (
                <option key={place.code} value={place.code}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="lsg-city" className="text-[0.8125rem] font-semibold text-ink">
              City or municipality
            </label>
            <select
              id="lsg-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={!region || cities.length === 0}
              className={selectClass}
            >
              <option value="">{cities.length === 0 ? "Choose a region first" : "Choose a city…"}</option>
              {cities.map((place) => (
                <option key={place.code} value={place.code}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="lsg-barangay" className="text-[0.8125rem] font-semibold text-ink">
              Barangay <span className="font-normal text-muted">(optional)</span>
            </label>
            <select
              id="lsg-barangay"
              value={barangay}
              onChange={(e) => setBarangay(e.target.value)}
              disabled={!city || barangays.length === 0}
              className={selectClass}
            >
              <option value="">{barangays.length === 0 ? "Choose a city first" : "Choose a barangay…"}</option>
              {barangays.map((place) => (
                <option key={place.code} value={place.code}>
                  {place.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {address ? (
          <p className="rounded-xl border border-line bg-canvas/60 px-3.5 py-2.5 text-[0.8125rem] text-body">
            <span className="font-semibold text-ink">Location: </span>
            {address}
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="text-[0.8125rem] font-medium text-[#a5442c]">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="text-[0.8125rem] font-medium text-[#2f5d38]">
            {notice}
          </p>
        ) : null}

        <Button type="submit" size="sm" disabled={creating || !name.trim() || !city}>
          {creating ? "Creating…" : "Create LSG"}
        </Button>
      </form>

      {created.length > 0 ? (
        <div className="mt-6 flex flex-col gap-3 border-t border-line/70 pt-5">
          <p className="eyebrow">Created LSGs</p>
          {created.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-line bg-canvas/50 px-4 py-3.5"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[0.9375rem] font-medium text-ink">{item.name}</p>
                <span className="text-[0.75rem] text-muted">{item.unitType}</span>
              </div>
              {item.address ? (
                <p className="mt-0.5 text-[0.75rem] text-muted">{item.address}</p>
              ) : null}

              <div className="mt-3 flex flex-wrap items-end gap-2">
                <div className="min-w-[16rem] flex-1">
                  <TextField
                    id={`lsg-email-${item.id}`}
                    label="Officer email"
                    type="email"
                    placeholder="officer@campus.edu"
                    value={item.email}
                    onChange={(e) =>
                      setCreated((rows) =>
                        rows.map((row) =>
                          row.id === item.id ? { ...row, email: e.target.value, error: "" } : row,
                        ),
                      )
                    }
                    disabled={item.invited}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={item.invited ? "paper" : "primary"}
                  disabled={item.invited || item.sending || !item.email.trim()}
                  onClick={() => void inviteLsg(item)}
                >
                  {item.invited ? (
                    <span className="inline-flex items-center gap-1.5">
                      <IconCheck className="h-4 w-4" strokeWidth={2.2} />
                      Invited
                    </span>
                  ) : item.sending ? (
                    "Sending…"
                  ) : (
                    "Send invite"
                  )}
                </Button>
              </div>

              {item.error ? (
                <p role="alert" className="mt-2 text-[0.75rem] text-[#a5442c]">
                  {item.error}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
