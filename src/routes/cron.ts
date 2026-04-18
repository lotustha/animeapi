import { Elysia } from "elysia";
import { Cache } from "../core/cache.js";
import { AnimeKai } from "../providers/anime/animekai/animekai.js";
import { sendTopicNotification } from "../core/firebase.js";
import { Logger } from "../core/logger.js";

// Namespace for cron jobs
export const cronRoutes = new Elysia({ prefix: "/cron" })
  .get("/check-episodes", async ({ set }) => {
    try {
      // 1. Fetch recently updated anime
      // We assume page 1 gives the latest new episodes
      const recent = await AnimeKai.recentlyUpdated(1);
      
      if (!recent || !recent.results || recent.results.length === 0) {
        set.status = 200;
        return { message: "No recent episodes found." };
      }

      let notificationsSent = 0;
      let episodesChecked = 0;

      // 2. Diff with our cache
      // Loop backwards to ensure oldest new episodes get notified first, 
      // or optionally just run normally if we only care about the absolute latest per anime.
      for (const anime of recent.results) {
        episodesChecked++;
        // Use a namespaced key for the notification tracker
        const trackerKey = `notifier:latest_episode:${anime.id}`;
        
        const cachedEpisode = await Cache.get(trackerKey);
        
        // Convert to number for reliable checking or just string equality.
        // Assuming episode is a number. If it's a string like "Episode 12",
        // we might do string matching. If it's a raw number or string-based decimal, Number() works.
        const currentEpNumber = Number(anime.episodes);
        const previousEpNumber = Number(cachedEpisode);

        // We check if it's new
        let isNew = false;
        
        if (cachedEpisode == null) {
          // If no cache, it's new but we probably shouldn't spam users.
          // Usually we just seed it if it's the very first time. 
          // Let's seed it and NOT send a notification to prevent mass spam on first run.
          // OR, if the user requested it, send it.
          // For safety, let's just seed it on the first ever run.
          await Cache.set(trackerKey, String(anime.episodes), -1); // keep forever
          continue; 
        }

        if (!isNaN(currentEpNumber) && !isNaN(previousEpNumber)) {
          isNew = currentEpNumber > previousEpNumber;
        } else {
          // Fallback to string diff if it's something weird
          isNew = cachedEpisode !== String(anime.episodes);
        }

        if (isNew) {
          // 3. Send Firebase push notification
          const topic = `anime_${anime.id}`;
          const title = "New Episode Alert!";
          const body = `${anime.title} Episode ${anime.episodes} is now out.`;
          
          const payloadData = {
            route: "/details",
            animeId: String(anime.id)
          };

          const sent = await sendTopicNotification(topic, title, body, payloadData);
          
          if (sent) {
            notificationsSent++;
            // Update the cache so we don't notify again
            await Cache.set(trackerKey, String(anime.episodes), -1);
          }
        }
      }

      Logger.info(`[Cron] Checked ${episodesChecked} episodes. Sent ${notificationsSent} notifications.`);
      set.status = 200;
      return { 
        message: "Successfully ran check-episodes cron.",
        checked: episodesChecked,
        sent: notificationsSent
      };

    } catch (error) {
      Logger.error("[Cron] Error checking episodes:", error);
      set.status = 500;
      return { message: "Internal server error", error: String(error) };
    }
  });
