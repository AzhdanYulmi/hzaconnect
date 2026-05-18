import { Redis } from "ioredis";
import { config } from "./config.js";

export const redis = new Redis(config.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: null,
});

export const redisSub = new Redis(config.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: null,
});
