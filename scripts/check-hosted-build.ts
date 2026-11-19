import { pathToFileURL } from "node:url";
import { assertHostedConfiguration, HostedConfigurationError } from "../server/config.js";

export function checkHostedAuthEnvironment(env: NodeJS.ProcessEnv) {
  for (const name of ["APP_ORIGIN", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY", "DATABASE_URL"]) {
    if (!env[name]?.trim()) throw new Error(`Missing ${name} in this deployment environment.`);
  }
  for (const name of ["APP_ORIGIN", "SUPABASE_URL"]) {
    let valid = false;
    try {
      const url = new URL(env[name]!);
      const value = name === "SUPABASE_URL" ? env[name]!.replace(/\/$/, "") : env[name];
      valid = url.protocol === "https:" && !url.username && !url.password && url.origin === value;
    } catch { /* Only the variable name is safe to log. */ }
    if (!valid) throw new Error(`${name} must be an HTTPS origin without credentials, a path or query${name === "APP_ORIGIN" ? ", or a trailing slash" : ""}.`);
  }
  let validDatabase = false;
  try { validDatabase = ["postgres:", "postgresql:"].includes(new URL(env.DATABASE_URL!).protocol); }
  catch { /* Never print a database connection string. */ }
  if (!validDatabase) throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    checkHostedAuthEnvironment(process.env);
    assertHostedConfiguration();
    console.log("Hosted configuration preflight passed. Runtime connectivity and email callbacks still require verification.");
  } catch (error) {
    const message = error instanceof HostedConfigurationError ? error.code : error instanceof Error ? error.message : "Invalid hosted configuration.";
    console.error(`Inkshot deployment blocked: ${message} Configure this project's Preview or Production environment before rebuilding.`);
    process.exitCode = 1;
  }
}
