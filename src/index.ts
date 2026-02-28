import { defineCommand, runMain } from "citty";

const main = defineCommand({
  meta: {
    name: "envsync",
    version: "0.1.0",
    description:
      "Sync .env files to Cloudflare Workers secrets, .dev.vars, and more",
  },
  subCommands: {
    dev: () => import("./commands/dev.ts").then((m) => m.default),
    push: () => import("./commands/push.ts").then((m) => m.default),
    pull: () => import("./commands/pull.ts").then((m) => m.default),
    validate: () => import("./commands/validate.ts").then((m) => m.default),
    diff: () => import("./commands/diff.ts").then((m) => m.default),
    init: () => import("./commands/init.ts").then((m) => m.default),
    normalize: () => import("./commands/normalize.ts").then((m) => m.default),
    merge: () => import("./commands/merge.ts").then((m) => m.default),
    list: () => import("./commands/list.ts").then((m) => m.default),
  },
});

runMain(main);
