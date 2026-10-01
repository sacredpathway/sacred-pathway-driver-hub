import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every app route is dynamic (server-rendered per request behind the auth
// middleware), so no ISR/R2 incremental cache is configured. Adding one
// would require creating an R2 bucket — an external change.
export default defineCloudflareConfig({});
