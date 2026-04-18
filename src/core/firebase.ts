import * as admin from "firebase-admin";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "./runtime.js";
import { Logger } from "./logger.js";

let _isFirebaseInitialized = false;

/**
 * Initializes the Firebase Admin SDK using the credentials from .env and firebase_key_json.json.
 */
export function initFirebase() {
  if (_isFirebaseInitialized) return;

  try {
    // If using environment variables correctly setup via Elysia / bun
    const projectId = env.FIREBASE_PROJECT_ID;
    const clientEmail = env.FIREBASE_CLIENT_EMAIL;
    const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

    let credential;

    if (projectId && clientEmail && privateKey) {
      credential = admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      });
    } else {
      // Fallback to json file if explicitly provided
      const keyPath = resolve(process.cwd(), "firebase_key_json.json");
      const serviceAccount = JSON.parse(readFileSync(keyPath, "utf-8"));
      credential = admin.credential.cert(serviceAccount);
    }

    admin.initializeApp({
      credential,
    });
    
    _isFirebaseInitialized = true;
    Logger.info("[Firebase] Admin SDK initialized successfully");
  } catch (error) {
    Logger.error("[Firebase] Error initializing Admin SDK:", error);
  }
}

/**
 * Sends a push notification to a specialized FCM topic.
 * 
 * @param topic The FCM topic to publish to (e.g., 'anime_12345').
 * @param title The title of the notification.
 * @param body The body message of the notification.
 * @param data A payload of string-based data required by the frontend routing system.
 */
export async function sendTopicNotification(
  topic: string,
  title: string,
  body: string,
  data: Record<string, string>
) {
  if (!_isFirebaseInitialized) {
    initFirebase();
  }

  const message = {
    notification: {
      title,
      body,
    },
    data,
    topic,
  };

  try {
    const response = await admin.messaging().send(message);
    Logger.info(`[Firebase] Successfully sent message to topic ${topic}:`, response);
    return true;
  } catch (error) {
    Logger.error(`[Firebase] Error sending message to topic ${topic}:`, error);
    return false;
  }
}
