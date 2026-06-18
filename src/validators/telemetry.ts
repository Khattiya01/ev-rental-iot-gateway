import { z } from 'zod'

const MAX_CLOCK_DRIFT_MS = 60_000

export const telemetrySchema = z
  .object({
    vehicle_id: z.uuid(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    speed: z.number().min(0).max(200),
    heading: z.number().min(0).max(360),
    soc: z.number().min(0).max(100),
    temperature: z.number().min(-20).max(80),
    odometer: z.number().nonnegative(),
    charge_cycles: z.number().nonnegative(),
    status: z.enum(['available', 'rented', 'charging', 'under_repair']),
    timestamp: z.iso.datetime(),
  })
  .refine((data) => Date.now() - new Date(data.timestamp).getTime() < MAX_CLOCK_DRIFT_MS, {
    message: 'timestamp is older than 60 seconds',
    path: ['timestamp'],
  })

export type TelemetryPayload = z.infer<typeof telemetrySchema>

export type ValidationResult =
  | { success: true; data: TelemetryPayload }
  | { success: false; error: string }

export function validateTelemetry(data: unknown): ValidationResult {
  const result = telemetrySchema.safeParse(data)
  if (result.success) return { success: true, data: result.data }

  const error = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
  return { success: false, error }
}
