/**
 * Runs once when the Next.js server starts. The Node-only start-up work lives in
 * instrumentation-node.ts; this static check keeps it out of the edge bundle.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
