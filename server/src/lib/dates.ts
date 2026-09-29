import { z } from "zod";

// A calendar date as the forms send it - "YYYY-MM-DD", or the full ISO
// timestamp a record round-trips with (the date part is what counts) - a
// real date, in a range that rules out the "0002-10-01" a half-typed year
// produces. A blank due date used to reach `new Date("")` and answer 500
// (R4-35). The parsed value is always the "YYYY-MM-DD" part.
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[0-9:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, "Use a full date (YYYY-MM-DD).")
  .transform((s) => s.slice(0, 10))
  .refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    const year = Number(s.slice(0, 4));
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && year >= 2000 && year <= 2100;
  }, "That is not a real date (or the year is out of range).");
