export function recordMetric(event: string, fields: Record<string, string | number | boolean | null | undefined>) {
  const safeFields = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  console.info(JSON.stringify({ type: "coffee_metric", event, timestamp: new Date().toISOString(), ...safeFields }));
}
