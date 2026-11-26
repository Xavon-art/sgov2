// @ts-nocheck
"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/Field";
import type { OrgNode } from "@/components/structure/orgchart-editor/orgchart-adapter";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_STORED_DECODED_BYTES = 500_000;

function bytesToText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)} KB`;
  return `${bytes} B`;
}

function decodedBytesFromDataUrl(dataUrl: string): number {
  const base64 = dataUrl.split(",")[1] || "";
  return atob(base64).length;
}

function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;
        if (width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        }
        if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Cannot compress image"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.9;
        let dataUrl = canvas.toDataURL("image/jpeg", quality);
        while (
          decodedBytesFromDataUrl(dataUrl) > MAX_STORED_DECODED_BYTES &&
          quality > 0.4
        ) {
          quality -= 0.1;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
        }
        let scale = 0.8;
        while (
          decodedBytesFromDataUrl(dataUrl) > MAX_STORED_DECODED_BYTES &&
          scale > 0.3
        ) {
          canvas.width = Math.max(1, Math.round(width * scale));
          canvas.height = Math.max(1, Math.round(height * scale));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          quality = 0.8;
          dataUrl = canvas.toDataURL("image/jpeg", quality);
          scale -= 0.1;
        }
        resolve(dataUrl);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Invalid image file"));
    img.src = URL.createObjectURL(file);
  });
}

export function SeatInspector({
  node,
  canEdit,
  onUpdate,
  onAddChild,
  onAddSibling,
  onRemove,
}: {
  node: OrgNode | null;
  canEdit: boolean;
  onUpdate: (updates: Partial<OrgNode>) => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onRemove: () => void;
}) {
  const [form, setForm] = useState({
    title: "",
    name: "",
    course: "",
    yearLevel: "",
    section: "",
    email: "",
    photo: null as string | null,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [photoUploading, setPhotoUploading] = useState(false);

  useEffect(() => {
    if (!node) {
      setForm({ title: "", name: "", course: "", yearLevel: "", section: "", email: "", photo: null });
      setErrors({});
      return;
    }
    setForm({
      title: node.title ?? "",
      name: node.name ?? "",
      course: node.course ?? "",
      yearLevel: node.yearLevel ?? "",
      section: node.section ?? "",
      email: node.email ?? "",
      photo: node.photo ?? null,
    });
  }, [node]);

  const setField = useCallback(
    (key: string, value: string) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
    },
    [],
  );

  const handlePhoto = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      if (file.size > MAX_UPLOAD_BYTES) {
        setErrors((prev) => ({ ...prev, photo: `Photo must be under ${bytesToText(MAX_UPLOAD_BYTES)}.` }));
        return;
      }
      setErrors((prev) => ({ ...prev, photo: "" }));
      setPhotoUploading(true);
      try {
        const dataUrl = await compressImage(file);
        const storedBytes = decodedBytesFromDataUrl(dataUrl);
        if (storedBytes > MAX_STORED_DECODED_BYTES) {
          setErrors((prev) => ({ ...prev, photo: `Compressed photo is still too large (${bytesToText(storedBytes)}). Try a smaller image.` }));
          setPhotoUploading(false);
          return;
        }
        setForm((prev) => ({ ...prev, photo: dataUrl }));
        onUpdate({ photo: dataUrl });
        setPhotoUploading(false);
        event.target.value = "";
      } catch {
        setPhotoUploading(false);
        setErrors((prev) => ({ ...prev, photo: "Could not process the photo file." }));
      }
    },
    [onUpdate],
  );

  const validate = useCallback(() => {
    const next: Record<string, string> = {};
    if (!form.title.trim()) next.title = "Position is required.";
    if (!form.name.trim()) next.name = "Full name is required.";
    if (!form.email.trim()) next.email = "Email is required.";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) next.email = "Enter a valid email address.";
    if (!form.course.trim()) next.course = "Course is required.";
    if (!form.yearLevel.trim()) next.yearLevel = "Year level is required.";
    if (!form.section.trim()) next.section = "Section is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }, [form]);

  const handleUpdate = useCallback(
    (key: string, value: string | null) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      const next: Partial<OrgNode> = { [key]: value };
      if (key === "name" || key === "title" || key === "email") {
        next.fullName = key === "name" ? (value || "Vacant") : undefined;
      }
      onUpdate(next);
    },
    [onUpdate],
  );

  if (!node || !canEdit) {
    return (
      <div className="flex flex-col gap-4 p-4 border border-line rounded-2xl bg-paper/60">
        <p className="text-[0.875rem] font-medium text-ink">Select a seat to edit</p>
        <p className="text-[0.8125rem] text-muted">
          Choose an officer node on the chart to edit profile picture, name, position, course,
          year level, section, and email.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4 border border-line rounded-2xl bg-paper/60 max-h-[70vh] overflow-y-auto">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[0.9375rem] font-medium text-ink">Edit seat</h3>
        <Button variant="outline" size="sm" onClick={onAddSibling} disabled={photoUploading}>
          Add sibling
        </Button>
        <Button variant="outline" size="sm" onClick={onAddChild} disabled={photoUploading}>
          Add child
        </Button>
        <Button variant="outline" size="sm" onClick={onRemove} disabled={photoUploading}>
          Remove seat
        </Button>
      </div>

      <TextField
        id="seat-title"
        label="Position"
        value={form.title}
        onChange={(e) => setField("title", e.target.value)}
        error={errors.title}
        required
      />
      <TextField
        id="seat-name"
        label="Full name"
        value={form.name}
        onChange={(e) => setField("name", e.target.value)}
        error={errors.name}
        required
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          id="seat-course"
          label="Course"
          value={form.course}
          onChange={(e) => setField("course", e.target.value)}
          error={errors.course}
          required
        />
        <TextField
          id="seat-year"
          label="Year level"
          value={form.yearLevel}
          onChange={(e) => setField("yearLevel", e.target.value)}
          error={errors.yearLevel}
          required
        />
        <TextField
          id="seat-section"
          label="Section"
          value={form.section}
          onChange={(e) => setField("section", e.target.value)}
          error={errors.section}
          required
        />
      </div>
      <TextField
        id="seat-email"
        label="Email"
        type="email"
        value={form.email}
        onChange={(e) => setField("email", e.target.value)}
        error={errors.email}
        required
      />
      <div className="relative">
        <label className="block text-[0.8125rem] font-medium text-ink mb-1">Profile picture</label>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="block w-full text-xs text-ink-soft file:mr-3 file:rounded-full file:border file:border-line file:bg-paper file:px-3 file:py-1.5 file:text-[0.75rem] file:text-ink-deep"
          disabled={photoUploading}
          onChange={handlePhoto}
        />
        {photoUploading ? (
          <p className="mt-1 text-[0.75rem] text-muted">Reading photo…</p>
        ) : null}
        {errors.photo ? (
          <p className="animate-float-in text-[0.75rem] font-medium text-[#a5442c]">{errors.photo}</p>
        ) : null}
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          if (validate()) onUpdate({});
        }}
        disabled={photoUploading || Object.keys(errors).length > 0}
      >
        Apply changes
      </Button>
    </div>
  );
}
