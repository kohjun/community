import { z } from "zod";
export const inkPoint = z.tuple([
  z.number().finite().min(0).max(1),
  z.number().finite().min(0).max(1),
]);
export const inkCommand = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("stroke"),
    id: z.uuid(),
    colour: z.enum(["#111827", "#0A84FE", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6", "#ffffff"]),
    width: z.number().int().min(1).max(30),
    points: z.array(inkPoint).min(1).max(128),
  }),
  z.strictObject({ op: z.literal("undo") }),
  z.strictObject({ op: z.literal("clear") }),
]);
export type InkCommand = z.infer<typeof inkCommand>;
export type InkStroke = Extract<InkCommand, { op: "stroke" }>;
export type InkEvent = { seq: number; command: InkCommand };
export function replayInk(events: readonly InkEvent[]): InkStroke[] {
  const strokes: InkStroke[] = [];
  for (const { command: c } of events) {
    if (c.op === "clear") strokes.length = 0;
    else if (c.op === "undo") strokes.pop();
    else {
      const previous = strokes.at(-1);
      if (previous?.id === c.id) previous.points.push(...c.points);
      else strokes.push({ ...c, points: [...c.points] });
    }
  }
  return strokes;
}
export function paintInk(
  context: CanvasRenderingContext2D,
  strokes: readonly InkStroke[],
  width: number,
  height: number,
) {
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.lineJoin = "round";
  context.lineCap = "round";
  for (const s of strokes) {
    context.strokeStyle = s.colour;
    context.fillStyle = s.colour;
    context.lineWidth = (s.width * width) / 800;
    context.beginPath();
    for (const [i, p] of s.points.entries()) {
      if (i === 0) context.moveTo(p[0] * width, p[1] * height);
      else context.lineTo(p[0] * width, p[1] * height);
    }
    if (s.points.length === 1) {
      const p = s.points[0]!;
      context.arc(p[0] * width, p[1] * height, context.lineWidth / 2, 0, Math.PI * 2);
      context.fill();
    } else context.stroke();
  }
}
