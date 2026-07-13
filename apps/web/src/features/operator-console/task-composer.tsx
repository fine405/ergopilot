import {
  type ChairErgonomics,
  defaultWorkstationConfiguration,
  type SaveWorkstationProfileRequest,
  type TaskSpec,
  type WorkstationConfiguration,
  type WorkstationProfile,
  type WorkstationSnapshot,
  workstationConfigurationSchema,
} from "@ergopilot/contracts";
import {
  ArrowRight,
  BookmarkPlus,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  buildWorkstationProfileTask,
  builtInWorkstationPresets,
  configurationFromSnapshot,
} from "@/features/workstation-profile/workstation-profile";

interface TaskComposerProps {
  snapshot: WorkstationSnapshot | undefined;
  profiles: WorkstationProfile[];
  onSubmit: (task: TaskSpec) => Promise<void>;
  onSaveProfile: (profile: SaveWorkstationProfileRequest) => Promise<void>;
  isPending: boolean;
  isSaving: boolean;
  error: string | null;
}

type NumericChairKey = Exclude<keyof ChairErgonomics, "reclineLocked">;

export function TaskComposer({
  snapshot,
  profiles,
  onSubmit,
  onSaveProfile,
  isPending,
  isSaving,
  error,
}: TaskComposerProps) {
  const [requestedBy, setRequestedBy] = useState("demo-user");
  const [durationMinutes, setDurationMinutes] = useState(45);
  const [configuration, setConfiguration] = useState<WorkstationConfiguration>(
    snapshot
      ? configurationFromSnapshot(snapshot)
      : defaultWorkstationConfiguration,
  );
  const [profileName, setProfileName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (snapshot) setConfiguration(configurationFromSnapshot(snapshot));
  }, [snapshot]);

  function updateChair(key: NumericChairKey, value: number) {
    setConfiguration((current) => ({
      ...current,
      chair: { ...current.chair, [key]: value },
    }));
  }

  async function submitConfiguration(next: WorkstationConfiguration) {
    const parsed = workstationConfigurationSchema.safeParse(next);
    if (!parsed.success || !requestedBy.trim()) {
      setValidationError("Keep every control inside its displayed safe range.");
      return;
    }
    setValidationError(null);
    try {
      await onSubmit(
        buildWorkstationProfileTask({
          taskId: `task-profile-${crypto.randomUUID()}`,
          requestedBy: requestedBy.trim(),
          durationMinutes,
          configuration: parsed.data,
        }),
      );
    } catch {
      // React Query exposes the mutation error through the `error` prop.
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitConfiguration(configuration);
  }

  async function handlePreset(next: WorkstationConfiguration) {
    setConfiguration(next);
    await submitConfiguration(next);
  }

  async function handleSaveProfile() {
    const name = profileName.trim();
    const parsed = workstationConfigurationSchema.safeParse(configuration);
    if (!name || !parsed.success) {
      setValidationError("Add a preset name and keep every value in range.");
      return;
    }
    setValidationError(null);
    try {
      await onSaveProfile({
        id: `profile-${crypto.randomUUID()}`,
        name,
        configuration: parsed.data,
      });
      setProfileName("");
    } catch {
      // React Query exposes the mutation error through the `error` prop.
    }
  }

  const presets = [
    ...builtInWorkstationPresets,
    ...profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      description: "Saved in the local station database.",
      configuration: profile.configuration,
    })),
  ];

  return (
    <Card>
      <CardHeader>
        <div className="mb-2 flex size-9 items-center justify-center rounded-lg border bg-muted">
          <SlidersHorizontal
            className="size-4 text-primary"
            aria-hidden="true"
          />
        </div>
        <CardTitle>Workstation controls</CardTitle>
        <CardDescription>
          Presets create an approval-ready run in one click. Manual controls and
          Chat use the same protected four-step task; nothing moves before
          approval.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-6" onSubmit={handleSubmit}>
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Scene presets</p>
                <p className="text-xs text-muted-foreground">
                  Office, rest, standing, or station-saved memory.
                </p>
              </div>
              <ShieldCheck
                className="size-4 text-status-warn"
                aria-label="Approval required"
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {presets.map((preset) => (
                <Button
                  key={preset.id}
                  type="button"
                  variant="outline"
                  className="h-auto items-start justify-start px-3 py-2 text-left"
                  aria-label={`Apply ${preset.name} preset`}
                  disabled={isPending || !snapshot}
                  onClick={() => void handlePreset(preset.configuration)}
                >
                  <span>
                    <span className="block font-medium">{preset.name}</span>
                    <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                      {preset.description}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
          </section>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="requested-by">Requested by</Label>
              <Input
                id="requested-by"
                value={requestedBy}
                onChange={(event) => setRequestedBy(event.target.value)}
                required
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="duration">Session duration</Label>
              <Input
                id="duration"
                type="number"
                min={15}
                max={180}
                step={5}
                value={durationMinutes}
                onChange={(event) =>
                  setDurationMinutes(event.target.valueAsNumber)
                }
                required
              />
            </div>
          </div>

          <details open className="rounded-lg border bg-muted/20 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Desk, light and reminder
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <RangeControl
                id="desk-height"
                label="Desk height"
                value={configuration.deskHeightMm}
                min={620}
                max={1_280}
                step={10}
                unit="mm"
                onChange={(deskHeightMm) =>
                  setConfiguration((current) => ({ ...current, deskHeightMm }))
                }
              />
              <RangeControl
                id="light-brightness"
                label="Light brightness"
                value={configuration.light.brightnessPercent}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(brightnessPercent) =>
                  setConfiguration((current) => ({
                    ...current,
                    light: { ...current.light, brightnessPercent },
                  }))
                }
              />
              <RangeControl
                id="light-temperature"
                label="Light temperature"
                value={configuration.light.colorTemperatureK}
                min={2_700}
                max={6_500}
                step={100}
                unit="K"
                onChange={(colorTemperatureK) =>
                  setConfiguration((current) => ({
                    ...current,
                    light: { ...current.light, colorTemperatureK },
                  }))
                }
              />
              <RangeControl
                id="reminder-interval"
                label="Sedentary reminder"
                value={configuration.reminder.intervalMinutes}
                min={20}
                max={180}
                step={5}
                unit="min"
                onChange={(intervalMinutes) =>
                  setConfiguration((current) => ({
                    ...current,
                    reminder: { ...current.reminder, intervalMinutes },
                  }))
                }
              />
              <label className="flex items-center gap-3 rounded-md border bg-background/60 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={configuration.reminder.enabled}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      reminder: {
                        ...current.reminder,
                        enabled: event.target.checked,
                      },
                    }))
                  }
                />
                Reminder enabled
              </label>
            </div>
          </details>

          <details className="rounded-lg border bg-muted/20 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Ergonomic chair — seat and lumbar
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <RangeControl
                id="seat-height"
                label="Seat height"
                value={configuration.chair.seatHeightMm}
                min={420}
                max={550}
                step={5}
                unit="mm"
                onChange={(value) => updateChair("seatHeightMm", value)}
              />
              <RangeControl
                id="seat-depth"
                label="Seat depth"
                value={configuration.chair.seatDepthMm}
                min={380}
                max={520}
                step={5}
                unit="mm"
                onChange={(value) => updateChair("seatDepthMm", value)}
              />
              <RangeControl
                id="lumbar-support"
                label="Lumbar support"
                value={configuration.chair.lumbarSupportPercent}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(value) => updateChair("lumbarSupportPercent", value)}
              />
            </div>
          </details>

          <details className="rounded-lg border bg-muted/20 p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Ergonomic chair — armrests, recline and headrest
            </summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <RangeControl
                id="armrest-height"
                label="Armrest height"
                value={configuration.chair.armrestHeightMm}
                min={180}
                max={310}
                step={5}
                unit="mm"
                onChange={(value) => updateChair("armrestHeightMm", value)}
              />
              <RangeControl
                id="armrest-depth"
                label="Armrest fore / aft"
                value={configuration.chair.armrestDepthMm}
                min={-60}
                max={60}
                step={5}
                unit="mm"
                onChange={(value) => updateChair("armrestDepthMm", value)}
              />
              <RangeControl
                id="armrest-width"
                label="Armrest spacing"
                value={configuration.chair.armrestWidthMm}
                min={420}
                max={560}
                step={5}
                unit="mm"
                onChange={(value) => updateChair("armrestWidthMm", value)}
              />
              <RangeControl
                id="armrest-angle"
                label="Armrest swivel"
                value={configuration.chair.armrestAngleDeg}
                min={-30}
                max={30}
                step={1}
                unit="°"
                onChange={(value) => updateChair("armrestAngleDeg", value)}
              />
              <RangeControl
                id="recline-angle"
                label="Backrest recline"
                value={configuration.chair.reclineAngleDeg}
                min={110}
                max={135}
                step={1}
                unit="°"
                onChange={(value) => updateChair("reclineAngleDeg", value)}
              />
              <RangeControl
                id="recline-resistance"
                label="Recline resistance"
                value={configuration.chair.reclineResistancePercent}
                min={0}
                max={100}
                step={1}
                unit="%"
                onChange={(value) =>
                  updateChair("reclineResistancePercent", value)
                }
              />
              <RangeControl
                id="headrest-height"
                label="Headrest height"
                value={configuration.chair.headrestHeightMm}
                min={0}
                max={120}
                step={5}
                unit="mm"
                onChange={(value) => updateChair("headrestHeightMm", value)}
              />
              <RangeControl
                id="headrest-angle"
                label="Headrest angle"
                value={configuration.chair.headrestAngleDeg}
                min={-30}
                max={30}
                step={1}
                unit="°"
                onChange={(value) => updateChair("headrestAngleDeg", value)}
              />
              <label className="flex items-center gap-3 rounded-md border bg-background/60 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={configuration.chair.reclineLocked}
                  onChange={(event) =>
                    setConfiguration((current) => ({
                      ...current,
                      chair: {
                        ...current.chair,
                        reclineLocked: event.target.checked,
                      },
                    }))
                  }
                />
                Recline locked
              </label>
            </div>
          </details>

          <section className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <div className="space-y-2">
              <Label htmlFor="profile-name">Preset name</Label>
              <Input
                id="profile-name"
                maxLength={64}
                placeholder="My reading mode"
                value={profileName}
                onChange={(event) => setProfileName(event.target.value)}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => void handleSaveProfile()}
              aria-label="Save current preset"
            >
              <BookmarkPlus />
              {isSaving ? "Saving…" : "Save current"}
            </Button>
          </section>

          {(validationError || error) && (
            <Alert variant="destructive">
              <AlertTitle>Configuration not ready</AlertTitle>
              <AlertDescription>{validationError ?? error}</AlertDescription>
            </Alert>
          )}

          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isPending || !snapshot}
            aria-label="Create profile run"
          >
            {isPending ? "Creating run…" : "Create protected profile run"}
            {!isPending && <ArrowRight data-icon="inline-end" />}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

interface RangeControlProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (value: number) => void;
}

function RangeControl({
  id,
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: RangeControlProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <output
          htmlFor={id}
          className="font-mono text-xs text-muted-foreground"
        >
          {value} {unit}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        className="h-2 w-full cursor-pointer accent-primary"
      />
    </div>
  );
}
